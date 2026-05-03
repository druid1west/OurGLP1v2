// src/utils/safePurchases.ts

// Minimal typed shape of the RevenueCat / Purchases customer info we care about.
// Expand this as needed to match the shape your app consumes.
export type CustomerInfo = {
  activeSubscriptions?: string[];
  entitlements?: Record<string, unknown>;
  [key: string]: unknown;
};

export type PurchasesType = {
  // getCustomerInfo returns a structure — keep it generic but typed as CustomerInfo
  getCustomerInfo: () => Promise<CustomerInfo>;
  // optional runtime flag some wrappers expose
  isConfigured?: boolean;
  [key: string]: unknown;
};

// Make this file a module (already is because of the exports), then extend global Window:
declare global {
  interface Window {
    SKIP_PURCHASES?: boolean;
    Purchases?: PurchasesType;
  }
}

/**
 * Safely attempt to read purchases customer info.
 * Returns CustomerInfo or null if unavailable, unconfigured, or on error.
 */
export async function safeGetCustomerInfo(): Promise<CustomerInfo | null> {
  try {
    if (window.SKIP_PURCHASES) return null;

    const Purchases = window.Purchases;
    // runtime guards
    if (!Purchases || typeof Purchases.getCustomerInfo !== 'function') return null;

    // optional guard for wrappers that expose a configured flag
    if (Purchases.isConfigured === false) return null;

    const info = await Purchases.getCustomerInfo();
    return info ?? null;
  } catch (e: unknown) {
    // keep the catch typed as `unknown` and log safely
    console.warn('safeGetCustomerInfo failed', e);
    return null;
  }
}