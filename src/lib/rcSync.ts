// src/lib/rcSync.ts
import type { CustomerInfo } from '@revenuecat/purchases-capacitor';
import { getDb } from '@/db/sqlite';
import { getLocalCurrentUser } from '@/services/localAuth';
import { logger } from '@/utils/logger';

export type RcCache = {
  entitlementPro: 'active' | 'inactive';
  isSandbox?: boolean;
  expiration?: string;
  latestPurchase?: string;
  productId?: string;
};

const PRO_PRODUCT_IDS = [
  'com.ourglp1.app.pro.monthly',
  'com.ourglp1.app.pro.yearly',
  'ourglp1.auto.renew.monthy',
  'ourglp1.auto.renew.yearly',
  'go.pro.auto.renew.monthly',
] as const;

const PRO_ENTITLEMENT_IDS = ['pro', 'ourglp1_pro', 'Pro'] as const;

function getString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function getRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function getStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string') : [];
}

function getEntitlementObject(
  entitlements: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!entitlements) return undefined;
  for (const id of PRO_ENTITLEMENT_IDS) {
    const ent = getRecord(entitlements[id]);
    if (ent) return ent;
  }
  const first = Object.values(entitlements).map(getRecord).find(Boolean);
  return first;
}

function getProductExpiration(
  allExpirationDates: Record<string, unknown>,
  productId: string | undefined,
): string | undefined {
  if (productId) {
    const exp = getString(allExpirationDates[productId]);
    if (exp) return exp;
  }
  for (const pid of PRO_PRODUCT_IDS) {
    const exp = getString(allExpirationDates[pid]);
    if (exp) return exp;
  }
  return undefined;
}

function isFuture(value: string | undefined): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > Date.now();
}

export type RevenueCatEntitlementSnapshot = {
  active: boolean;
  productId: string | null;
  expiresAt: string | null;
  latestPurchase: string | null;
  isSandbox?: boolean;
};

export function deriveEntitlementFromCustomerInfo(info: unknown): RevenueCatEntitlementSnapshot {
  const o = (info ?? {}) as Record<string, unknown>;
  const entContainer = getRecord(o.entitlements) ?? getRecord(o.subscriber);
  const entActive = getRecord(entContainer?.active) ?? getRecord(entContainer?.activeEntitlements);
  const entAll = getRecord(entContainer?.all);
  const activeEnt = getEntitlementObject(entActive);
  const allEnt = getEntitlementObject(entAll);
  const entObj = activeEnt ?? allEnt;

  const activeSubscriptions = getStringArray(o.activeSubscriptions);
  const purchased = getStringArray(o.allPurchasedProductIdentifiers);
  const allExpirationDates = getRecord(o.allExpirationDates) ?? {};

  const productId =
    getString(entObj?.productIdentifier) ??
    getString(entObj?.productId) ??
    activeSubscriptions.find((pid) => PRO_PRODUCT_IDS.includes(pid as (typeof PRO_PRODUCT_IDS)[number])) ??
    purchased.find((pid) => PRO_PRODUCT_IDS.includes(pid as (typeof PRO_PRODUCT_IDS)[number])) ??
    null;

  const expiresAt =
    getString(entObj?.expirationDate) ??
    getString(entObj?.expiresDate) ??
    getProductExpiration(allExpirationDates, productId ?? undefined) ??
    getString(o.latestExpirationDate) ??
    null;

  const latestPurchase =
    getString(entObj?.latestPurchaseDate) ??
    getString(entObj?.purchaseDate) ??
    getString(o.originalPurchaseDate) ??
    null;

  const isSandbox =
    (typeof o.isSandbox === 'boolean' ? o.isSandbox : undefined) ??
    (typeof entObj?.isSandbox === 'boolean' ? entObj.isSandbox : undefined);

  const hasActiveEntitlement = Boolean(activeEnt);
  const hasActiveProSubscription = activeSubscriptions.some((pid) =>
    PRO_PRODUCT_IDS.includes(pid as (typeof PRO_PRODUCT_IDS)[number]),
  );

  return {
    active: Boolean(hasActiveEntitlement || hasActiveProSubscription || isFuture(expiresAt ?? undefined)),
    productId,
    expiresAt,
    latestPurchase,
    isSandbox,
  };
}

export function writeRcCacheFromCustomerInfo(info: unknown): RcCache {
  const snapshot = deriveEntitlementFromCustomerInfo(info);

  const cache: RcCache = {
    entitlementPro: snapshot.active ? 'active' : 'inactive',
    isSandbox: snapshot.isSandbox,
    expiration: snapshot.expiresAt ?? undefined,
    latestPurchase: snapshot.latestPurchase ?? undefined,
    productId: snapshot.productId ?? undefined,
  };

  try {
    localStorage.setItem('rc_entitlement_pro', cache.entitlementPro);
    if (typeof cache.isSandbox === 'boolean') localStorage.setItem('rc_is_sandbox', String(cache.isSandbox));
    if (cache.expiration) localStorage.setItem('rc_expiration', cache.expiration);
    if (cache.latestPurchase) localStorage.setItem('rc_latest_purchase', cache.latestPurchase);
    if (cache.productId) localStorage.setItem('rc_product_id', cache.productId);
  } catch {
    /* ignore */
  }

  return cache;
}

export async function syncLocalEntitlementFromCustomerInfo(
  userId: string,
  info: CustomerInfo | unknown,
  options: { emitEvents?: boolean } = {},
): Promise<RevenueCatEntitlementSnapshot> {
  const snapshot = deriveEntitlementFromCustomerInfo(info);
  const db = await getDb();
  const now = new Date().toISOString();

  await db.run(
    `
    UPDATE users
    SET has_pro = ?,
        subscription_tier = ?,
        pro_until = ?,
        subscription_product_id = ?,
        entitlement_source = 'revenuecat',
        entitlement_synced_at = ?,
        updated_at = datetime('now')
    WHERE id = ?
    `,
    [
      snapshot.active ? 1 : 0,
      snapshot.active ? 'pro' : 'free',
      snapshot.expiresAt,
      snapshot.productId,
      now,
      userId,
    ],
  );

  writeRcCacheFromCustomerInfo(info);
  if (options.emitEvents !== false) {
    window.dispatchEvent(new Event('billing:changed'));
    window.dispatchEvent(new Event('rc:customerInfoChanged'));
  }

  return snapshot;
}

export async function syncCurrentUserEntitlementFromCustomerInfo(
  info: CustomerInfo | unknown,
  options: { emitEvents?: boolean } = {},
): Promise<RevenueCatEntitlementSnapshot | null> {
  const user = await getLocalCurrentUser();
  if (!user?.id) {
    writeRcCacheFromCustomerInfo(info);
    return null;
  }
  return syncLocalEntitlementFromCustomerInfo(user.id, info, options);
}

export async function refreshCurrentUserEntitlementFromRevenueCat(): Promise<RevenueCatEntitlementSnapshot | null> {
  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const info = await Purchases.getCustomerInfo();
    return await syncCurrentUserEntitlementFromCustomerInfo(info);
  } catch (err) {
    logger.warn('[RC] entitlement refresh failed', {
      msg: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
