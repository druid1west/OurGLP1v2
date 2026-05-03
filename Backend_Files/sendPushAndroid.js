// sendPushAndroid.js
require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('./models/db');

const hash12 = (s = '') =>
  s ? crypto.createHash('sha256').update(s).digest('hex').slice(0, 12) : null;

function loadServiceAccount() {
  const p = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : path.resolve(__dirname, 'config', 'firebase-service-account.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
  });
}

/**
 * Remove invalid Android token (NotRegistered, etc.)
 */
async function removeInvalidTokenFromDB(userId, deviceToken) {
  try {
    if (!deviceToken) return;
    await pool.query('DELETE FROM push_tokens WHERE token = $1', [deviceToken]);
    console.log('✅ Invalid Android FCM token removed from DB', {
      userId: userId || null,
      tokenHash: hash12(deviceToken),
    });
  } catch (err) {
    console.warn('⚠️ Failed to delete invalid Android token (non-fatal):', err?.message || err);
  }
}

/**
 * @param {string} token - FCM registration token (Android device)
 * @param {object} reminder - { id, title?, reminder_type?, user_id? }
 * @param {object} [options]
 */
async function sendPushAndroid(token, reminder, options = {}) {
  if (!token) throw new Error('Missing FCM token');

  const messages = {
    injection: '💉 Time for your GLP-1 injection.',
    protein: '💪 Time to hit your protein goal.',
    electrolytes: '🧂 Take your electrolyte supplement.',
    blood_sugar: '🩸 Check and log your blood sugar.',
    blood_pressure: '🩺 Time to measure your blood pressure.',
    exercise: '🏃 Let’s move! Your workout is scheduled.',
    bowel_movement: '🚽 Log your bowel movement.',
    repeat_prescription: '📦 Request your repeat prescription.',
  };

  const key = (reminder.reminder_type || reminder.title || '').toLowerCase();
  const body = options.body || messages[key] || `🔔 Reminder: ${reminder.title || 'Reminder'}`;
  const title = options.title || 'Paris Clinic';

  const message = {
    token,
    notification: { title, body }, // shows system UI when app is background/killed
    android: {
      priority: 'high',                      // delivery priority
      ttl: options.ttl || 1000 * 60 * 5,     // 5 minutes
      notification: {
        channelId: options.channelId || 'reminders', // MUST exist on device
        sound: options.sound || 'default',
        notificationPriority: 'PRIORITY_HIGH',       // heads-up on more devices
        visibility: 'PUBLIC',
      },
    },
    data: {
      source: 'reminder',
      reminderId: String(reminder.id || ''),
      route: options.route || '/reminders',          // 👈 used by tap handler in app
      ...(options.data || {}),
    },
  };

  try {
    console.log(
      '📨 [FCM] Sending to Android',
      JSON.stringify({
        userId: reminder.user_id || null,
        tokenHash: hash12(token),
        channelId: message.android.notification.channelId,
        title,
      })
    );

    const res = await admin.messaging().send(message);
    console.log('✅ [FCM] Android push sent', { id: res });

    // Resilient logging (same pattern as iOS)
    try {
      const { rowCount } = await pool.query(
        `INSERT INTO push_logs (user_id, reminder_id, message)
         SELECT $1, r.id, $3
           FROM reminders r
          WHERE r.id = $2`,
        [reminder.user_id || null, reminder.id, body]
      );
      if (rowCount === 0) {
        await pool.query(
          `INSERT INTO push_logs (user_id, message) VALUES ($1, $2)`,
          [reminder.user_id || null, body]
        );
      }
    } catch (logErr) {
      console.warn('⚠️ Failed to write push_logs (non-fatal):', logErr?.message || logErr);
    }

    return { success: true, id: res };
  } catch (err) {
    const msg = err?.errorInfo?.message || err?.message || String(err);
    console.warn('❌ [FCM] Android push error:', msg);

    // Clean up unregistered tokens
    const low = msg.toLowerCase();
    if (low.includes('notregistered') || low.includes('registration-token-not-registered')) {
      await removeInvalidTokenFromDB(reminder.user_id, token);
      throw new Error('Push failed: NotRegistered');
    }

    throw err;
  }
}

module.exports = sendPushAndroid;