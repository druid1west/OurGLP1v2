// src/lib/purchasesInit.ts
import { Capacitor } from '@capacitor/core';
import {
  Purchases,
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOfferings,
  type PurchasesPackage,
} from '@revenuecat/purchases-capacitor';
import { logger } from '../utils/logger';
import { deriveEntitlementFromCustomerInfo } from './rcSync';

const rcLog = logger.child('RC');

// RC platform keys
const RC_IOS_KEY = import.meta.env.VITE_RC_IOS_KEY ?? '';
const RC_ANDROID_KEY = import.meta.env.VITE_RC_ANDROID_KEY ?? ''; // future Android

// iOS product IDs (CSV -> string[])
const IOS_PRODUCT_IDS: string[] = String(
  import.meta.env.VITE_IOS_PRODUCT_IDS ??
    import.meta.env.VITE_IOS_PRODUCT_ID ??
    'com.ourglp1.app.pro.monthly,com.ourglp1.app.pro.yearly'
)
  .split(',')
  .map((s: string) => s.trim())
  .filter((s: string) => s.length > 0);

// Android product IDs (CSV -> string[])
const ANDROID_PRODUCT_IDS: string[] = String(
  import.meta.env.VITE_ANDROID_PRODUCT_IDS ??
    import.meta.env.VITE_ANDROID_PRODUCT_ID ??
    'com.ourglp1.app.pro.monthly,com.ourglp1.app.pro.yearly'
)
  .split(',')
  .map((s: string) => s.trim())
  .filter((s: string) => s.length > 0);

let configured = false;
let listenerAttached = false;

/* ---------------------------
   Local minimal types / guards
----------------------------*/

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}

function isCustomerInfo(v: unknown): v is CustomerInfo {
  return (
    isObject(v) &&
    (
      'allPurchasedProductIdentifiers' in v ||
      'activeSubscriptions' in v ||
      'latestExpirationDate' in v ||
      'subscriptionsByProductIdentifier' in v
    )
  );
}

function unwrapCustomerInfo(payload: unknown): CustomerInfo | null {
  if (isObject(payload) && 'customerInfo' in payload) {
    const ci = (payload as { customerInfo: unknown }).customerInfo;
    return isCustomerInfo(ci) ? ci : null;
  }
  return isCustomerInfo(payload) ? payload : null;
}

/* ---------------------------
   Utilities
----------------------------*/

type StoreProductLike = { priceString?: string; title?: string; identifier?: string };
type WithStoreProduct = { storeProduct?: StoreProductLike };
type WithLegacyProduct = { product?: StoreProductLike };

function priceFromPackage(pkg: PurchasesPackage): string | null {
  const sp = (pkg as unknown as WithStoreProduct).storeProduct;
  if (sp && typeof sp.priceString === 'string' && sp.priceString.trim().length > 0) {
    return sp.priceString;
  }
  const legacy = (pkg as unknown as WithLegacyProduct).product;
  if (legacy && typeof legacy.priceString === 'string' && legacy.priceString.trim().length > 0) {
    return legacy.priceString;
  }
  return null;
}

function identifierFromPackage(pkg: PurchasesPackage): string | null {
  const sp = (pkg as unknown as WithStoreProduct).storeProduct;
  if (sp && typeof sp.identifier === 'string') return sp.identifier;
  const legacy = (pkg as unknown as WithLegacyProduct).product;
  if (legacy && typeof legacy.identifier === 'string') return legacy.identifier;
  return null;
}

async function getCurrentOffering(): Promise<PurchasesOfferings['current'] | null> {
  const offs = await Purchases.getOfferings();
  return offs.current ?? null;
}

function pickMonthlyPackage(
  current: NonNullable<PurchasesOfferings['current']>,
  fallbackProductId?: string | null
): PurchasesPackage | null {
  const pkgs = current.availablePackages ?? [];
  const standard = pkgs.find((p) => p.identifier === '$rc_monthly');
  if (standard) return standard;

  if (fallbackProductId) {
    const byId = pkgs.find((p) => identifierFromPackage(p) === fallbackProductId);
    if (byId) return byId;
  }
  return null;
}

