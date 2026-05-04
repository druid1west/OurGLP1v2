// File: src/db/EffectivenessRepositroy.ts
import { getDb } from './sqlite';

export type Glp1ExperienceLog = {
  id: number;
  user_id: string;
  recorded_at: string;
  local_day: string;
  hunger: number;
  nausea: number;
  note?: string | null;
  created_at: string;
};

type QueryRow = Record<string, unknown>;
type QueryResult = { values?: unknown[] } | null | undefined;

function rows(result: QueryResult): QueryRow[] {
  const values = result?.values;
  if (!values || values.length === 0) return [];

  if (Array.isArray(values[0]) && values.length >= 2 && Array.isArray(values[1])) {
    const cols = values[0] as string[];
    return (values.slice(1) as unknown[][]).map((arr) => {
      const row: QueryRow = {};
      cols.forEach((col, index) => {
        row[col] = arr[index];
      });
      return row;
    });
  }

  if (
    typeof values[0] === 'object' &&
    values[0] !== null &&
    'ios_columns' in (values[0] as QueryRow)
  ) {
    const cols = (values[0] as { ios_columns: string[] }).ios_columns;
    return values
      .slice(1)
      .filter((row): row is QueryRow => typeof row === 'object' && row !== null && !Array.isArray(row))
      .map((rowObj) => {
        const row: QueryRow = {};
        cols.forEach((col) => {
          row[col] = Object.prototype.hasOwnProperty.call(rowObj, col) ? rowObj[col] : undefined;
        });
        return row;
      });
  }

  return values.filter(
    (row): row is QueryRow => typeof row === 'object' && row !== null && !Array.isArray(row)
  );
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function optionalStr(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapLog(row: QueryRow): Glp1ExperienceLog {
  return {
    id: num(row.id),
    user_id: str(row.user_id),
    recorded_at: str(row.recorded_at),
    local_day: str(row.local_day),
    hunger: num(row.hunger),
    nausea: num(row.nausea),
    note: optionalStr(row.note),
    created_at: str(row.created_at),
  };
}

export async function insertGlp1ExperienceLog(input: {
  userId: string;
  recordedAt: string; // UTC ISO
  localDay: string;   // YYYY-MM-DD (user TZ)
  hunger: number;     // 1–10
  nausea: number;     // 0–10
  note?: string;
}): Promise<void> {
  const db = await getDb();
  await db.run(
    `
    INSERT INTO glp1_experience_logs
      (user_id, recorded_at, local_day, hunger, nausea, note)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      input.userId,
      input.recordedAt,
      input.localDay,
      input.hunger,
      input.nausea,
      input.note ?? null,
    ]
  );
}

export async function listGlp1ExperienceRange(
  userId: string,
  fromLocalDay: string,
  toLocalDay: string
): Promise<Glp1ExperienceLog[]> {
  const db = await getDb();
  const res = await db.query(
    `
    SELECT *
    FROM glp1_experience_logs
    WHERE user_id = ?
      AND local_day BETWEEN ? AND ?
    ORDER BY recorded_at ASC
    `,
    [userId, fromLocalDay, toLocalDay]
  );

  return rows(res).map(mapLog).filter((row) => row.id > 0 && row.recorded_at);
}
export async function deleteGlp1ExperienceLog(id: number): Promise<void> {
const db = await getDb();
await db.run(
`DELETE FROM glp1_experience_logs WHERE id = ?`,
[id]
);
}
// ────────────────────────────────────────────────────────────────
// Graph helper (last N days, oldest → newest)
// ────────────────────────────────────────────────────────────────

export type Glp1GraphPoint = {
  recordedAt: string;
  hunger: number;
  nausea: number;
};

export async function listGlp1ExperienceForGraph(
  userId: string,
  days = 14
): Promise<Glp1GraphPoint[]> {
  const today = new Date();
  const toLocalDay = today.toISOString().slice(0, 10);

  const from = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const fromLocalDay = from.toISOString().slice(0, 10);

  const rows = await listGlp1ExperienceRange(
    userId,
    fromLocalDay,
    toLocalDay
  );

  return rows.map((r) => ({
    recordedAt: r.recorded_at,
    hunger: r.hunger,
    nausea: r.nausea,
  }));
}
