import { getDb } from './sqlite';
import { logMood } from './HealthRepository';
import { emitHealthChanged } from '@/services/healthBus';

export type WeightUnit = 'kg' | 'st-lb';
export type HeightUnit = 'cm' | 'ft-in';
export type CoachCheckinFrequency = 'morning' | 'evening' | 'morning_evening' | 'flexible' | 'off';

export type CoachProfile = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  country: string | null;
  postcode: string | null;
  height: number | null;
  weight: number | null;
  start_weight: number | null;
  goal_weight: number | null;
  bmi: number | null;
  weight_unit: WeightUnit;
  height_unit: HeightUnit;
  glp1_status: string | null;
  glp1_start_date: string | null;
  medication_name: string | null;
  medication_dose: string | null;
  injection_day: string | null;
  injection_time: string | null;
  fasting_schedule: string | null;
  fasting_start: string | null;
  main_reason: string | null;
  biggest_challenge: string | null;
  main_concerns_json: string | null;
  coach_onboarding_completed_at: string | null;
  coach_checkin_frequency: CoachCheckinFrequency;
  monthly_anchor_day: number | null;
  monthly_dose_count: number;
};

export type CoachProfilePatch = Partial<Omit<CoachProfile, 'user_id'>>;

export type CoachCheckinInput = {
  user_id: string;
  mood_score: number;
  energy_score: number;
  appetite_score: number;
  nausea_score?: number | null;
  hydration_status?: string | null;
  protein_status?: string | null;
  bowel_status?: string | null;
  cravings_status?: string | null;
  note?: string | null;
};

type Row = Record<string, unknown>;

function firstRow(values?: unknown[] | null): Row | null {
  if (!values || values.length === 0) return null;
  if (Array.isArray(values[0]) && values.length >= 2 && Array.isArray(values[1])) {
    const cols = values[0] as string[];
    const row = values[1] as unknown[];
    return Object.fromEntries(cols.map((col, index) => [col, row[index]]));
  }
  if (typeof values[0] === 'object' && values[0] !== null && 'ios_columns' in values[0]) {
    const cols = (values[0] as { ios_columns: string[] }).ios_columns;
    const row = values[1] as Row | undefined;
    if (!row) return null;
    return Object.fromEntries(cols.map((col) => [col, row[col]]));
  }
  if (typeof values[0] === 'object' && values[0] !== null) return values[0] as Row;
  return null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeWeightUnit(value: unknown): WeightUnit {
  return value === 'st-lb' ? 'st-lb' : 'kg';
}

function normalizeHeightUnit(value: unknown): HeightUnit {
  return value === 'ft-in' ? 'ft-in' : 'cm';
}

function normalizeCheckinFrequency(value: unknown): CoachCheckinFrequency {
  if (
    value === 'morning' ||
    value === 'evening' ||
    value === 'morning_evening' ||
    value === 'flexible' ||
    value === 'off'
  ) {
    return value;
  }
  return 'morning_evening';
}

function mapProfile(row: Row, userId: string): CoachProfile {
  return {
    user_id: userId,
    first_name: stringOrNull(row.first_name),
    last_name: stringOrNull(row.last_name),
    date_of_birth: stringOrNull(row.date_of_birth),
    address1: stringOrNull(row.address1),
    address2: stringOrNull(row.address2),
    city: stringOrNull(row.city),
    country: stringOrNull(row.country),
    postcode: stringOrNull(row.postcode),
    height: numberOrNull(row.height),
    weight: numberOrNull(row.weight),
    start_weight: numberOrNull(row.start_weight),
    goal_weight: numberOrNull(row.goal_weight),
    bmi: numberOrNull(row.bmi),
    weight_unit: normalizeWeightUnit(row.weight_unit),
    height_unit: normalizeHeightUnit(row.height_unit),
    glp1_status: stringOrNull(row.glp1_status),
    glp1_start_date: stringOrNull(row.glp1_start_date),
    medication_name: stringOrNull(row.medication_name),
    medication_dose: stringOrNull(row.medication_dose),
    injection_day: stringOrNull(row.injection_day),
    injection_time: stringOrNull(row.injection_time),
    fasting_schedule: stringOrNull(row.fasting_schedule),
    fasting_start: stringOrNull(row.fasting_start),
    main_reason: stringOrNull(row.main_reason),
    biggest_challenge: stringOrNull(row.biggest_challenge),
    main_concerns_json: stringOrNull(row.main_concerns_json),
    coach_onboarding_completed_at: stringOrNull(row.coach_onboarding_completed_at),
    coach_checkin_frequency: normalizeCheckinFrequency(row.coach_checkin_frequency),
    monthly_anchor_day: numberOrNull(row.monthly_anchor_day),
    monthly_dose_count: numberOrNull(row.monthly_dose_count) ?? 4,
  };
}

export function calculateBmi(heightCm: number | null, weightKg: number | null): number | null {
  if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) return null;
  const meters = heightCm / 100;
  const bmi = weightKg / (meters * meters);
  return Number.isFinite(bmi) ? Number(bmi.toFixed(1)) : null;
}

