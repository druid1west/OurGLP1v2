// src/lib/rcSync.ts
export type RcCache = {
  entitlementPro: 'active' | 'inactive';
  isSandbox?: boolean;
  expiration?: string;
  latestPurchase?: string;
};

const PRO_PRODUCT_IDS = [
  'com.ourglp1.app.pro.monthly',
  'com.ourglp1.app.pro.yearly',
  'ourglp1.auto.renew.monthy',
  'ourglp1.auto.renew.yearly',
  'go.pro.auto.renew.monthly',
] as const;

function getString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function writeRcCacheFromCustomerInfo(info: unknown): RcCache {
  const o = (info ?? {}) as Record<string, unknown>;

  const entContainer =
    (o.entitlements as Record<string, unknown> | undefined) ??
    (o['subscriber'] as Record<string, unknown> | undefined);

  const entAll = entContainer && (entContainer['all'] as Record<string, unknown> | undefined);
  const entActive =
    (entContainer && (entContainer['active'] as Record<string, unknown> | undefined)) ??
    (entContainer && (entContainer['activeEntitlements'] as Record<string, unknown> | undefined));

  const proActive =
    (entActive && (('pro' in entActive) || ('Pro' in entActive))) || false;

  const purchased = (o['allPurchasedProductIdentifiers'] as string[] | undefined) ?? [];
  const allExp = (o['allExpirationDates'] as Record<string, string | null> | undefined) ?? {};
  const ownsPro = PRO_PRODUCT_IDS.some((pid) => purchased.includes(pid));
  const notExpired = PRO_PRODUCT_IDS.some((pid) => {
    const exp = allExp[pid];
    if (!exp) return true;
    const t = Date.parse(exp);
    return Number.isFinite(t) && t > Date.now();
  });

  const entitlementProActive = Boolean(proActive || (ownsPro && notExpired));

  const entProObj =
    (entAll && (entAll['pro'] as Record<string, unknown> | undefined)) ?? undefined;

  const expiration =
    getString(entProObj?.['expiresDate']) ??
    getString(entProObj?.['expirationDate']) ??
    ((): string | undefined => {
      for (const pid of PRO_PRODUCT_IDS) {
        const exp = allExp[pid];
        if (typeof exp === 'string') return exp;
      }
      return undefined;
    })();

  const latestPurchase =
    getString(entProObj?.['latestPurchaseDate']) ??
    getString(entProObj?.['purchaseDate']) ??
    getString(o['originalPurchaseDate']);

  const isSandbox =
    (typeof o['isSandbox'] === 'boolean' ? (o['isSandbox'] as boolean) : undefined) ??
    (typeof entProObj?.['isSandbox'] === 'boolean' ? (entProObj['isSandbox'] as boolean) : undefined);

  const cache: RcCache = {
    entitlementPro: entitlementProActive ? 'active' : 'inactive',
    isSandbox,
    expiration,
    latestPurchase,
  };

  try {
    localStorage.setItem('rc_entitlement_pro', cache.entitlementPro);
    if (typeof cache.isSandbox === 'boolean') localStorage.setItem('rc_is_sandbox', String(cache.isSandbox));
    if (cache.expiration) localStorage.setItem('rc_expiration', cache.expiration);
    if (cache.latestPurchase) localStorage.setItem('rc_latest_purchase', cache.latestPurchase);
  } catch {
    /* ignore */
  }

  return cache;
}
