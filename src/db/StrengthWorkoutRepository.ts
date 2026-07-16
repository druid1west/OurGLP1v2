import { getDb } from './sqlite';
import type { StrengthAnswers, StrengthPlan, StrengthStatus } from '../lib/strengthTraining';

export type StrengthWorkout = {
  id: string;
  userId: string;
  scheduledDay: string;
  status: StrengthStatus;
  answers: StrengthAnswers;
  plan: StrengthPlan;
  startedAt: string | null;
  completedAt: string | null;
  completedExerciseIds: string[];
  actualMinutes: number | null;
  calories: number | null;
  caloriesSource: 'estimate' | 'apple_health' | null;
  difficulty: 'easy' | 'right' | 'hard' | 'pain' | null;
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, unknown>;

const REUSABLE_STRENGTH_STATUSES: ReadonlySet<StrengthStatus> = new Set([
  'planned',
  'in_progress',
  'completed',
  'partial',
]);

function rows(values?: unknown[] | null): Row[] {
  if (!values?.length) return [];
  if (typeof values[0] === 'object' && values[0] !== null) return values as Row[];
  return [];
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mapWorkout(row: Row): StrengthWorkout {
  return {
    id: String(row.id ?? ''), userId: String(row.user_id ?? ''), scheduledDay: String(row.scheduled_day ?? ''),
    status: String(row.status ?? 'planned') as StrengthStatus,
    answers: parseJson(row.answers_json, {} as StrengthAnswers), plan: parseJson(row.plan_json, {} as StrengthPlan),
    startedAt: row.started_at ? String(row.started_at) : null, completedAt: row.completed_at ? String(row.completed_at) : null,
    completedExerciseIds: parseJson(row.completed_exercise_ids_json, [] as string[]),
    actualMinutes: row.actual_minutes == null ? null : Number(row.actual_minutes),
    calories: row.calories == null ? null : Number(row.calories),
    caloriesSource: row.calories_source ? String(row.calories_source) as StrengthWorkout['caloriesSource'] : null,
    difficulty: row.difficulty ? String(row.difficulty) as StrengthWorkout['difficulty'] : null,
    createdAt: String(row.created_at ?? ''), updatedAt: String(row.updated_at ?? ''),
  };
}

function isValidLocalDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isPlaceholderIdentifier(value: string): boolean {
  return /^(?:test|placeholder|dummy|sample|temp)(?:[-_:]|$)/i.test(value.trim());
}

export function isValidStrengthWorkout(workout: StrengthWorkout): boolean {
  return Boolean(
    workout.id.trim() &&
    !isPlaceholderIdentifier(workout.id) &&
    workout.userId.trim() &&
    !isPlaceholderIdentifier(workout.userId) &&
    isValidLocalDay(workout.scheduledDay) &&
    REUSABLE_STRENGTH_STATUSES.has(workout.status) &&
    workout.plan &&
    typeof workout.plan.name === 'string' &&
    workout.plan.name.trim() &&
    Array.isArray(workout.plan.exercises) &&
    workout.plan.exercises.some((exercise) => Boolean(
      exercise &&
      typeof exercise === 'object' &&
      typeof exercise.id === 'string' &&
      exercise.id.trim() &&
      typeof exercise.name === 'string' &&
      exercise.name.trim()
    ))
  );
}

export async function initStrengthWorkoutTables(): Promise<void> {
  const db = await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tailored_strength_workouts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      scheduled_day TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      answers_json TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      completed_exercise_ids_json TEXT NOT NULL DEFAULT '[]',
      actual_minutes INTEGER,
      calories INTEGER,
      calories_source TEXT,
      difficulty TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_strength_user_day ON tailored_strength_workouts(user_id, scheduled_day);
  `);
}

export async function saveStrengthWorkout(input: Pick<StrengthWorkout, 'id' | 'userId' | 'scheduledDay' | 'answers' | 'plan'>): Promise<void> {
  await initStrengthWorkoutTables();
  const db = await getDb();
  await db.run(`INSERT INTO tailored_strength_workouts
    (id, user_id, scheduled_day, status, answers_json, plan_json, updated_at)
    VALUES (?, ?, ?, 'planned', ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET scheduled_day=excluded.scheduled_day, answers_json=excluded.answers_json,
      plan_json=excluded.plan_json, updated_at=datetime('now')`,
    [input.id, input.userId, input.scheduledDay, JSON.stringify(input.answers), JSON.stringify(input.plan)]);
  window.dispatchEvent(new CustomEvent('strength-workout:changed'));
}

export async function updateStrengthWorkout(id: string, patch: Partial<Pick<StrengthWorkout, 'status' | 'startedAt' | 'completedAt' | 'completedExerciseIds' | 'actualMinutes' | 'calories' | 'caloriesSource' | 'difficulty'>>): Promise<void> {
  await initStrengthWorkoutTables();
  const current = await getStrengthWorkout(id);
  if (!current) return;
  const next = { ...current, ...patch };
  const db = await getDb();
  await db.run(`UPDATE tailored_strength_workouts SET status=?, started_at=?, completed_at=?,
    completed_exercise_ids_json=?, actual_minutes=?, calories=?, calories_source=?, difficulty=?, updated_at=datetime('now') WHERE id=?`,
    [next.status, next.startedAt, next.completedAt, JSON.stringify(next.completedExerciseIds), next.actualMinutes,
      next.calories, next.caloriesSource, next.difficulty, id]);
  window.dispatchEvent(new CustomEvent('strength-workout:changed'));
}

export async function getStrengthWorkout(id: string): Promise<StrengthWorkout | null> {
  await initStrengthWorkoutTables();
  const db = await getDb();
  const result = await db.query(`SELECT * FROM tailored_strength_workouts WHERE id=? LIMIT 1`, [id]);
  const row = rows(result.values)[0];
  return row ? mapWorkout(row) : null;
}

export async function listStrengthWorkouts(userId: string, fromDay?: string, toDay?: string): Promise<StrengthWorkout[]> {
  await initStrengthWorkoutTables();
  const db = await getDb();
  const clauses = ['user_id=?'];
  const params: unknown[] = [userId];
  if (fromDay) { clauses.push('scheduled_day>=?'); params.push(fromDay); }
  if (toDay) { clauses.push('scheduled_day<=?'); params.push(toDay); }
  const result = await db.query(`SELECT * FROM tailored_strength_workouts WHERE ${clauses.join(' AND ')} ORDER BY scheduled_day DESC, created_at DESC`, params);
  return rows(result.values).map(mapWorkout);
}

export async function getLatestStrengthWorkout(userId: string): Promise<StrengthWorkout | null> {
  const workouts = await listStrengthWorkouts(userId);
  return workouts[0] ?? null;
}

export async function getLatestValidStrengthWorkout(userId: string): Promise<StrengthWorkout | null> {
  const workouts = await listStrengthWorkouts(userId);
  return workouts.find(isValidStrengthWorkout) ?? null;
}

export function strengthWorkoutSummary(workouts: StrengthWorkout[]) {
  const completed = workouts.filter((w) => w.status === 'completed' || w.status === 'partial');
  return {
    planned: workouts.length,
    completed: completed.filter((w) => w.status === 'completed').length,
    partial: completed.filter((w) => w.status === 'partial').length,
    minutes: completed.reduce((sum, w) => sum + (w.actualMinutes ?? 0), 0),
    calories: completed.reduce((sum, w) => sum + (w.calories ?? 0), 0),
  };
}