export function stonesPoundsToKg(stones: number, pounds: number): number {
  return Number(((stones * 14 + pounds) * 0.45359237).toFixed(1));
}

export function feetInchesToCm(feet: number, inches: number): number {
  return Number(((feet * 12 + inches) * 2.54).toFixed(1));
}

async function ensureLocalProfileRow(userId: string): Promise<void> {
  const db = await getDb();
  await db.run(
    `
    INSERT OR IGNORE INTO user_profile (id, user_id, timezone, created_at, updated_at)
    VALUES (1, ?, 'UTC', datetime('now'), datetime('now'))
    `,
    [userId]
  );
}

export async function getCoachProfile(userId: string): Promise<CoachProfile> {
  await ensureLocalProfileRow(userId);
  const db = await getDb();
  const res = await db.query(
    `
    SELECT first_name, last_name, date_of_birth, address1, address2, city, country, postcode,
           height, weight, start_weight, goal_weight, bmi, weight_unit, height_unit,
           glp1_status, glp1_start_date, medication_name, medication_dose, injection_day,
           injection_time, fasting_schedule, fasting_start,
           main_reason, biggest_challenge, main_concerns_json,
           coach_onboarding_completed_at, coach_checkin_frequency,
           monthly_anchor_day, monthly_dose_count
      FROM user_profile
     WHERE id = 1
     LIMIT 1
    `
  );
  return mapProfile(firstRow(res.values) ?? {}, userId);
}

