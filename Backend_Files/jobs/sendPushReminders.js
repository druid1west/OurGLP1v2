// jobs/sendPushReminders.js
// Sends each due push reminder ONCE within a short window, logs it,
// and removes 'push' from the reminder so it won't be re-sent.

require('../lib/load-env'); // ensure .env is loaded before anything else
const db = require('../models/db'); // exports a real pg Pool (connect/query)
const sendPush = require('../sendPush');

// Choose a window longer than your cron interval (cron is */3 -> use 6)
const SEND_WINDOW_MINUTES = 6;
// Cap per run (keeps each transaction snappy)
const BATCH_LIMIT = 200;

(async () => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Safety: don't hold locks forever if something stalls
    await client.query(`SET LOCAL statement_timeout = '10s'`);
    await client.query(`SET LOCAL lock_timeout = '2s'`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '15s'`);

    // Select & LOCK only reminders rows; fetch token via scalar subquery
    const { rows: reminders } = await client.query(
      `
      SELECT
        r.*,
        (
          SELECT pt.token
          FROM push_tokens pt
          WHERE pt.user_id = r.user_id
          ORDER BY pt.created_at DESC
          LIMIT 1
        ) AS token
      FROM reminders r
      WHERE r.enabled = true
        AND 'push' = ANY(r.method)
        AND r.last_sent_at IS NULL
        AND (r.datetime - COALESCE(r.advance_minutes, 0) * INTERVAL '1 minute')
              BETWEEN now() - ($1 || ' minutes')::interval AND now()
      ORDER BY (r.datetime - COALESCE(r.advance_minutes, 0) * INTERVAL '1 minute') ASC
      LIMIT ${BATCH_LIMIT}
      FOR UPDATE SKIP LOCKED
      `,
      [String(SEND_WINDOW_MINUTES)]
    );

    if (reminders.length === 0) {
      await client.query('COMMIT');
      console.log('ℹ️ No push reminders due right now.');
      return;
    }

    console.log(`➡️  Processing ${reminders.length} reminder(s) for push…`);

    for (const r of reminders) {
      try {
        if (!r.token) {
          await client.query(
            `INSERT INTO push_logs (user_id, reminder_id, message)
             VALUES ($1, $2, 'push skipped: no token')`,
            [r.user_id, r.id]
          );
          console.warn(`⚠️ Skipped reminder ${r.id} for user ${r.user_id}: no push token`);
          continue;
        }

        // Send the push
        await sendPush(r.token, {
          id: r.id,
          title: r.title,
          message: r.message,
          user_id: r.user_id,
          scheduled_at: r.datetime, // optional context for the provider
        });

        // Stop future pushes for this reminder and mark last_sent_at
        await client.query(
          `UPDATE reminders
             SET method = array_remove(method, 'push'),
                 last_sent_at = now()
           WHERE id = $1 AND 'push' = ANY(method)`,
          [r.id]
        );

        // Audit log
        await client.query(
          `INSERT INTO push_logs (user_id, reminder_id, message)
           VALUES ($1, $2, 'push sent')`,
          [r.user_id, r.id]
        );

        console.log(`✅ Push sent for reminder "${r.title}" (id=${r.id}) → user ${r.user_id}`);
      } catch (err) {
        // Log the failure; leave 'push' in method so cron can retry next run
        await client.query(
          `INSERT INTO push_logs (user_id, reminder_id, message)
           VALUES ($1, $2, $3)`,
          [r.user_id, r.id, `push failed: ${err.message}`]
        );
        console.error(`❌ Push failed for reminder id=${r.id}: ${err.message}`);
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Error running push reminder job:', e);
  } finally {
    try { client.release(); } catch (_) {}
  }
})();