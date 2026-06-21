// src/services/localAuth.ts
import { getDb } from '@/db/sqlite';
import type { User } from '@/context/authTypes';
import { emitAuthChanged } from '@/services/authBus';

type SqliteRowObject = Record<string, unknown>;
type SqliteQueryResult = { values?: unknown[][] } | null | undefined;

function mapSingleRow(result: SqliteQueryResult): SqliteRowObject | null {
  const values = result?.values;
  if (!values || values.length === 0) return null;

  let cols: string[] | undefined;
  let rowCandidate: unknown = undefined;

  // A: [ [col1, col2], [val1, val2] ]
  if (Array.isArray(values[0]) && values.length >= 2 && Array.isArray(values[1])) {
    cols = values[0] as string[];
    rowCandidate = values[1];
  }
  // B: [ {ios_columns:[...]}, {col1:val1, ...} ]
  else if (
    values.length >= 2 &&
    typeof values[0] === 'object' &&
    values[0] !== null &&
    'ios_columns' in values[0]
  ) {
    const iosWrapper = values[0] as { ios_columns: string[] };
    cols = iosWrapper.ios_columns;
    rowCandidate = values[1];
  }
  // C: [ {col1:val1, ...} ] — single object row
  else if (
    values.length === 1 &&
    typeof values[0] === 'object' &&
    values[0] !== null &&
    !Array.isArray(values[0]) &&
    !('ios_columns' in (values[0] as object))
  ) {
    const obj = values[0] as Record<string, unknown>;
    cols = Object.keys(obj);
    rowCandidate = obj;
  }

  if (!cols) return null;
  const rec: SqliteRowObject = {};

  if (Array.isArray(rowCandidate)) {
    const rowArr = rowCandidate;
    cols.forEach((c, i) => {
      rec[c] = rowArr[i];
    });
  } else if (rowCandidate && typeof rowCandidate === 'object') {
    const rowObj = rowCandidate as Record<string, unknown>;
    cols.forEach((c) => {
      rec[c] = Object.prototype.hasOwnProperty.call(rowObj, c) ? rowObj[c] : undefined;
    });
  }

  return rec;
}

function toUser(rec: SqliteRowObject | null): User | null {
  if (!rec) return null;
  const id = typeof rec.id === 'string' ? rec.id : '';
  const email = typeof rec.email === 'string' ? rec.email : '';
  if (!id || !email) return null;

  return {
    id,
    email,
    first_name: typeof rec.first_name === 'string' ? rec.first_name : undefined,
    last_name: typeof rec.last_name === 'string' ? rec.last_name : undefined,
    medication_name: typeof rec.medication_name === 'string' ? rec.medication_name : undefined,
    medication_dose: typeof rec.medication_dose === 'string' ? rec.medication_dose : undefined,
    profile_photo: typeof rec.profile_photo === 'string' ? rec.profile_photo : undefined,
    height: typeof rec.height === 'number' ? rec.height : undefined,
    weight: typeof rec.weight === 'number' ? rec.weight : undefined,
    bmi: typeof rec.bmi === 'number' ? rec.bmi : undefined,
    fasting_schedule: typeof rec.fasting_schedule === 'string' ? rec.fasting_schedule : undefined,
    fasting_start: typeof rec.fasting_start === 'string' ? rec.fasting_start : undefined,
    fasting_end: typeof rec.fasting_end === 'string' ? rec.fasting_end : undefined,
    injection_day: typeof rec.injection_day === 'string' ? rec.injection_day : undefined,
    injection_time: typeof rec.injection_time === 'string' ? rec.injection_time : undefined,
    timezone:
      rec.timezone === null ? null : typeof rec.timezone === 'string' ? rec.timezone : null,
    has_pro: Number(rec.has_pro) === 1,
    subscription_tier:
      typeof rec.subscription_tier === 'string'
        ? (rec.subscription_tier as 'free' | 'pro')
        : null,
    pro_until:
      rec.pro_until === null ? null : typeof rec.pro_until === 'string' ? rec.pro_until : null,
    subscription_product_id:
      rec.subscription_product_id === null
        ? null
        : typeof rec.subscription_product_id === 'string'
        ? rec.subscription_product_id
        : null,
    entitlement_source:
      rec.entitlement_source === null
        ? null
        : typeof rec.entitlement_source === 'string'
        ? rec.entitlement_source
        : null,
    entitlement_synced_at:
      rec.entitlement_synced_at === null
        ? null
        : typeof rec.entitlement_synced_at === 'string'
        ? rec.entitlement_synced_at
        : null,
    email_verified_at:
      rec.email_verified_at === null
        ? null
        : typeof rec.email_verified_at === 'string'
        ? rec.email_verified_at
        : null,
  };
}

