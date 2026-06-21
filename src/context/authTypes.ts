// src/context/authTypes.ts
export type User = {
  id: string;
  email: string;
  email_verified_at?: string | null;

  // Profile / app fields
  injection_day?: string | null;
  injection_time?: string | null;
  timezone?: string | null;
  fasting_schedule?: string | null;

  first_name?: string | null;
  last_name?: string | null;
  medication_name?: string | null;
  medication_dose?: string | null;
  profile_photo?: string | null;
  height?: number | null;
  weight?: number | null;
  fasting_start?: string | null;
  fasting_end?: string | null;
  bmi?: number | null;

  // ✅ Entitlements persisted in SQLite
  has_pro?: boolean;
  subscription_tier?: 'free' | 'pro' | null;
  pro_until?: string | null; // ISO (local or UTC); null means not time-bound
  subscription_product_id?: string | null;
  entitlement_source?: string | null;
  entitlement_synced_at?: string | null;
};

export type AuthContextType = {
  user: User | null;
  loading: boolean;

  // core actions
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;

  // ✅ derived + sync
  isPro: boolean;
  refreshEntitlements: () => Promise<void>; // new: refresh from SQLite/RC into memory
};
