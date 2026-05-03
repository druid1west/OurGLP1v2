// remove-users.mjs
// deps: npm i pg dotenv
try { await import('dotenv/config'); } catch {} // optional .env

import { Pool } from 'pg';

const {
  DATABASE_URL,
  PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT,
  PGSSL,

  USER_PREFIX = 'loadtest+',
  DOMAIN = 'ourglp1.com',

  // Optional safety & helpers
  DRY_RUN = '0',          // set to '1' to preview only
  CONFIRM = 'NO',         // must be 'YES' to actually delete (unless DRY_RUN=1)
  // Comma-separated list of extra tables to clean (must have a user_id column)
  // e.g. EXTRA_TABLES="user_sessions,refresh_tokens,audit_logs"
  EXTRA_TABLES = '',
} = process.env;

const pool = new Pool(
  DATABASE_URL
    ? {
        connectionString: DATABASE_URL,
        ssl: /true|1|require/i.test(PGSSL || '') || /sslmode=require/.test(DATABASE_URL)
          ? { rejectUnauthorized: false }
          : undefined,
        max: 10,
      }
    : {
        host: PGHOST,
        user: PGUSER,
        password: PGPASSWORD,
        database: PGDATABASE,
        port: PGPORT ? Number(PGPORT) : 5432,
        ssl: /true|1|require/i.test(PGSSL || '') ? { rejectUnauthorized: false } : undefined,
        max: 10,
      }
);

// Build the LIKE pattern to match your seeded emails
// Example: 'loadtest+%@ourglp1.com'
const EMAIL_PATTERN = `${USER_PREFIX}%@${DOMAIN}`.toLowerCase();

async function tableExists(name) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [name]
  );
  return r.rowCount > 0;
}

async function hasUserIdColumn(name) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='user_id'`,
    [name]
  );
  return r.rowCount > 0;
}

async function main() {
  console.log(`Targeting users with email LIKE "${EMAIL_PATTERN}"`);

  // Count first (always)
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE email LIKE $1`,
    [EMAIL_PATTERN]
  );
  const toDelete = countRes.rows[0]?.n ?? 0;

  if (!toDelete) {
    console.log('Nothing to delete.');
    await pool.end();
    return;
  }

  console.log(`Found ${toDelete} user(s) to delete.`);

  if (DRY_RUN === '1') {
    // show a few examples
    const ex = await pool.query(
      `SELECT email FROM users WHERE email LIKE $1 ORDER BY email LIMIT 5`,
      [EMAIL_PATTERN]
    );
    console.log('Examples:', ex.rows.map(r => r.email));
    console.log('DRY_RUN=1 set — no changes made.');
    await pool.end();
    return;
  }

  if (CONFIRM !== 'YES') {
    console.log('Refusing to delete because CONFIRM is not "YES".');
    console.log('Re-run with: CONFIRM=YES node remove-users.mjs');
    await pool.end();
    return;
  }

  const extras = EXTRA_TABLES.split(',').map(s => s.trim()).filter(Boolean);

  try {
    await pool.query('BEGIN');

    // Optional: clean related tables that have user_id FKs
    for (const t of extras) {
      const exists = await tableExists(t);
      if (!exists) {
        console.log(`.. skip ${t} (table not found)`);
        continue;
      }
      const hasUid = await hasUserIdColumn(t);
      if (!hasUid) {
        console.log(`.. skip ${t} (no user_id column)`);
        continue;
      }
      const del = await pool.query(
        `DELETE FROM "${t}" WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
        [EMAIL_PATTERN]
      );
      console.log(`.. ${t}: deleted ${del.rowCount} row(s)`);
    }

    // Finally: delete users (will rely on ON DELETE CASCADE if you have it)
    const delUsers = await pool.query(
      `DELETE FROM users WHERE email LIKE $1`,
      [EMAIL_PATTERN]
    );
    console.log(`Deleted ${delUsers.rowCount} user(s).`);

    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error('Failed, rolled back. Error:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
