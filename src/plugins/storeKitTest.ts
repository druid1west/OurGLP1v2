import { Capacitor, registerPlugin } from '@capacitor/core';

export const STOREKIT_PRODUCT_IDS = [
  'com.ourglp1.app.pro.monthly',
  'com.ourglp1.app.pro.yearly',
] as const;

export type StoreKitProductId = (typeof STOREKIT_PRODUCT_IDS)[number];

export type StoreKitProduct = {
  id: StoreKitProductId | string;
  displayName: string;
  description: string;
  displayPrice: string;
  periodValue?: number;
  periodUnit?: 'day' | 'week' | 'month' | 'year' | 'unknown';
};

export type StoreKitPurchaseResult = {
  success: boolean;
  productId?: string;
  transactionId?: string;
  expirationDate?: string | null;
  pending?: boolean;
  cancelled?: boolean;
};

export type StoreKitEntitlementResult = {
  active: boolean;
  productIds: string[];
};

type StoreKitTestPlugin = {
  isAvailable(): Promise<{ available: boolean }>;
  getProducts(options: { productIds: string[] }): Promise<{ products: StoreKitProduct[] }>;
  purchase(options: { productId: string }): Promise<StoreKitPurchaseResult>;
  restore(options: { productIds: string[] }): Promise<StoreKitEntitlementResult>;
  hasActiveSubscription(options: { productIds: string[] }): Promise<StoreKitEntitlementResult>;
};

export const StoreKitTest = registerPlugin<StoreKitTestPlugin>('StoreKitTest');

export function isStoreKitTestSupportedPlatform(): boolean {
  return Capacitor.getPlatform() === 'ios';
}

export async function canUseStoreKitTestProducts(): Promise<boolean> {
  if (!isStoreKitTestSupportedPlatform()) return false;

  try {
    const availability = await StoreKitTest.isAvailable();
    if (!availability.available) return false;

    const { products } = await StoreKitTest.getProducts({
      productIds: [...STOREKIT_PRODUCT_IDS],
    });
    return products.length > 0;
  } catch {
    return false;
  }
}
