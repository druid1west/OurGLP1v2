// src/utils/auth.ts
import { getDb } from '../db/sqlite';
import {
  verifyAndLoginLocal, // email+password → LocalAccount|null and bumps last_login_at
} from '@/db/LocalAccountRepository';
import { emitAuthChanged } from '@/services/authBus';

type AuthLoginResult = Readonly<{ id: string; email: string }>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

/** Set/clear the “current user” pointer in the settings singleton. */
async function setCurrentUserId(userId: string | null): Promise<void> {
  const db = await getDb();
  await db.run(`INSERT OR IGNORE INTO settings (id, updated_at) VALUES (1, datetime('now'))`);
  await db.run(
    `UPDATE settings
     SET last_logged_in_user_id = ?, updated_at = datetime('now')
     WHERE id = 1`,
    [userId]
  );
}

/** Email + passphrase login; sets current user id and emits auth:changed */
export async function login(email: string, passphrase: string): Promise<AuthLoginResult> {
  const e = isNonEmptyString(email) ? email.trim().toLowerCase() : '';
  const p = isNonEmptyString(passphrase) ? passphrase : '';

  if (!e || !p) {
    throw new Error('Email and password are required');
  }

  const acc = await verifyAndLoginLocal(e, p);
  if (!acc || !isNonEmptyString(acc.id)) {
    throw new Error('Invalid credentials');
  }

  const userId = String(acc.id);
  await setCurrentUserId(userId);
  emitAuthChanged(userId);

  return { id: userId, email: (acc.email ?? e) as string };
}

/** Local logout; clears current user id and emits auth:changed(null) */
export async function logout(): Promise<void> {
  await setCurrentUserId(null);
  emitAuthChanged(null);
}

/** Get the current user id (or null) from the settings singleton. */
export async function getCurrentUserId(): Promise<string | null> {
  const db = await getDb();
  const q = await db.query(
    `SELECT last_logged_in_user_id FROM settings WHERE id = 1 LIMIT 1`
  );
  const values = q?.values;
  if (!values || values.length === 0) return null;

  // Handle Capacitor SQLite result shape variations
  let row: Record<string, unknown> | null = null;

  // iOS array-of-arrays
  if (Array.isArray(values[0]) && values.length >= 2 && Array.isArray(values[1])) {
    const cols = values[0] as string[];
    const vals = values[1] as unknown[];
    row = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
  }
  // iOS wrapper with ios_columns
  else if (
    values.length >= 2 &&
    typeof values[0] === 'object' &&
    values[0] !== null &&
    'ios_columns' in (values[0] as Record<string, unknown>)
  ) {
    const cols = (values[0] as { ios_columns: string[] }).ios_columns;
    const obj = values[1] as Record<string, unknown>;
    row = Object.fromEntries(cols.map((c) => [c, obj[c]]));
  }
  // Plain object row
  else if (values.length === 1 && typeof values[0] === 'object' && values[0] !== null) {
    row = values[0] as Record<string, unknown>;
  }

  const id = row?.last_logged_in_user_id;
  return typeof id === 'string' && id ? id : null;
}



