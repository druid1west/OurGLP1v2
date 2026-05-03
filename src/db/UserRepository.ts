// src/db/UserRepository.ts
import { getDb } from '../db/sqlite';

export type UserProfile = {
  id: 1;
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  weight: number | null;
  goal_weight: number | null;
  medication_name: string | null;
  medication_dose: string | null;
  profile_photo: string | null;
  timezone: string;
  fasting_schedule: string | null;
  fasting_start: string | null;
  injection_day: string | null;
  injection_time: string | null;
  height: number | null;
  bmi: number | null;
  is_active: number; // 0/1
  auth_provider: string;
  provider_sub: string | null;
  apple_private_relay: number; // 0/1
  email_verified_at: string | null;
  last_login_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  synced_at: number | null;
  has_pro: number; // 0/1
};

export async function getLocalUserProfile(): Promise<UserProfile | null> {
  const db = await getDb();
  const res = await db.query(`
    SELECT
      id, user_id, email, first_name, last_name, weight, goal_weight,
      medication_name, medication_dose, profile_photo, timezone,
      fasting_schedule, fasting_start, injection_day, injection_time,
      height, bmi, is_active, auth_provider, provider_sub,
      apple_private_relay, email_verified_at, last_login_at,
      updated_at, created_at, synced_at, has_pro
    FROM user_profile
    WHERE id = 1
    LIMIT 1
  `);
  const row = (res.values ?? [])[0];
  if (!row) return null;

  return {
    id: 1,
    user_id: String(row.user_id),
    email: row.email ?? null,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    weight: row.weight ?? null,
    goal_weight: row.goal_weight ?? null,
    medication_name: row.medication_name ?? null,
    medication_dose: row.medication_dose ?? null,
    profile_photo: row.profile_photo ?? null,
    timezone: row.timezone ?? 'UTC',
    fasting_schedule: row.fasting_schedule ?? null,
    fasting_start: row.fasting_start ?? null,
    injection_day: row.injection_day ?? null,
    injection_time: row.injection_time ?? null,
    height: row.height ?? null,
    bmi: row.bmi ?? null,
    is_active: Number(row.is_active ?? 1),
    auth_provider: row.auth_provider ?? 'email',
    provider_sub: row.provider_sub ?? null,
    apple_private_relay: Number(row.apple_private_relay ?? 0),
    email_verified_at: row.email_verified_at ?? null,
    last_login_at: row.last_login_at ?? null,
    updated_at: row.updated_at ?? null,
    created_at: row.created_at ?? null,
    synced_at: row.synced_at ?? null,
    has_pro: Number(row.has_pro ?? 0),
  };
}

// Upsert local singleton profile (id=1)
export async function upsertUserProfile(p: Partial<UserProfile> & { user_id: string }): Promise<void> {
  const db = await getDb();
  await db.run(
    `
    INSERT INTO user_profile
      (id, user_id, email, first_name, last_name, weight, goal_weight,
       medication_name, medication_dose, profile_photo, timezone,
       fasting_schedule, fasting_start, injection_day, injection_time,
       height, bmi, is_active, auth_provider, provider_sub,
       apple_private_relay, email_verified_at, last_login_at,
       updated_at, created_at, synced_at, has_pro)
    VALUES
      (1, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, COALESCE(?, 'UTC'),
       ?, ?, ?, ?,
       ?, ?, COALESCE(?, 1), COALESCE(?, 'email'), ?,
       COALESCE(?, 0), ?, ?,
       COALESCE(?, datetime('now')), COALESCE(?, datetime('now')), ?, COALESCE(?, 0))
    ON CONFLICT(id) DO UPDATE SET
      user_id=excluded.user_id,
      email=excluded.email,
      first_name=excluded.first_name,
      last_name=excluded.last_name,
      weight=excluded.weight,
      goal_weight=excluded.goal_weight,
      medication_name=excluded.medication_name,
      medication_dose=excluded.medication_dose,
      profile_photo=excluded.profile_photo,
      timezone=excluded.timezone,
      fasting_schedule=excluded.fasting_schedule,
      fasting_start=excluded.fasting_start,
      injection_day=excluded.injection_day,
      injection_time=excluded.injection_time,
      height=excluded.height,
      bmi=excluded.bmi,
      is_active=excluded.is_active,
      auth_provider=excluded.auth_provider,
      provider_sub=excluded.provider_sub,
      apple_private_relay=excluded.apple_private_relay,
      email_verified_at=excluded.email_verified_at,
      last_login_at=excluded.last_login_at,
      updated_at=datetime('now'),
      created_at=COALESCE(user_profile.created_at, excluded.created_at),
      synced_at=excluded.synced_at,
      has_pro=excluded.has_pro
    `,
    [
      p.user_id,
      p.email ?? null,
      p.first_name ?? null,
      p.last_name ?? null,
      p.weight ?? null,
      p.goal_weight ?? null,
      p.medication_name ?? null,
      p.medication_dose ?? null,
      p.profile_photo ?? null,
      p.timezone ?? 'UTC',
      p.fasting_schedule ?? null,
      p.fasting_start ?? null,
      p.injection_day ?? null,
      p.injection_time ?? null,
      p.height ?? null,
      p.bmi ?? null,
      p.is_active ?? 1,
      p.auth_provider ?? 'email',
      p.provider_sub ?? null,
      p.apple_private_relay ?? 0,
      p.email_verified_at ?? null,
      p.last_login_at ?? null,
      p.updated_at ?? null,
      p.created_at ?? null,
      p.synced_at ?? null,
      p.has_pro ?? 0,
    ]
  );
  
}
export async function clearUserProfile(): Promise<void> {
  const db = await getDb();
  // If you truly keep only the singleton row id=1:
  await db.run('DELETE FROM user_profile WHERE id = 1');
  // If you ever store more rows locally, you can wipe the table instead:
  // await db.run('DELETE FROM user_profile');
}