// GLP1/sendPushUniversal.js
const pool = require('./models/db');
const sendPushIOS = require('./sendPush');           // APNs sender (you already have)
const sendPushAndroid = require('./sendPushAndroid'); // FCM sender (you already have)

/**
 * Send to one token via the correct provider.
 */
async function sendToToken({ token, platform = 'ios', reminder, options = {} }) {
  const plat = String(platform || 'ios').toLowerCase();
  if (plat === 'android') {
    return sendPushAndroid(token, reminder, options);
  }
  return sendPushIOS(token, reminder, options);
}

/**
 * Universal push:
 * - EITHER pass { token, platform, reminder, options } to send to one device
 * - OR pass { userId, reminder, options } to fan out to all of the user's tokens
 *
 * Returns:
 *  - single send: whatever the provider returns
 *  - multi send: { tried, tokens }
 */
async function sendPushUniversal({ token, platform, userId, reminder, options = {} }) {
  if (!reminder) throw new Error('Missing reminder');

  // Fan-out mode: send to all tokens for user
  if (userId && !token) {
    const { rows: toks } = await pool.query(
      'SELECT token, platform FROM push_tokens WHERE user_id = $1 ORDER BY updated_at DESC NULLS LAST',
      [userId]
    );

    let tried = 0;

    for (const t of toks) {
      try {
        await sendToToken({
          token: t.token,
          platform: t.platform || 'ios',
          reminder,
          options,
        });
        tried++;
      } catch (err) {
        // Normalize reason and try to clean obviously invalid tokens
        const reason =
          err?.response?.reason ||
          err?.error?.message ||
          err?.message ||
          String(err);

        const rlow = String(reason).toLowerCase();
        const badIOS = /unregistered|baddevicetoken|devicetokennotfortopic/i.test(reason);
        const badFCM = rlow.includes('notregistered') || rlow.includes('registration-token-not-registered');

        if (badIOS || badFCM) {
          try {
            await pool.query('DELETE FROM push_tokens WHERE token = $1', [t.token]);
            // console.warn('[push] removed invalid token')
          } catch {/* ignore DB cleanup errors */}
        }

        // continue to next token without failing the batch
      }
    }
    return { tried, tokens: toks.length };
  }

  // Single-token mode
  if (!token) throw new Error('Missing token');
  return sendToToken({ token, platform: platform || 'ios', reminder, options });
}

module.exports = sendPushUniversal;