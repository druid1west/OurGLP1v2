// lib/load-env.js
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../../.env');
const result = dotenv.config({ path: envPath });

if (!result || result.error) {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[ENV LOAD ERROR]', result?.error || 'Unknown error');
  } else {
    console.error('[ENV LOAD ERROR] Failed to load environment variables.');
    process.exit(1);
  }
} else {
  console.log('✅ .env loaded and database connection initialized.');
}

if (!process.env.DATABASE_URL) {
  console.error('[ENV LOAD ERROR] DATABASE_URL is not set in .env');
  process.exit(1);
}

console.log('✅ .env loaded and database connection initialized.');