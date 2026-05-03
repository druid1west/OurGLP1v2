// jobs/sendEmailReminders.js
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); // <- ensure env in cron

const nodemailer = require('nodemailer');
const pool = require('../models/db');

// ✉️ Mailer setup (Mailjet SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.MJ_SMTP_HOST || 'in-v3.mailjet.com', // 'smtp.mailjet.com' also works
  port: Number(process.env.MJ_SMTP_PORT || 587),
  secure: false, // TLS upgraded on 587
  auth: {
    user: process.env.MAILJET_API_KEY || process.env.MAIL_USER || 'REPLACE_ME',
    pass: process.env.MAILJET_SECRET  || process.env.MAIL_PASS || 'REPLACE_ME',
  },
  // pool: true, // optional if you expect bursts
});

// 💌 Email Message Builder
function buildEmailMessage(reminder) {
  const messages = {
    injection:           { subject: '💉 Time for your GLP-1 injection',          body: 'Just a friendly reminder to take your scheduled GLP-1 injection today.' },
    protein:             { subject: '💪 Protein Goal Reminder',                  body: 'Fuel those muscles! Don’t forget to hit your protein target today.' },
    electrolytes:        { subject: '🧂 Electrolytes Check-in',                  body: 'Time to take your electrolyte supplement.' },
    blood_sugar:         { subject: '🩸 Blood Sugar Log Reminder',               body: 'Please check and log your blood sugar levels.' },
    blood_pressure:      { subject: '🩺 Blood Pressure Time',                    body: 'Time to measure your blood pressure.' },
    exercise:            { subject: '🏃 Workout Reminder',                       body: 'Let’s get moving! Your workout is scheduled.' },
    bowel_movement:      { subject: '🚽 Bowel Movement Reminder',                body: 'Remember to log your bowel movement today.' },
    repeat_prescription: { subject: '📦 Repeat Prescription Time',               body: 'Request your repeat prescription now to stay on track.' },
  };

  const key = (reminder.reminder_type || reminder.title || '').toLowerCase();
  return messages[key] || { subject: `🔔 Reminder: ${reminder.title}`, body: 'This is a reminder you scheduled.' };
}

// 🚀 Email Reminder Job
(async () => {
  try {
    // Only reminders with method including 'email'
    // Use COALESCE for advance_minutes (NULL => 0) and ensure datetime not null
    const { rows: reminders } = await pool.query(`
      SELECT r.*, u.email
        FROM reminders r
        JOIN users u ON r.user_id = u.id
       WHERE r.enabled = true
         AND r.datetime IS NOT NULL
         AND r.method @> ARRAY['email']::text[]
         AND (r.datetime - (COALESCE(r.advance_minutes, 0) * interval '1 minute')) <= now()
         AND (r.datetime > now() - interval '10 minutes')
         AND (r.last_sent_at IS NULL OR r.last_sent_at < now() - interval '10 minutes')
    `);

    if (!reminders.length) {
      console.log('ℹ️ No email reminders due right now.');
      return;
    }

    for (const reminder of reminders) {
      const { email } = reminder;
      if (!email) {
        console.warn(`⚠️ No email address for user ${reminder.user_id}`);
        continue;
      }

      const message = buildEmailMessage(reminder);

      try {
        await transporter.sendMail({
          from: process.env.MAIL_FROM || '"OurGLP1" <reminders@ourglp1.com>',
          to: email,
          subject: message.subject,
          text: message.body,
        });

        await pool.query(`UPDATE reminders SET last_sent_at = now() WHERE id = $1`, [reminder.id]);
        console.log(`✅ Email sent for reminder "${reminder.title}" to ${email}`);
      } catch (err) {
        console.error(`❌ Failed to send email for reminder ${reminder.id}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('❌ Error running email reminder job:', err);
  } finally {
    // Prevent connection leaks in cron
    try { await pool.end?.(); } catch {}
  }
})();