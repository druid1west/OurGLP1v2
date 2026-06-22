// src/db/LocalAccountRepository.ts
import { getDb } from '../db/sqlite';
import { verifyPassword, hashPassword } from '../utils/password';

export type LocalAccount = {
  id: string; // e.g., uuid
  email: string | null;
  email_lower: string | null;
  first_name: string | null;
  last_name: string | null;
  last_login_at: string | null;
  auth_provider: string | null;
  provider_sub: string | null;
  password_hash: string | null;
};

/* --------------------------------------------
   Capacitor SQLite result mappers (no `any`)
--------------------------------------------- */
type SqliteRowObject = Record<string, unknown>;
type SqliteQueryResult = { values?: unknown[] } | null | undefined;

function mapSingleRow(result: SqliteQueryResult): SqliteRowObject | null {
  const values = result?.values;
  if (!values || values.length === 0) return null;

  // A: [ [col1, col2, ...], [val1, val2, ...] ]
  if (Array.isArray(values[0]) && values.length >= 2 && Array.isArray(values[1])) {
    const cols = values[0] as string[];
    const row = values[1] as unknown[];
    const rec: SqliteRowObject = {};
    cols.forEach((c, i) => {
      rec[c] = row[i];
    });
    return rec;
  }

  // B (iOS): [ { ios_columns:[...] }, { col1:val1, ... } ]
  if (
    values.length >= 2 &&
    typeof values[0] === 'object' &&
    values[0] !== null &&
    'ios_columns' in (values[0] as Record<string, unknown>)
  ) {
    const iosWrapper = values[0] as { ios_columns: string[] };
    const rowObj = values[1] as Record<string, unknown>;
    const rec: SqliteRowObject = {};
    iosWrapper.ios_columns.forEach((c) => {
      rec[c] = Object.prototype.hasOwnProperty.call(rowObj, c) ? rowObj[c] : undefined;
    });
    return rec;
  }

  // C: [ { col1:val1, ... } ]
  if (
    values.length === 1 &&
    typeof values[0] === 'object' &&
    values[0] !== null &&
    !Array.isArray(values[0]) &&
    !('ios_columns' in (values[0] as Record<string, unknown>))
  ) {
    return values[0] as Record<string, unknown>;
  }

  return null;
}

