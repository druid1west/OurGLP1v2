import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { INITIAL_SCHEMA_SQL } from './schema';

const DB_NAME = 'ourglp1';

export async function initDatabase() {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  await db.open();

  // Check if core tables exist
  const { values } = await db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','settings')"
  );
  const haveCore = (values ?? []).length === 2;

  if (!haveCore) {
    await db.execute(INITIAL_SCHEMA_SQL);
    await db.execute('PRAGMA user_version = 1;');
  }

  // TODO: run migrations here if you bump user_version later

  return db;
}