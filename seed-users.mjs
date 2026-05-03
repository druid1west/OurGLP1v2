// seed-users.mjs
try { await import('dotenv/config'); } catch {} // optional .env

import { Pool } from 'pg';
import bcrypt from 'bcrypt';

const {
  DATABASE_URL,
  PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT,
  PGSSL,
  SEED_USERS = '100',
  SEED_PASSWORD = 'Passw0rd!',
  BCRYPT_ROUNDS = '12',
  USER_PREFIX = 'loadtest+',
  DOMAIN = 'ourglp1.com',
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

const INSERT_SQL = `
WITH s AS (SELECT 1 FROM users WHERE email = $3)
INSERT INTO users (first_name, last_name, email, password_hash)
SELECT $1, $2, $3, $4
WHERE NOT EXISTS (SELECT 1 FROM s)
RETURNING id
`;

async function main() {
  const total = Number(SEED_USERS);
  const rounds = Number(BCRYPT_ROUNDS);
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, rounds);
  console.log(`Seeding ${total} users with bcrypt rounds=${rounds}…`);

  let created = 0, existing = 0;

  for (let i = 1; i <= total; i++) {
    const email = `${USER_PREFIX}${i}@${DOMAIN}`.toLowerCase();
    const first = 'Load';
    const last  = `Tester${i}`;
    try {
      const { rows } = await pool.query(INSERT_SQL, [first, last, email, passwordHash]);
      if (rows.length) created++;
      else existing++;
      if (i % 50 === 0) {
        console.log(`.. ${i}/${total} (created: ${created}, skipped: ${existing})`);
      }
    } catch (e) {
      console.error(`Failed on ${email}:`, e.message);
    }
  }

  console.log(`Done. Created: ${created}, skipped (already present): ${existing}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
