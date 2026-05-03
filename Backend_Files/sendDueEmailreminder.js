const path = require('path');
const dayjs = require('dayjs');
const nodemailer = require('nodemailer');
const pool = require('./models/db'); 
const sendPush = require('./sendPush');

/** 🌍 Configuration check */
if (!process.env.MAIL_PASS) {
  console.error('❌ MAIL_PASS is missing in .env. Aborting.');
  process.exit(1);
}

/** ✉️ Mailer setup (Mailjet SMTP) */
const transporter = nodemailer.createTransport({
  host: 'smtp.mailjet.com',
  port: 587,
  secure: false,
  auth: {
    user: '5a3b1be8339cf5216caea7fe92b7ce97',
    pass: process.env.MAIL_PASS,
  },
});

transporter.verify((err, success) => {
  if (err) {
    console.error('❌ Failed to verify mail transport:', err);
  } else {
    console.log('✅ Mailer is ready:', success);
  }
});

/** 📧 Builds dynamic email HTML */
function buildHtmlTemplate(reminder) {
  const { first_name, title, reminder_type, datetime, user_id } = reminder;
  const scheduledFor = dayjs(datetime).format('dddd HH:mm');
  const unsubscribeLink = `https://app.ourglp1.com/reminders/unsubscribe/${user_id}`;

  const messages = {
    injection: `<p>It's time for your scheduled <strong>GLP-1 injection</strong>. Please take it as prescribed.</p>`,
    protein: `<p>Don't forget to reach your <strong>daily protein goal</strong>. A quick snack now might help!</p>`,
    electrolytes: `<p>This is your reminder to take your <strong>electrolyte supplement</strong> today.</p>`,
    blood_sugar: `<p>Please take a moment to <strong>check and log your blood sugar</strong>.</p>`,
    blood_pressure: `<p>Please <strong>measure and record your blood pressure</strong> now.</p>`,
    exercise: `<p>Time to get moving! Your <strong>exercise reminder</strong> is here.</p>`,
    bowel_movement: `<p>Just a gentle reminder to <strong>log your bowel movement</strong> if needed.</p>`,
    repeat_prescription: `<p>It's time to <strong>request your repeat prescription</strong>. Stay on top of your meds!</p>`,
  };

  const body = messages[(reminder_type || title || '').toLowerCase()] || `<p>This is your scheduled reminder: <strong>${title}</strong>.</p>`;

  return `
    <div style="font-family: Arial, sans-serif; padding: 1rem;">
      <img src="https://app.ourglp1.com/assets/logo1.png" alt="GLP-1 Health App Logo" style="width: 120px; margin-bottom: 1rem;" />
      <h2 style="color: #0d2b2b;">⏰ Reminder: ${title}</h2>
      <p>Hi ${first_name},</p>
      ${body}
      <p>Scheduled for: <strong>${scheduledFor}</strong>.</p>
      <hr style="margin-top: 2rem;" />
      <p style="font-size: 0.8rem; color: #999;">
        You received this email because you enabled email reminders in your GLP-1 Health App settings.<br/>
        <a href="${unsubscribeLink}" style="color: #999; text-decoration: underline;">Unsubscribe from reminders</a>
      </p>
    </div>
  `;
}

/** 🚀 Run reminder job */
async function sendDueReminders() {
  try {
    const { rows: reminders } = await pool.query(`
      SELECT r.*, u.email, u.first_name, pt.token AS push_token
      FROM reminders r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT token FROM push_tokens pt WHERE pt.user_id = u.id ORDER BY pt.created_at DESC LIMIT 1
      ) pt ON true
      WHERE r.enabled = true
        AND r.datetime - (r.advance_minutes * interval '1 minute') <= now()
        AND r.datetime > now() - interval '10 minutes'
        AND (r.last_sent_at IS NULL OR r.last_sent_at < now() - interval '10 minutes')
    `);

    if (reminders.length === 0) {
      console.log('ℹ️ No reminders due right now.');
      return;
    }

    for (const reminder of reminders) {
      const sendTime = dayjs(reminder.datetime).subtract(reminder.advance_minutes, 'minute');

      if (reminder.method.includes('email') && reminder.email) {
        try {
          await transporter.sendMail({
            from: `"GLP-1 Health App" <info@ourglp1.com>`,
            to: reminder.email,
            subject: `⏰ Reminder: ${reminder.title}`,
            text: `Hi ${reminder.first_name},\n\nJust a reminder: "${reminder.title}" is scheduled.\n\nGLP-1 Health App Team`,
            html: buildHtmlTemplate(reminder),
          });
          console.log(`✅ Sent email to ${reminder.email} for "${reminder.title}"`);
        } catch (err) {
          console.warn(`❌ Email failed to ${reminder.email}:`, err.message);
        }
      }

      if (reminder.method.includes('push') && reminder.push_token) {
        try {
          await sendPush(reminder.push_token, reminder);
        } catch (err) {
          console.warn(`⚠️ Push failed for ${reminder.push_token}:`, err.message);
        }
      }

      await pool.query(`UPDATE reminders SET last_sent_at = now() WHERE id = $1`, [reminder.id]);
    }
  } catch (err) {
    console.error('❌ Error sending reminders:', err);
  }
}

/** 🔁 Generate next repeat prescription reminders */
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

(async () => {
  await sendDueReminders();
  await handleRepeatPrescriptionReminders();
})();