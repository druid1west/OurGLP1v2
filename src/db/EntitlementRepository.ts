// src/db/EntitlementRepository.ts
import { getDb } from '../db/sqlite';

export type Entitlements = {
  has_pro: boolean;
  pro_until: string | null;          // ISO string or null
  subscription_tier: 'free' | 'pro' | null;
};

type QueryRow = Record<string, unknown>;
type QueryResult = { values?: unknown[] } | null | undefined;

function firstRow(result: QueryResult): QueryRow | null {
  const values = result?.values;
  if (!values || values.length === 0) return null;

  if (Array.isArray(values[0]) && values.length >= 2 && Array.isArray(values[1])) {
    const cols = values[0] as string[];
    const rowValues = values[1] as unknown[];
    const row: QueryRow = {};
    cols.forEach((col, index) => {
      row[col] = rowValues[index];
    });
    return row;
  }

  if (
    typeof values[0] === 'object' &&
    values[0] !== null &&
    'ios_columns' in (values[0] as QueryRow)
  ) {
    const cols = (values[0] as { ios_columns: string[] }).ios_columns;
    const rowObj = values[1];
    if (!rowObj || typeof rowObj !== 'object' || Array.isArray(rowObj)) return null;
    const source = rowObj as QueryRow;
    const row: QueryRow = {};
    cols.forEach((col) => {
      row[col] = Object.prototype.hasOwnProperty.call(source, col) ? source[col] : undefined;
    });
    return row;
  }

  const row = values[0];
  return row && typeof row === 'object' && !Array.isArray(row) ? (row as QueryRow) : null;
}

export async function getEntitlements(userId: string): Promise<Entitlements> {
  const db = await getDb();
  const res = await db.query(
    `SELECT has_pro, pro_until, subscription_tier FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const row = firstRow(res);

  return {
    has_pro: Number(row?.has_pro ?? 0) === 1,
    pro_until: typeof row?.pro_until === 'string' ? row.pro_until : null,
    subscription_tier:
      row?.subscription_tier === 'free' || row?.subscription_tier === 'pro'
        ? row.subscription_tier
        : null,
  };
}

export async function setEntitlements(userId: string, e: Partial<Entitlements>): Promise<void> {
  const db = await getDb();
  await db.run(
    `
    UPDATE users
      SET has_pro = COALESCE(?, has_pro),
          pro_until = COALESCE(?, pro_until),
          subscription_tier = COALESCE(?, subscription_tier),
          updated_at = datetime('now')
    WHERE id = ?
  `,
    [
      e.has_pro === undefined ? null : (e.has_pro ? 1 : 0),
      e.pro_until ?? null,
      e.subscription_tier ?? null,
      userId,
    ]
  );
}

export function isProNow(e: Entitlements): boolean {
  const now = Date.now();
  const until = e.pro_until ? new Date(e.pro_until).getTime() : 0;
  return e.has_pro || e.subscription_tier === 'pro' || (until > now);
}
