// src/db/EntitlementRepository.ts
import { getDb } from '../db/sqlite';

export type Entitlements = {
  has_pro: boolean;
  pro_until: string | null;          // ISO string or null
  subscription_tier: 'free' | 'pro' | null;
};

export async function getEntitlements(userId: string): Promise<Entitlements> {
  const db = await getDb();
  const res = await db.query(
    `SELECT has_pro, pro_until, subscription_tier FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const row = (res.values ?? [])[0] as
    | { has_pro?: number | null; pro_until?: string | null; subscription_tier?: string | null }
    | undefined;

  return {
    has_pro: !!(row?.has_pro ?? 0),
    pro_until: row?.pro_until ?? null,
    subscription_tier: (row?.subscription_tier as Entitlements['subscription_tier']) ?? null,
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