export async function getLocalCurrentUser(): Promise<User | null> {
  const db = await getDb();

  // Always read the explicit "current user" pointer
  try {
    const sRes = await db.query(
      `SELECT last_logged_in_user_id FROM settings WHERE id = 1 LIMIT 1`
    );
    const sRec = mapSingleRow(sRes);
    const lastId =
      sRec && typeof sRec.last_logged_in_user_id === 'string'
        ? sRec.last_logged_in_user_id
        : null;

    if (!lastId) {
      // No one is logged in
      return null;
    }

    // Fetch that user
    const res = await db.query(
      `
      SELECT id, email, first_name, last_name, profile_photo,
             height, weight, goal_weight, bmi,
             medication_name, medication_dose,
             fasting_schedule, fasting_start, fasting_end,
             injection_day, injection_time, timezone,
             has_pro, subscription_tier, pro_until,
             subscription_product_id, entitlement_source, entitlement_synced_at,
             last_login_at,
             email_verified_at
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [lastId]
    );

    const user = toUser(mapSingleRow(res));
    if (user) return user;

    // Pointer is stale → clear it so the app shows logged-out UI
    await db.run(
      `UPDATE settings SET last_logged_in_user_id = NULL, updated_at = datetime('now') WHERE id = 1`
    );
    return null;
  } catch (err) {
    // If settings lookup fails for any reason, DO NOT auto-login.
    console.warn('[getLocalCurrentUser] settings lookup failed', err);
    return null;
  }
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = await getDb();
  const result = await db.query(
    `
    SELECT id, email, first_name, last_name, timezone,
           has_pro, subscription_tier, pro_until,
           subscription_product_id, entitlement_source, entitlement_synced_at,
           last_login_at
    FROM users
    WHERE email_lower = lower(?)             -- ← use the indexed column
    LIMIT 1
    `,
    [email]
  );
  return toUser(mapSingleRow(result));
}

export type RegisterInput = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  timezone?: string | null;
};

export async function registerLocalUser(input: RegisterInput): Promise<void> {
  const db = await getDb();
  const { id, email, first_name = null, last_name = null, timezone = 'UTC' } = input;
  const now = new Date().toISOString();

  // Insert or ignore (if email_lower exists), then gently update core fields
  await db.run(
    `
    INSERT OR IGNORE INTO users (
      id, email, email_lower, first_name, last_name, timezone,
      has_pro, subscription_tier, pro_until,
      created_at, updated_at, last_login_at,
      is_active, auth_provider
    ) VALUES (?, ?, lower(?), ?, ?, ?, 0, 'free', NULL, ?, ?, ?, 1, 'email')
    `,
    [id, email, email, first_name, last_name, timezone, now, now, now]
  );

  await db.run(
    `
    UPDATE users
    SET first_name = COALESCE(?, first_name),
        last_name  = COALESCE(?, last_name),
        timezone   = COALESCE(?, timezone),
        updated_at = datetime('now')
    WHERE email_lower = lower(?)
    `,
    [first_name, last_name, timezone, email]
  );
}

export async function markUserAsLoggedIn(userId: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  await db.run(`UPDATE users SET last_login_at = ? WHERE id = ?`, [now, userId]);

  // ensure settings row
  await db.run(`INSERT OR IGNORE INTO settings (id, updated_at) VALUES (1, datetime('now'))`);

  await db.run(
    `UPDATE settings
     SET last_logged_in_user_id = ?, updated_at = datetime('now')
     WHERE id = 1`,
    [userId]
  );

  // 🔔 notify app shell immediately
  emitAuthChanged(userId);
}

export async function upgradeLocalUserToPro(userId: string, months = 12): Promise<void> {
  const db = await getDb();
  const until = new Date();
  until.setMonth(until.getMonth() + months);
  const untilIso = until.toISOString();

  await db.run(
    `
    UPDATE users
    SET has_pro = 1,
        subscription_tier = 'pro',
        pro_until = ?,
        subscription_product_id = NULL,
        entitlement_source = 'local_test',
        entitlement_synced_at = ?
    WHERE id = ?
    `,
    [untilIso, new Date().toISOString(), userId]
  );
}

export type UserProfilePatch = Partial<{
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  weight: number | null;
  goal_weight: number | null;
  medication_name: string | null;
  medication_dose: string | null;
  profile_photo: string | null;
  timezone: string | null;
  fasting_schedule: string | null;
  fasting_start: string | null;
  fasting_end: string | null;
  injection_day: string | null;
  injection_time: string | null;
  height: number | null;
  bmi: number | null;
}>;

export async function updateLocalUserProfile(userId: string, patch: UserProfilePatch): Promise<void> {
  const db = await getDb();

  await db.run(
    `
    UPDATE users SET
      email = COALESCE(?, email),
      first_name = COALESCE(?, first_name),
      last_name = COALESCE(?, last_name),
      weight = COALESCE(?, weight),
      goal_weight = COALESCE(?, goal_weight),
      medication_name = COALESCE(?, medication_name),
      medication_dose = COALESCE(?, medication_dose),
      profile_photo = COALESCE(?, profile_photo),
      timezone = COALESCE(?, timezone),
      fasting_schedule = COALESCE(?, fasting_schedule),
      fasting_start = COALESCE(?, fasting_start),
      fasting_end = COALESCE(?, fasting_end),
      injection_day = COALESCE(?, injection_day),
      injection_time = COALESCE(?, injection_time),
      height = COALESCE(?, height),
      bmi = COALESCE(?, bmi),
      updated_at = datetime('now')
    WHERE id = ?
    `,
    [
      patch.email ?? null,
      patch.first_name ?? null,
      patch.last_name ?? null,
      patch.weight ?? null,
      patch.goal_weight ?? null,
      patch.medication_name ?? null,
      patch.medication_dose ?? null,
      patch.profile_photo ?? null,
      patch.timezone ?? null,
      patch.fasting_schedule ?? null,
      patch.fasting_start ?? null,
      patch.fasting_end ?? null,
      patch.injection_day ?? null,
      patch.injection_time ?? null,
      patch.height ?? null,
      patch.bmi ?? null,
      userId,
    ]
  );
}

export async function clearLocalCurrentUser(): Promise<void> {
  const db = await getDb();
  await db.run(
    `
    UPDATE settings
    SET last_logged_in_user_id = NULL,
        updated_at = datetime('now')
    WHERE id = 1
    `
  );

  // 🔔 notify logout instantly
  emitAuthChanged(null);
}
