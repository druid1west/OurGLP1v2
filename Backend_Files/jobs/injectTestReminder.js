const pool = require('../models/db');
const dayjs = require('dayjs');

(async () => {
  const userId = '0d336aff-aea0-40a8-93bf-3bf1784c8496';

  const emailMethod = ['email']; // Or ['email', 'push'] if you want both
  const datetime = dayjs().add(1, 'minute').toISOString();

  try {
    const { rows } = await pool.query(`
      INSERT INTO reminders (user_id, title, datetime, method, advance_minutes, enabled, reminder_type)
      VALUES ($1, $2, $3, $4, $5, true, $6)
      RETURNING id
    `, [
      userId,
      'Test Email Reminder',
      datetime,
      emailMethod,
      1, // 1-minute advance
      'protein', // or 'injection', 'exercise', etc.
    ]);

    console.log('✅ Injected test reminder with ID:', rows[0].id);
  } catch (err) {
    console.error('❌ Failed to insert test reminder:', err);
  }
})();