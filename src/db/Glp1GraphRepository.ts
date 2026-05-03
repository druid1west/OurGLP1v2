// src/db/Glp1GraphRepository.ts
import { getDb } from './sqlite';

type RunChanges = { lastId?: number; changes?: number };
type RunResult = { changes?: RunChanges };
type QueryResult<T = unknown> = { values?: T[] };

type DB = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
  run: (sql: string, params?: unknown[]) => Promise<RunResult>;
};

export type Glp1GraphArchiveRow = {
  id: number;
  user_id: string;
  timezone: string;
  injection_day: string;
  from_date: string;
  to_date: string;
  archived_at: string;
  chart_uri: string | null;   // <-- CHANGED
  chart_png: string | null;
  data_json: string | null;
  created_at: string;
};

function getLastIdFromRun(r: RunResult | undefined): number | null {
  const id = r?.changes?.lastId;
  return typeof id === 'number' ? id : null;
}

async function getLastInsertRowId(db: DB): Promise<number> {
  const q = await db.query<{ id: number }>('SELECT last_insert_rowid() AS id');
  const v = q.values?.[0]?.id;
  return typeof v === 'number' ? v : 0;
}

async function getDbInit(): Promise<DB> {
  const db = (await getDb()) as DB;
  return db;
}

export async function saveGlp1GraphArchive(
  userId: string,
  timezone: string,
  injectionDay: string,
  fromDate: string,
  toDate: string,
  chartUri: string,          // <-- CHANGED
  dataJson: string
): Promise<number> {
  const db = await getDbInit();

  const r = await db.run(
    `INSERT INTO glp1_graph_archive
     (user_id, timezone, injection_day, from_date, to_date, chart_uri, data_json, archived_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [userId, timezone, injectionDay, fromDate, toDate, chartUri, dataJson]
  );

  const fromRun = getLastIdFromRun(r);
  return fromRun !== null ? fromRun : await getLastInsertRowId(db);
}

export async function listGlp1GraphArchive(
  userId: string,
  limit = 50
): Promise<Glp1GraphArchiveRow[]> {
  const db = await getDbInit();
  const res = await db.query<Glp1GraphArchiveRow>(
    `SELECT * FROM glp1_graph_archive
     WHERE user_id = ?
     ORDER BY archived_at DESC
     LIMIT ?`,
    [userId, limit]
  );

  return res.values ?? [];
}

export async function getGlp1GraphArchive(id: number): Promise<Glp1GraphArchiveRow | null> {
  const db = await getDbInit();
  const res = await db.query<Glp1GraphArchiveRow>(
    `SELECT * FROM glp1_graph_archive WHERE id = ? LIMIT 1`,
    [id]
  );

  return res.values?.[0] ?? null;
}

export async function deleteGlp1GraphArchive(id: number): Promise<void> {
  const db = await getDbInit();
  await db.run(`DELETE FROM glp1_graph_archive WHERE id = ?`, [id]);
}

export function glp1GraphArchiveFilename(fromDate: string, toDate: string): string {
  const from = fromDate.split('T')[0];
  const to = toDate.split('T')[0];
  return `glp1-graph-${from}_${to}`;
}
