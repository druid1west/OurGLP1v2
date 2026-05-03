'use strict';

require('dotenv').config();
const apn = require('apn');
const path = require('path');
const pool = require('./models/db');

// 🔐 APNs configuration (token-based auth)
const apnOptions = {
  token: {
    key: process.env.APNS_KEY_PATH
      ? path.resolve(process.env.APNS_KEY_PATH)
      : path.resolve(__dirname, 'keys', 'AuthKey_3HC24BVH2P.p8'),
    keyId: process.env.APNS_KEY_ID || '3HC24BVH2P',
    teamId: process.env.APNS_TEAM_ID || 'D6K24WN2FS',
  },
  // false = sandbox (Xcode/debug builds), true = production (App Store/TestFlight)
  production: String(process.env.APNS_PRODUCTION || '').toLowerCase() === 'true',
};

// 🏷️ Topic (bundle id) MUST match the app that generated the token
const APNS_TOPIC = process.env.APNS_TOPIC || 'com.ourglp1.app';

// 🔌 Initialize APNs provider once (singleton)
const apnProvider = new apn.Provider(apnOptions);

/** Small helper: validate UUID v1-5 (for push_logs FK safety) */
const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/** Safe getter for APNs id from node-apn result entries */
function getApnsId(entry) {
  try {
    const headers = entry?.response?.headers || {};
    return headers['apns-id'] || headers['apns-unique-id'] || null;
  } catch {
    return null;
  }
}

/**
 * Build a human-friendly push message for the reminder.
 */
function buildPushMessage(reminder) {
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
  return messages[key] || `🔔 Reminder: ${reminder.title || 'Reminder'}`;
}

/**
 * Send an APNs push notification.
 *
 * @param {string} deviceToken - The iOS device token.
 * @param {object} reminder - The reminder object.
 * @param {object} [options]
 *   - alert: string | { title?: string, body: string }
 *   - sound: string | { critical?: 1, name?: string, volume?: number }
 *   - badge: number
 *   - interruptionLevel: 'passive' | 'active' | 'time-sensitive' | 'critical'
 *   - threadId, topic, expiry, pushType, priority, payload, mutableContent
 * @returns {Promise<object>} - APNs result
 */
async function sendPush(deviceToken, reminder, options = {}) {
  if (!deviceToken || typeof deviceToken !== 'string') {
    throw new Error('Invalid or missing deviceToken');
  }
  if (!reminder || typeof reminder !== 'object') {
    throw new Error('Reminder object is required');
  }

  const message = buildPushMessage(reminder);
  const notification = new apn.Notification();

  // --- Core alert / sound / badge ---
  const bodyText = typeof options.alert === 'string' ? options.alert : message;
  notification.alert = options.alert || bodyText;           // string -> body, object -> title/body
  notification.sound = options.sound || 'default';          // ensures a sound plays (if not muted)
  if (typeof options.badge === 'number') notification.badge = options.badge;

  // --- Transport metadata ---
  notification.topic    = options.topic || APNS_TOPIC;
  notification.pushType = options.pushType || 'alert';      // must be 'alert' for banner/sound
  notification.priority = typeof options.priority === 'number' ? options.priority : 10; // immediate
  notification.expiry   = options.expiry || Math.floor(Date.now() / 1000) + 60 * 5;      // 5 min TTL
  notification.threadId = options.threadId || 'reminders';
  notification.mutableContent = options.mutableContent ? 1 : 0;

  // --- App payload (attach so the app sees extras) ---
  const basePayload = {
    source: 'reminder',
    reminderId: reminder.id,
    ...(options.payload || {}),
  };

  // --- OPTIONAL: Focus / iOS 15+ time-sensitive / critical ----------------
  if (options.interruptionLevel) {
    const aps = {
      alert: typeof options.alert === 'object'
        ? options.alert
        : { body: bodyText },
      sound: notification.sound || 'default',
      ...(typeof notification.badge === 'number' ? { badge: notification.badge } : {}),
      'thread-id': notification.threadId,
      ...(notification.mutableContent ? { 'mutable-content': 1 } : {}),
      'interruption-level': options.interruptionLevel,
    };
    // If you have Critical Alerts entitlement, you can pass:
    // options.sound = { critical: 1, name: 'default', volume: 1 }
    notification.rawPayload = { aps, ...basePayload };
  } else {
    notification.payload = basePayload;
  }
  // ------------------------------------------------------------------------

  try {
    console.log(
      `📨 Sending push to ${deviceToken} (user ${reminder.user_id || 'unknown'}, topic ${
        notification.topic
      }, env ${apnOptions.production ? 'prod' : 'dev'}): "${message}"`
    );

    const result = await apnProvider.send(notification, deviceToken);

    // ✅ SUCCESS
    if (result.failed?.length === 0 && result.sent?.length > 0) {
      const firstSent = result.sent[0];
      const apnsId = getApnsId(firstSent);
      if (apnsId) {
        console.log(`🆔 APNs id: ${apnsId} (paste this into Apple Push Notification Console to inspect)`);
      } else {
        console.log('🆔 APNs id: <not returned by APNs>');
      }

      console.log(`✅ APNs push sent to ${deviceToken}`);

      // --- Resilient logging (no FK if reminder.id is not a UUID) -----------
      try {
        if (isUuid(reminder.id)) {
          await pool.query(
            `INSERT INTO push_logs (user_id, reminder_id, message)
             VALUES ($1, $2::uuid, $3)`,
            [reminder.user_id, reminder.id, message]
          );
        } else {
          await pool.query(
            `INSERT INTO push_logs (user_id, message)
             VALUES ($1, $2)`,
            [reminder.user_id, message]
          );
        }
      } catch (logErr) {
        console.warn('⚠️ Failed to write push_logs (non-fatal):', logErr.message || logErr);
      }
      // ----------------------------------------------------------------------

      return result;
    }

    // ❌ FAILURE
    if (result.failed?.length > 0) {
      const failure = result.failed[0];
      const reason =
        failure?.response?.reason ||
        failure?.error?.message ||
        failure?.error ||
        'Unknown failure';
      const apnsIdFail = getApnsId(failure);
      if (apnsIdFail) {
        console.warn(`🆔 APNs id (failed): ${apnsIdFail}`);
      }
      console.warn('❌ APNs push failed:', reason);

      // Clean up unregistered tokens
      if (/Unregistered|BadDeviceToken|DeviceTokenNotForTopic/i.test(String(reason))) {
        await removeInvalidTokenFromDB(reminder.user_id, deviceToken);
      }

      throw new Error(`Push failed: ${reason}`);
    }

    // Edge: neither sent nor failed populated
    console.warn('❓ APNs returned no sent/failed entries.');
    return result;
  } catch (err) {
    console.error('❌ sendPush() error:', err.stack || err.message || err);
    throw err;
  }
}

/**
 * Remove invalid tokens for a user (e.g., Unregistered).
 */
async function removeInvalidTokenFromDB(userId, deviceToken) {
  try {
    if (!userId) return;
    await pool.query(
      'DELETE FROM push_tokens WHERE user_id = $1 AND token = $2',
      [userId, deviceToken]
    );
    console.log('✅ Invalid push token removed from DB');
  } catch (err) {
    console.error('❌ Error removing invalid token from DB:', err.message || err);
  }
}

module.exports = sendPush;
