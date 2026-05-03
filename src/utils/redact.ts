// src/utils/redact.ts
// Strict, PII-safe projection helpers

export type SafeUser = {
  /** First 4 chars of a *validated* UUID, otherwise a hashed stub */
  uid4?: string;
  tz?: string;
  hasInjectionPlan?: boolean;
  hasFastingPlan?: boolean;
  hasPro?: boolean;
};

type UserLike = {
  id?: string;
  timezone?: string | null;
  injection_day?: string | null;
  injection_time?: string | null;
  fasting_schedule?: string | null;
  fasting_start?: string | null;
  has_pro?: boolean | null;
};

// --- tiny helpers (no deps) ---

// UUID v1–v5 (lowercase hex typical of your DB)
const UUID_RX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/;

// Very small, stable, non-reversible stub (FNV-1a 32-bit)
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // return 6 hex chars so it’s short but collision-resistant enough for logs
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

// If it's a UUID, return first 4; else return "h-" + short hash.
// This avoids leaking short/meaningful IDs (emails, usernames, etc.).
function safeUid4(id?: string): string | undefined {
  if (!id || typeof id !== 'string') return undefined;
  if (UUID_RX.test(id)) return id.slice(0, 4);
  return `h-${hash32(id).slice(0, 4)}`;
}

// Narrow unknown safely (no anys)
function isUserLike(v: unknown): v is UserLike {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (o.id !== undefined && typeof o.id !== 'string') return false;
  if (o.timezone !== undefined && o.timezone !== null && typeof o.timezone !== 'string') return false;
  if (o.has_pro !== undefined && o.has_pro !== null && typeof o.has_pro !== 'boolean') return false;
  // other fields are optional and can be string|null
  return true;
}

// Public: project a potentially large user object into a tiny, PII-safe shape.
export function toSafeUser(u: unknown): SafeUser {
  if (!isUserLike(u)) return {};
  const uid4 = safeUid4(u.id);
  // timezone is not PII; pass through only if it looks like an IANA tz (simple check)
  const tz = typeof u.timezone === 'string' && u.timezone.includes('/') ? u.timezone : undefined;

  return {
    uid4,
    tz,
    hasInjectionPlan: Boolean(u.injection_day && u.injection_time),
    hasFastingPlan: Boolean(u.fasting_schedule && u.fasting_start),
    hasPro: Boolean(u.has_pro),
  };
}

/**
 * Optional convenience:
 * Wrap values before logging, guaranteeing no accidental object spread.
 * Usage: logger.info('auth', safeLog({ user: toSafeUser(user) }));
 */
export function safeLog<T extends Record<string, unknown>>(o: T): Readonly<T> {
  return Object.freeze({ ...o });
}