function mapLogLevel(): LOG_LEVEL {
  const env =
    (import.meta.env.VITE_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined) ??
    (import.meta.env.DEV ? 'debug' : 'warn');
  switch (env) {
    case 'debug':
      return LOG_LEVEL.DEBUG;
    case 'info':
      return LOG_LEVEL.INFO;
    case 'error':
      return LOG_LEVEL.ERROR;
    case 'warn':
    default:
      return LOG_LEVEL.WARN;
  }
}

function pickApiKey(): string | null {
  const p = Capacitor.getPlatform();
  if (p === 'ios') return RC_IOS_KEY || null;
  if (p === 'android') return RC_ANDROID_KEY || null;
  return null; // skip web
}

function pickDefaultProductId(): string | null {
  const p = Capacitor.getPlatform();
  if (p === 'ios') return IOS_PRODUCT_IDS[0] ?? null;
  if (p === 'android') return ANDROID_PRODUCT_IDS[0] ?? null;
  return null;
}

/** RevenueCat Capacitor v11 expects the log level inside an options object. */
async function setRCLogLevel(level: LOG_LEVEL): Promise<void> {
  try {
    await Purchases.setLogLevel({ level });
  } catch (e) {
    rcLog.warn('setLogLevel failed', {
      msg: e instanceof Error ? e.message : String(e),
    });
  }
}

/* ---------------------------
   Public API
----------------------------*/

