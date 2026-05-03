require('dotenv').config();

const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const webpush = require('web-push');
const dayjs = require('dayjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

webpush.setVapidDetails(
  'mailto:you@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// ✅ Reminder Notification Logic
async function checkReminders() {
  const now = new Date();
  const inOneMinute = new Date(now.getTime() + 60000);

  try {
    const { rows } = await pool.query(`
      SELECT r.*, u.push_subscription, u.email
      FROM reminders r
      JOIN users u ON r.user_id = u.id
      WHERE r.enabled = true
        AND r.datetime IS NOT NULL
        AND (r.datetime - INTERVAL '1 minute' * COALESCE(r.advance_minutes, 0)) <= $1
        AND r.datetime >= $2
        AND (
          ARRAY['push']::text[] <@ r.method OR
          ARRAY['email']::text[] <@ r.method
        )
    `, [inOneMinute, now]);

    for (const reminder of rows) {
      if (reminder.method.includes('push') && reminder.push_subscription) {
        try {
          await webpush.sendNotification(JSON.parse(reminder.push_subscription), JSON.stringify({
            title: '💊 Reminder',
            body: `It's time: ${reminder.title}`,
          }));
          console.log(`📤 Sent push: ${reminder.title}`);
        } catch (err) {
          console.warn(`⚠️ Push failed:`, err.message);
        }
      }

      if (reminder.method.includes('email') && reminder.email) {
        try {
          await transporter.sendMail({
            from: '"GLP-1 App" <reminders@yourdomain.com>',
            to: reminder.email,
            subject: '💊 Reminder',
            text: `It's time for: ${reminder.title}`,
          });
          console.log(`📧 Email sent for: ${reminder.title}`);
        } catch (err) {
          console.warn(`⚠️ Email failed to ${reminder.email}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('❌ Reminder check failed:', err);
  }
}

// ✅ Repeat Prescription Generator
async function handleRepeatPrescriptionReminders() {
  try {
    const now = new Date();

    const { rows } = await pool.query(`
      SELECT * FROM reminders
      WHERE reminder_type = 'repeat_prescription'
      AND enabled = true
      AND datetime < $1
    `, [now]);

    for (const reminder of rows) {
      const nextDate = new Date(reminder.start_date);
      while (nextDate <= now) {
        nextDate.setDate(nextDate.getDate() + reminder.cycle_days);
      }

      const existing = await pool.query(
        `SELECT 1 FROM reminders
         WHERE user_id = $1 AND reminder_type = 'repeat_prescription'
         AND datetime = $2 LIMIT 1`,
        [reminder.user_id, nextDate]
      );

      if (existing.rows.length === 0) {
        await pool.query(`
          INSERT INTO reminders (
            id, user_id, title, reminder_type, datetime, method,
            enabled, advance_minutes, day_of_week, start_date, cycle_days
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5,
            true, $6, $7, $8, $9
          )
        `, [
          reminder.user_id,
          reminder.title,
          reminder.reminder_type,
          nextDate,
          reminder.method,
          reminder.advance_minutes,
          nextDate.toLocaleString('en-US', { weekday: 'long' }).toLowerCase(),
          reminder.start_date,
          reminder.cycle_days
        ]);

        console.log(`🔁 Created next repeat_prescription reminder for ${reminder.user_id} at ${nextDate}`);
      }
    }
  } catch (err) {
    console.error('❌ Error handling repeat prescriptions:', err);
  }
}

// ✅ Run both every minute
setInterval(() => {
  checkReminders();
  handleRepeatPrescriptionReminders();
}, 60 * 1000);