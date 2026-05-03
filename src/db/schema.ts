export const INITIAL_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

-- users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  email_lower TEXT,
  password_hash TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  weight REAL,
  goal_weight REAL,
  medication_name TEXT,
  medication_dose TEXT,
  profile_photo TEXT,
  address1 TEXT,
  address2 TEXT,
  city TEXT,
  country TEXT,
  postcode TEXT,
  injection_day TEXT,
  reset_token TEXT,
  reset_token_expiry TEXT,
  height REAL,
  fasting_schedule TEXT,
  fasting_start TEXT,
  fasting_end TEXT,               -- Added this line
  bmi REAL,
  push_subscription TEXT,
  injection_time TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'email',
  provider_sub TEXT,
  email_verified_at TEXT,
  email_verify_token TEXT,
  email_verify_expiry TEXT,
  apple_private_relay INTEGER NOT NULL DEFAULT 0,
  has_pro INTEGER NOT NULL DEFAULT 0,
  pro_until TEXT,
  subscription_tier TEXT DEFAULT 'free'
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
  ON users(email_lower)
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_provider_sub_unique
  ON users(auth_provider, provider_sub)
  WHERE provider_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_last_login_at_idx ON users(last_login_at);
CREATE INDEX IF NOT EXISTS users_reset_token_idx ON users(reset_token);

-- settings (singleton)
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_logged_in_user_id TEXT,
  push_token TEXT,
  analytics_opt_in INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (id, updated_at) VALUES (1, datetime('now'));

-- Add any other tables you want (reminders, user_injection_schedule, etc.) 
`;