/* --------------------------------------------
   Init
--------------------------------------------- */
export async function initLocalAccountTable(): Promise<void> {
  const db = await getDb();
  // Secondary index (safe even if your schema already has a unique partial index)
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(email_lower);
  `);
}

/* --------------------------------------------
   Queries
--------------------------------------------- */
export async function getLocalAccount(): Promise<LocalAccount | null> {
  const db = await getDb();
  const res = await db.query(`
    SELECT id, email, email_lower, first_name, last_name, last_login_at,
           auth_provider, provider_sub, password_hash
    FROM users
    WHERE deleted_at IS NULL
    ORDER BY datetime(last_login_at) DESC
    LIMIT 1
  `);

  const row = mapSingleRow(res);
  if (!row) return null;

  return {
    id: String(row.id ?? ''),
    email: row.email == null ? null : String(row.email),
    email_lower: row.email_lower == null ? null : String(row.email_lower),
    first_name: row.first_name == null ? null : String(row.first_name),
    last_name: row.last_name == null ? null : String(row.last_name),
    last_login_at: row.last_login_at == null ? null : String(row.last_login_at),
    auth_provider: row.auth_provider == null ? null : String(row.auth_provider),
    provider_sub: row.provider_sub == null ? null : String(row.provider_sub),
    password_hash: row.password_hash == null ? null : String(row.password_hash),
  };
}

export async function hasSavedEmailPasswordAccount(): Promise<boolean> {
  const db = await getDb();
  const res = await db.query(`
    SELECT id
    FROM users
    WHERE deleted_at IS NULL
      AND email IS NOT NULL
      AND email NOT LIKE '%@local.ourglp1'
      AND password_hash IS NOT NULL
      AND password_hash <> ''
    LIMIT 1
  `);

  return mapSingleRow(res) !== null;
}

/** Look up an account by lower-cased email. */
export async function getLocalAccountByEmailLower(
  emailLower: string
): Promise<LocalAccount | null> {
  const db = await getDb();
  const res = await db.query(
    `
    SELECT id, email, email_lower, first_name, last_name, last_login_at,
           auth_provider, provider_sub, password_hash
    FROM users
    WHERE email_lower = ?
    LIMIT 1
    `,
    [emailLower]
  );

  const row = mapSingleRow(res);
  if (!row) return null;

  return {
    id: String(row.id ?? ''),
    email: row.email == null ? null : String(row.email),
    email_lower: row.email_lower == null ? null : String(row.email_lower),
    first_name: row.first_name == null ? null : String(row.first_name),
    last_name: row.last_name == null ? null : String(row.last_name),
    last_login_at: row.last_login_at == null ? null : String(row.last_login_at),
    auth_provider: row.auth_provider == null ? null : String(row.auth_provider),
    provider_sub: row.provider_sub == null ? null : String(row.provider_sub),
    password_hash: row.password_hash == null ? null : String(row.password_hash),
  };
}

/* --------------------------------------------
   Mutations
--------------------------------------------- */
export async function upsertLocalAccount(a: {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  password_hash: string | null;
  last_login_at?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db.run(
    `
    INSERT INTO users (id, email, email_lower, first_name, last_name, password_hash, last_login_at, created_at, updated_at, timezone, is_active)
    VALUES (?, ?, LOWER(?), ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'), datetime('now'), 'UTC', 1)
    ON CONFLICT(id) DO UPDATE SET
      email=excluded.email,
      email_lower=excluded.email_lower,
      first_name=excluded.first_name,
      last_name=excluded.last_name,
      password_hash=excluded.password_hash,
      last_login_at=excluded.last_login_at,
      updated_at=datetime('now')
    `,
    [
      a.id,
      a.email,
      a.email,
      a.first_name,
      a.last_name,
      a.password_hash,
      a.last_login_at ?? new Date().toISOString(),
    ]
  );
}

/**
 * "Login" by verifying the email_lower + password_hash match (hash must be precomputed).
 * Kept for backwards compatibility with existing callers.
 */
export async function loginLocal(
  email: string,
  passwordHash: string
): Promise<LocalAccount | null> {
  const db = await getDb();
  const emailLower = email.trim().toLowerCase();

  const acc = await getLocalAccountByEmailLower(emailLower);
  if (!acc || !acc.password_hash) return null;
  if (acc.password_hash !== passwordHash) return null;

  await db.run(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, [acc.id]);
  return { ...acc, last_login_at: new Date().toISOString() };
}

/**
 * Update password for a user (by id). Pass a PRE-HASHED string (pbkdf2$sha256$...).
 * If currentPasswordHash is provided, it is verified before updating.
 */
export async function updatePasswordLocal(
  userId: string,
  newPasswordHash: string,
  currentPasswordHash?: string
): Promise<boolean> {
  const db = await getDb();

  if (currentPasswordHash) {
    const q = await db.query(`SELECT password_hash FROM users WHERE id = ? LIMIT 1`, [userId]);
    const row = mapSingleRow(q);
    const existing = row?.password_hash == null ? null : String(row.password_hash);
    if (!existing || existing !== currentPasswordHash) return false;
  }

  await db.run(
    `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
    [newPasswordHash, userId]
  );
  return true;
}

/* --------------------------------------------
   New: verify + auto-upgrade + login
--------------------------------------------- */

/** Convenience wrapper over updatePasswordLocal. */
export async function updateAccountPasswordHash(userId: string, newHash: string): Promise<void> {
  await updatePasswordLocal(userId, newHash);
}

/**
 * Verify a PLAIN password for the given email, silently upgrade legacy hashes,
 * bump last_login_at, and return the LocalAccount on success (null otherwise).
 */
export async function verifyAndLoginLocal(
  email: string,
  passwordPlain: string
): Promise<LocalAccount | null> {
  const db = await getDb();
  const emailLower = email.trim().toLowerCase();

  const acc = await getLocalAccountByEmailLower(emailLower);
  if (!acc || !acc.password_hash) return null;

  const v = await verifyPassword(passwordPlain, acc.password_hash);

  if (v === true) {
    // Already pbkdf2$sha256
  } else if (v && typeof v === 'object' && v.ok) {
    // Verified legacy; upgrade hash in DB
    await db.run(
      `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
      [v.upgradedHash, acc.id]
    );
    acc.password_hash = v.upgradedHash;
  } else {
    return null; // not verified
  }

  await db.run(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, [acc.id]);
  return { ...acc, last_login_at: new Date().toISOString() };
}

/**
 * Optional: register helper that takes a plain password and hashes it before insert.
 */
export async function insertAccountWithPlainPassword(
  id: string,
  email: string,
  passwordPlain: string,
  names?: { first_name?: string | null; last_name?: string | null }
): Promise<void> {
  const password_hash = await hashPassword(passwordPlain);
  await upsertLocalAccount({
    id,
    email,
    first_name: names?.first_name ?? null,
    last_name: names?.last_name ?? null,
    password_hash,
    last_login_at: null,
  });
}
