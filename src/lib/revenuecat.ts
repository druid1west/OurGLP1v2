// src/lib/revenuecat.ts
import { Purchases } from '@revenuecat/purchases-capacitor';
import type {
  PurchasesOfferings,
  PurchasesPackage,
  CustomerInfo,
  MakePurchaseResult
} from '@revenuecat/purchases-capacitor';
import { Device } from '@capacitor/device';
import { IS_LOCAL_AUTH } from '../config/runtime';
import { initRevenueCat } from '../lib/purchasesInit';

type Platform = 'android' | 'ios' | 'web';

/* ------------------------------ single config ---------------------------- */
/** Initialize RC once via purchasesInit, return the deviceId we use as appUserID in local mode. */
let initOnce: Promise<{ deviceId: string; platform: Platform }> | null = null;

export async function rcInit(): Promise<string> {
  if (!initOnce) {
    initOnce = (async () => {
      const info = await Device.getInfo();
      const platform = (info.platform ?? 'web') as Platform;
      const { identifier: deviceId } = await Device.getId();

      // Delegate ALL configuration to purchasesInit (idempotent)
      // Pass deviceId so Purchases.configure receives a stable appUserID when present
      await initRevenueCat(deviceId);

      return { deviceId, platform };
    })();
  }
  const { deviceId } = await initOnce;
  return deviceId;
}

/* ----------------------------- debug/probing ----------------------------- */
export async function rcDebugProbe(): Promise<{
  customerInfo: CustomerInfo;
  offerings: PurchasesOfferings | null;
}> {
  await rcInit();

  const customerInfo = await getCustomerInfoStrict();

  let offerings: PurchasesOfferings | null = null;
  try {
    offerings = await Purchases.getOfferings();
  } catch (e: unknown) {
    const msg = rcErrorMessage(e);
    // surface invalid-key loudly; otherwise treat as non-fatal probe
    if (msg.toLowerCase().includes('invalid api key')) {
      throw wrapRcError('getOfferings', e);
    }
  }
  return { customerInfo, offerings };
}

/* -------------------------- offerings & helpers -------------------------- */

export async function rcGetMonthlyPackage(): Promise<PurchasesPackage | null> {
  await rcInit();
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return null;

  const pkgs = current.availablePackages ?? [];
  // Prefer the standard $rc_monthly; fall back to a custom "monthly" id if you're using one
  return pkgs.find((p) => p.identifier === '$rc_monthly')
      ?? pkgs.find((p) => p.identifier === 'monthly')
      ?? null;
}

export async function rcGetYearlyPackage(): Promise<PurchasesPackage | null> {
  await rcInit();
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return null;

  const pkgs = current.availablePackages ?? [];
  // Prefer the standard $rc_annual; fall back to a custom "yearly" id if you're using one
  return pkgs.find((p) => p.identifier === '$rc_annual')
      ?? pkgs.find((p) => p.identifier === 'yearly')
      ?? null;
}

export async function rcGetBothPackages(): Promise<{
  monthly: PurchasesPackage | null;
  yearly: PurchasesPackage | null;
}> {
  await rcInit();
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  
  if (!current) {
    return { monthly: null, yearly: null };
  }

  const pkgs = current.availablePackages ?? [];
  
  const monthly = pkgs.find((p) => p.identifier === '$rc_monthly')
      ?? pkgs.find((p) => p.identifier === 'monthly')
      ?? null;
      
  const yearly = pkgs.find((p) => p.identifier === '$rc_annual')
      ?? pkgs.find((p) => p.identifier === 'yearly')
      ?? null;

  return { monthly, yearly };
}

type StoreProductLike = { priceString?: string; title?: string };
type StoreProductCarrier = { storeProduct?: StoreProductLike };
type LegacyProductCarrier = { product?: StoreProductLike };

function hasStoreProduct(pkg: unknown): pkg is PurchasesPackage & StoreProductCarrier {
  return typeof pkg === 'object' && pkg !== null && 'storeProduct' in (pkg as Record<string, unknown>);
}

function hasLegacyProduct(pkg: unknown): pkg is PurchasesPackage & LegacyProductCarrier {
  return typeof pkg === 'object' && pkg !== null && 'product' in (pkg as Record<string, unknown>);
}

export function rcGetPriceString(pkg: PurchasesPackage): string {
  if (hasStoreProduct(pkg) && pkg.storeProduct?.priceString) return pkg.storeProduct.priceString;
  if (hasLegacyProduct(pkg) && pkg.product?.priceString) return pkg.product.priceString;
  return 'Monthly';
}

export function rcGetTitle(pkg: PurchasesPackage): string {
  if (hasStoreProduct(pkg) && pkg.storeProduct?.title) return pkg.storeProduct.title;
  if (hasLegacyProduct(pkg) && pkg.product?.title) return pkg.product.title;
  return 'Subscription';
}