export async function patchCoachProfile(userId: string, patch: CoachProfilePatch): Promise<CoachProfile> {
  await ensureLocalProfileRow(userId);
  const current = await getCoachProfile(userId);
  const merged: CoachProfile = {
    ...current,
    ...patch,
    user_id: userId,
  };
  const bmi = calculateBmi(merged.height, merged.weight);
  merged.bmi = bmi ?? merged.bmi;

  const db = await getDb();
  const values = [
    merged.first_name,
    merged.last_name,
    merged.date_of_birth,
    merged.address1,
    merged.address2,
    merged.city,
    merged.country,
    merged.postcode,
    merged.height,
    merged.weight,
    merged.start_weight,
    merged.goal_weight,
    merged.bmi,
    merged.weight_unit,
    merged.height_unit,
    merged.glp1_status,
    merged.glp1_start_date,
    merged.medication_name,
    merged.medication_dose,
    merged.injection_day,
    merged.injection_time,
    merged.fasting_schedule,
    merged.fasting_start,
    merged.main_reason,
    merged.biggest_challenge,
    merged.main_concerns_json,
    merged.coach_onboarding_completed_at,
    merged.coach_checkin_frequency,
    merged.monthly_anchor_day,
    merged.monthly_dose_count,
  ];

  await db.run(
    `
    UPDATE user_profile
       SET first_name = ?, last_name = ?, date_of_birth = ?, address1 = ?, address2 = ?,
           city = ?, country = ?, postcode = ?, height = ?, weight = ?, start_weight = ?,
           goal_weight = ?, bmi = ?, weight_unit = ?, height_unit = ?, glp1_status = ?,
           glp1_start_date = ?, medication_name = ?, medication_dose = ?, injection_day = ?,
           injection_time = ?, fasting_schedule = ?, fasting_start = ?,
           main_reason = ?, biggest_challenge = ?, main_concerns_json = ?,
           coach_onboarding_completed_at = ?, coach_checkin_frequency = ?,
           monthly_anchor_day = ?, monthly_dose_count = ?,
           updated_at = datetime('now')
     WHERE id = 1
    `,
    values
  );

  await db.run(
    `
    UPDATE users
       SET first_name = COALESCE(?, first_name),
           last_name = COALESCE(?, last_name),
           date_of_birth = COALESCE(?, date_of_birth),
           address1 = COALESCE(?, address1),
           address2 = COALESCE(?, address2),
           city = COALESCE(?, city),
           country = COALESCE(?, country),
           postcode = COALESCE(?, postcode),
           height = COALESCE(?, height),
           weight = COALESCE(?, weight),
           start_weight = COALESCE(?, start_weight),
           goal_weight = COALESCE(?, goal_weight),
           bmi = COALESCE(?, bmi),
           weight_unit = COALESCE(?, weight_unit),
           height_unit = COALESCE(?, height_unit),
           glp1_status = COALESCE(?, glp1_status),
           glp1_start_date = COALESCE(?, glp1_start_date),
           medication_name = COALESCE(?, medication_name),
           medication_dose = COALESCE(?, medication_dose),
           injection_day = COALESCE(?, injection_day),
           injection_time = COALESCE(?, injection_time),
           fasting_schedule = COALESCE(?, fasting_schedule),
           fasting_start = COALESCE(?, fasting_start),
           main_reason = COALESCE(?, main_reason),
           biggest_challenge = COALESCE(?, biggest_challenge),
           main_concerns_json = COALESCE(?, main_concerns_json),
           coach_onboarding_completed_at = COALESCE(?, coach_onboarding_completed_at),
           coach_checkin_frequency = COALESCE(?, coach_checkin_frequency),
           monthly_anchor_day = COALESCE(?, monthly_anchor_day),
           monthly_dose_count = COALESCE(?, monthly_dose_count),
           updated_at = datetime('now')
     WHERE id = ?
    `,
    [...values, userId]
  );

  window.dispatchEvent(new Event('profile:saved'));
  return getCoachProfile(userId);
}

function localYmd(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function clampScore(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number(value) || min)));
}

export async function insertCoachCheckin(input: CoachCheckinInput): Promise<void> {
  const db = await getDb();
  const now = new Date();
  const recordedAt = now.toISOString();
  const mood = clampScore(input.mood_score, 1, 5);

  await db.run(
    `
    INSERT INTO coach_checkins (
      user_id, recorded_at, local_day, source, mood_score, energy_score, appetite_score,
      nausea_score, hydration_status, protein_status, bowel_status, cravings_status, note
    )
    VALUES (?, ?, ?, 'coach', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.user_id,
      recordedAt,
      localYmd(now),
      mood,
      clampScore(input.energy_score, 1, 5),
      clampScore(input.appetite_score, 1, 5),
      input.nausea_score == null ? null : clampScore(input.nausea_score, 0, 5),
      input.hydration_status ?? null,
      input.protein_status ?? null,
      input.bowel_status ?? null,
      input.cravings_status ?? null,
      input.note ?? null,
    ]
  );

  await logMood(mood, recordedAt);
  emitHealthChanged('mood');
}