/** Initialize RevenueCat (idempotent). No Offerings required. */
export async function initRevenueCat(appUserId?: string): Promise<void> {
  const platform = Capacitor.getPlatform();

  if (platform === 'web') {
    rcLog.info('Skipping RevenueCat configure on web');
    return;
  }
  if (configured) {
    rcLog.debug('RevenueCat already configured; skipping');
    return;
  }

  const RC_KEY = pickApiKey();
  if (!RC_KEY) {
    rcLog.warn('Missing RC API key for platform; skipping configure');
    return;
  }

  try {
    await setRCLogLevel(mapLogLevel());

    await Purchases.configure(
      {
        ['apiKey']: RC_KEY, // computed key avoids identifier restriction
        appUserID: appUserId ?? undefined,
      } as Parameters<typeof Purchases.configure>[0]
    );

    configured = true;
    rcLog.info('RevenueCat configured');

    if (!listenerAttached) {
      Purchases.addCustomerInfoUpdateListener((payload: unknown) => {
        try {
          const info = unwrapCustomerInfo(payload);
          if (!info) {
            rcLog.warn('CustomerInfo listener received unexpected payload shape');
            return;
          }
          const ids = Object.keys(info.subscriptionsByProductIdentifier ?? {});
          rcLog.debug('CustomerInfo update', {
            productIds: ids,
            latestExpirationDate: info.latestExpirationDate ?? null,
          });
        } catch (e) {
          rcLog.warn('CustomerInfo update listener error', {
            msg: e instanceof Error ? e.message : String(e),
          });
        }
      });
      listenerAttached = true;
    }

    try {
      const snap = await Purchases.getCustomerInfo();
      const info = unwrapCustomerInfo(snap);
      rcLog.debug('Entitlement snapshot', {
        latestExpirationDate: info?.latestExpirationDate ?? null,
        allPurchasedProductIdentifiers: info?.allPurchasedProductIdentifiers ?? [],
      });
    } catch (e) {
      rcLog.warn('getCustomerInfo failed (non-fatal)', {
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  } catch (e) {
    rcLog.error('RevenueCat configure failed', {
      msg: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Purchase a specific package directly.
 * This is the new generic method that works with any package (monthly, yearly, etc.)
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo> {
  const result = await Purchases.purchasePackage({ aPackage: pkg });
  const info = unwrapCustomerInfo(result);
  if (!info) throw new Error('Unexpected purchase result shape');
  rcLog.info('Purchase complete', {
    packageId: pkg.identifier,
    productIds: Object.keys(info.subscriptionsByProductIdentifier ?? {}),
    latestExpirationDate: info.latestExpirationDate ?? null,
  });
  return info;
}

/**
 * Purchase by product identifier (no Offerings required by the caller).
 * If no id is provided, uses the first configured id for the platform.
 * Internally buys via the Offerings package (purchasePackage).
 */
export async function purchaseById(productId?: string): Promise<CustomerInfo> {
  const current = await getCurrentOffering();
  if (!current) {
    throw new Error('No current offering configured in RevenueCat');
  }

  const monthly = pickMonthlyPackage(current, productId ?? pickDefaultProductId());
  if (!monthly) {
    throw new Error(
      'No monthly package found. Ensure your "default" offering contains a $rc_monthly package ' +
        'or a package that maps to your product id.'
    );
  }

  return await purchasePackage(monthly);
}

/** Restore purchases */
export async function restorePurchases(): Promise<CustomerInfo> {
  const result = await Purchases.restorePurchases();
  const info = unwrapCustomerInfo(result);
  if (!info) throw new Error('Unexpected restore result shape');
  rcLog.info('Restore complete', {
    productIds: Object.keys(info.subscriptionsByProductIdentifier ?? {}),
    latestExpirationDate: info.latestExpirationDate ?? null,
  });
  return info;
}

/** Explicit login/logout (only if you manage your own user ids) */
export async function loginPurchases(userId: string): Promise<CustomerInfo> {
  type LogInArg = Parameters<typeof Purchases.logIn>[0];
  const result = await Purchases.logIn({ appUserID: userId } as LogInArg);
  const info = unwrapCustomerInfo(result);
  if (!info) throw new Error('Unexpected login result shape');
  return info;
}

export async function logoutPurchases(): Promise<CustomerInfo> {
  const result = await Purchases.logOut();
  const info = unwrapCustomerInfo(result);
  if (!info) throw new Error('Unexpected logout result shape');
  return info;
}

/** Read current entitlements */
export async function getCustomerInfo(): Promise<CustomerInfo> {
  const result = await Purchases.getCustomerInfo();
  const info = unwrapCustomerInfo(result);
  if (!info) throw new Error('Unexpected getCustomerInfo result shape');
  return info;
}

/** Simple entitlement check: true if any active subscription exists */
export function isProFromCustomerInfo(ci: CustomerInfo): boolean {
  return deriveEntitlementFromCustomerInfo(ci).active;
}

/** Return a localized price string for the default product (or null) using Offerings. */
export async function getDefaultPriceLabel(): Promise<string | null> {
  const current = await getCurrentOffering();
  if (!current) return null;

  const monthly = pickMonthlyPackage(current, pickDefaultProductId());
  if (!monthly) return null;

  return priceFromPackage(monthly);
}

/** Open the native store subscription manager */
export function openManageSubscriptions(): void {
  const p = Capacitor.getPlatform();
  if (p === 'ios') {
    window.location.assign('itms-apps://apps.apple.com/account/subscriptions');
  } else if (p === 'android') {
    window.location.assign('https://play.google.com/store/account/subscriptions');
  } else {
    window.open('https://support.apple.com/en-gb/HT202039', '_blank', 'noopener,noreferrer');
  }
}

/* ---------------------------
   Safe userId extraction (strict TS)
----------------------------*/

type RCUserIdShape = {
  originalAppUserId?: unknown;
  appUserID?: unknown;
};

function extractAppUserId(ci: CustomerInfo): string {
  const u = ci as unknown as RCUserIdShape;
  const orig = u.originalAppUserId;
  if (typeof orig === 'string' && orig.length > 0) return orig;
  const app = u.appUserID;
  if (typeof app === 'string' && app.length > 0) return app;
  return '';
}

/** Initialize and return current RC app user id (if available). */
export async function initAndGetAppUserId(appUserId?: string): Promise<string> {
  await initRevenueCat(appUserId);
  try {
    const ci = await getCustomerInfo();
    return extractAppUserId(ci);
  } catch (e) {
    rcLog.warn('initAndGetAppUserId: getCustomerInfo failed', {
      msg: e instanceof Error ? e.message : String(e),
    });
    return '';
  }
}