/* ------------------------------ purchase flows --------------------------- */

// Generic purchase function that works with any package
export async function rcPurchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo> {
  await rcInit();
  const result: MakePurchaseResult = await Purchases.purchasePackage({ aPackage: pkg });
  
  // Extract customerInfo from result (Capacitor v5 returns either { customerInfo } or CustomerInfo directly)
  const customerInfo = isObject(result) && 'customerInfo' in result 
    ? (result as { customerInfo: CustomerInfo }).customerInfo 
    : result as CustomerInfo;
    
  if (!hasEntitlement(customerInfo, 'pro')) {
    throw new Error('Purchase did not unlock entitlement "pro". Check RC entitlement mapping.');
  }
  return customerInfo;
}

export async function rcPurchaseMonthlyAndConfirm(deviceId: string): Promise<string> {
  await rcInit();

  const pkg = await rcGetMonthlyPackage();
  if (!pkg) {
    throw new Error(
      'Monthly package not available. Set a Current offering with a "$rc_monthly" (or "monthly") package.'
    );
  }

  await rcPurchasePackage(pkg); // Just await, don't assign
  const confirmProof = await fetchConfirmProof(deviceId);
  if (!confirmProof) throw new Error('Confirmation failed (no token)');
  return confirmProof;
}

export async function rcPurchaseYearlyAndConfirm(deviceId: string): Promise<string> {
  await rcInit();

  const pkg = await rcGetYearlyPackage();
  if (!pkg) {
    throw new Error(
      'Yearly package not available. Set a Current offering with a "$rc_annual" (or "yearly") package.'
    );
  }

  await rcPurchasePackage(pkg); // Just await, don't assign
  const confirmProof = await fetchConfirmProof(deviceId);
  if (!confirmProof) throw new Error('Confirmation failed (no token)');
  return confirmProof;
}

export async function rcRestoreAndConfirm(deviceId: string): Promise<string> {
  await rcInit();

  const result = await Purchases.restorePurchases();
  const customerInfo = isObject(result) && 'customerInfo' in result 
    ? (result as { customerInfo: CustomerInfo }).customerInfo 
    : result as CustomerInfo;
    
  if (!hasEntitlement(customerInfo, 'pro')) {
    throw new Error('No active subscription found for entitlement "pro".');
  }

  const confirmProof = await fetchConfirmProof(deviceId);
  if (!confirmProof) throw new Error('Confirmation failed (no token)');
  return confirmProof;
}

export async function rcLogin(appUserID: string): Promise<void> {
  await rcInit();
  await Purchases.logIn({ appUserID });
}

export async function rcLogout(): Promise<void> {
  await rcInit();
  await Purchases.logOut();
}

/* --------------------------------- utils --------------------------------- */

interface CapacitorDataErrorShape {
  underlyingErrorMessage?: string;
  message?: string;
}
interface CapacitorErrorShape {
  data?: CapacitorDataErrorShape;
  message?: string;
  toString?: () => string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function rcErrorMessage(err: unknown): string {
  if (isObject(err)) {
    const e = err as CapacitorErrorShape;
    const dataMsg = e.data?.underlyingErrorMessage || e.data?.message;
    const topMsg = e.message;
    const str = typeof e.toString === 'function' ? e.toString() : undefined;
    return dataMsg || topMsg || str || 'Unknown error';
  }
  return typeof err === 'string' ? err : 'Unknown error';
}

function wrapRcError(op: string, err: unknown): Error {
  const msg = rcErrorMessage(err);
  if (msg.toLowerCase().includes('invalid api key')) {
    return new Error(
      `RevenueCat ${op} failed: Invalid API key. On Android use the public app-specific key (starts with "goog_").`
    );
  }
  return new Error(`RevenueCat ${op} failed: ${msg}`);
}

function hasEntitlement(info: CustomerInfo, entitlementId: string): boolean {
  const activeUnknown = info.entitlements?.active as unknown;
  if (!activeUnknown || typeof activeUnknown !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(
    activeUnknown as Record<string, unknown>,
    entitlementId
  );
}

async function getCustomerInfoStrict(): Promise<CustomerInfo> {
  // Capacitor v5 returns either { customerInfo } or CustomerInfo directly from getCustomerInfo()
  const result = await Purchases.getCustomerInfo();
  if (isObject(result) && 'customerInfo' in result) {
    return (result as { customerInfo: CustomerInfo }).customerInfo;
  }
  return result as CustomerInfo;
}

/* --------------------------- local-only confirm --------------------------- */
async function fetchConfirmProof(_appUserID: string): Promise<string> {
  void _appUserID;
  if (IS_LOCAL_AUTH) return 'local-confirm';
  return 'local-confirm';
}





