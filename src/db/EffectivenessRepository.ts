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

  return (res.values ?? []) as Glp1ExperienceLog[];
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