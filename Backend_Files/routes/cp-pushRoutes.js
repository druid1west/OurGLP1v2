// routes/health.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const requireLogin = require('../middleware/requireLogin');
const baseLogger = require('../logger'); // fallback if req.log not present

// Small helper to avoid dumping PHI/PII
function summarizePayload(entryType, data) {
  const summary = { entryType, hasData: !!data, dataType: typeof data };

  // Include a couple of safe, non-PII fields per entry type
  try {
    if (entryType === 'protein' && data && typeof data === 'object') {
      summary.grams = Number(data.grams ?? 0);
      summary.hasNotes = Boolean(data.notes);
    }
    if (entryType === 'hydration' && data && typeof data === 'object') {
      summary.amount = Number(data.amount ?? 0);
      summary.hasNote = Boolean(data.note);
    }
    if (entryType === 'blood_pressure' && data && typeof data === 'object') {
      // DO NOT log exact values; just shape
      summary.hasSystolic = typeof data.systolic !== 'undefined';
      summary.hasDiastolic = typeof data.diastolic !== 'undefined';
    }
    if (entryType === 'blood_sugar' && data && typeof data === 'object') {
      summary.hasReading = typeof data.value !== 'undefined';
    }
    if (entryType === 'bowel') {
      // no details needed
    }
    if (entryType === 'mood' && data && typeof data === 'object') {
      summary.score = Number(data.score ?? 0);
      summary.hasNote = Boolean(data.note);
    }
  } catch (_) {
    // ignore parse errors; keep logs safe
  }

  // lightweight size hint (helps debugging without content)
  try {
    summary.bytes = Buffer.byteLength(JSON.stringify(data ?? ''), 'utf8');
  } catch {
    summary.bytes = null;
  }

  return summary;
}

function getReqLogger(req) {
  // prefer request-scoped child logger
  return (req.log || baseLogger).child({
    route: 'health',
    userId: req.session?.user?.id ?? null,
  });
}

// POST /health-log  (generic writer)
// body: { entryType, data, recordedAt }
router.post('/health-log', requireLogin, async (req, res) => {
  const log = getReqLogger(req);
  const { entryType, data, recordedAt } = req.body;

  log.info(summarizePayload(entryType, data), 'POST /health-log');

  const allowed = ['blood_sugar', 'blood_pressure', 'bowel', 'protein', 'hydration', 'mood'];
  if (!allowed.includes(entryType)) {
    log.warn({ entryType }, 'Invalid entryType');
    return res.status(400).json({ error: 'Invalid entry type' });
  }

  // basic recordedAt check (avoid “Invalid Date”)
  const ts = new Date(recordedAt);
  if (Number.isNaN(ts.getTime())) {
    log.warn({ recordedAt }, 'Invalid recordedAt timestamp');
    return res.status(400).json({ error: 'Invalid recordedAt' });
  }

  try {
    const userId = req.session.user.id;

    switch (entryType) {
      case 'blood_sugar':
        await pool.query(
          `INSERT INTO user_health_logs (user_id, entry_type, data, recorded_at)
           VALUES ($1, $2, $3, $4)`,
          [userId, 'blood_sugar', JSON.stringify(data ?? {}), ts]
        );
        break;

      case 'blood_pressure':
        await pool.query(
          `INSERT INTO user_health_logs (user_id, entry_type, data, recorded_at)
           VALUES ($1, $2, $3, $4)`,
          [userId, 'blood_pressure', JSON.stringify(data ?? {}), ts]
        );
        break;

      case 'hydration':
        await pool.query(
          `INSERT INTO user_health_logs
           (user_id, entry_type, hydration_amount, hydration_note, recorded_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, 'hydration', data?.amount ?? null, data?.note ?? null, ts]
        );
        break;

      case 'bowel':
        await pool.query(
          `INSERT INTO user_health_logs (user_id, entry_type, data, recorded_at)
           VALUES ($1, $2, $3, $4)`,
          [userId, 'bowel', '{}', ts]
        );
        break;

      case 'protein':
        await pool.query(
          `INSERT INTO user_health_logs (user_id, entry_type, protein_grams, protein_notes, recorded_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, 'protein', data?.grams ?? null, data?.notes ?? null, ts]
        );
        break;

      case 'mood': {
        // store in JSONB; keep structure light
        const score = Math.max(1, Math.min(5, Number(data?.score ?? 0) || 0));
        const payload = {
          score,
          ...(data?.note ? { note: String(data.note) } : {}),
          ...(data?.context ? { context: data.context } : {}),
        };
        await pool.query(
          `INSERT INTO user_health_logs (user_id, entry_type, data, recorded_at)
           VALUES ($1, 'mood', $2, $3)`,
          [userId, JSON.stringify(payload), ts]
        );
        break;
      }
    }

    log.debug({ entryType }, 'Health log inserted');
    res.json({ success: true });
  } catch (err) {
    log.error({ err }, 'Insert failed');
    res.status(500).json({ error: 'Failed to save log' });
  }
});

// GET /health-logs  — include id so the client can delete by id
router.get('/health-logs', requireLogin, async (req, res) => {
  const log = getReqLogger(req);
  try {
    const { rows } = await pool.query(
      `SELECT
         id,
         entry_type,
         recorded_at,
         CASE
           WHEN entry_type = 'hydration' THEN jsonb_build_object(
             'amount', hydration_amount,
             'note',   hydration_note
           )
           WHEN entry_type = 'protein' THEN jsonb_build_object(
             'grams', protein_grams,
             'notes', protein_notes
           )
           ELSE COALESCE(data, '{}'::jsonb)
         END AS data
       FROM user_health_logs
       WHERE user_id = $1
       ORDER BY recorded_at DESC`,
      [req.session.user.id]
    );
    log.info({ count: rows.length }, 'Fetched health logs');
    res.json(rows);
  } catch (err) {
    log.error({ err }, 'Error fetching health logs');
    res.status(500).json({ error: 'Failed to fetch health logs' });
  }
});

// DELETE /health-log/:id — delete by id scoped to the logged-in user
router.delete('/health-log/:id', requireLogin, async (req, res) => {
  const log = getReqLogger(req);
  const { id } = req.params;

  // basic numeric id guard
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM user_health_logs
        WHERE id = $1 AND user_id = $2
      RETURNING id`,
      [Number(id), req.session.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Log not found' });
    }

    log.info({ deleted: result.rows[0].id }, 'Deleted health log by id');
    res.status(204).send(); // or res.json({ success: true })
  } catch (err) {
    log.error({ err }, 'Error deleting health log');
    res.status(500).json({ error: 'Failed to delete health log' });
  }
});

/**
 * Convenience endpoints to match DayPage.tsx:
 *  POST   /api/health/mood     { score:1..5, recorded_at?:ISO, note?, context? } -> returns created row
 *  DELETE /api/health/mood/:id -> { ok:true }
 */
router.post('/mood', requireLogin, async (req, res) => {
  const log = getReqLogger(req);
  try {
    const userId = req.session.user.id;
    const { score, recorded_at, note, context } = req.body || {};
    const s = Math.max(1, Math.min(5, Number(score || 0)));
    if (!s) return res.status(400).json({ error: 'score must be 1..5' });

    const ts = recorded_at ? new Date(recorded_at) : new Date();
    if (Number.isNaN(ts.getTime())) return res.status(400).json({ error: 'invalid recorded_at' });

    const payload = {
      score: s,
      ...(note ? { note: String(note) } : {}),
      ...(context ? { context } : {}),
    };

    const { rows } = await pool.query(
      `INSERT INTO user_health_logs (user_id, entry_type, data, recorded_at)
       VALUES ($1, 'mood', $2, $3)
       RETURNING id, entry_type, recorded_at, data`,
      [userId, JSON.stringify(payload), ts]
    );

    log.info({ id: rows[0].id }, 'Mood inserted');
    res.json(rows[0]);
  } catch (e) {
    log.error({ e }, 'POST /mood failed');
    res.status(500).json({ error: 'server_error' });
  }
});

router.delete('/mood/:id', requireLogin, async (req, res) => {
  const log = getReqLogger(req);
  try {
    const userId = req.session.user.id;
    const { id } = req.params;

    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'invalid id' });

    const { rowCount } = await pool.query(
      `DELETE FROM user_health_logs
       WHERE id = $1 AND user_id = $2 AND entry_type = 'mood'`,
      [Number(id), userId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'not_found' });

    log.info({ id }, 'Mood deleted');
    res.json({ ok: true });
  } catch (e) {
    log.error({ e }, 'DELETE /mood/:id failed');
    res.status(500).json({ error: 'server_error' });
  }
});

// Totals
router.get('/protein-total-today', requireLogin, async (req, res) => {
  const log = getReqLogger(req);
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(protein_grams), 0) AS total
         FROM user_health_logs
        WHERE user_id = $1
          AND entry_type = 'protein'
          AND recorded_at >= CURRENT_DATE
          AND recorded_at < CURRENT_DATE + INTERVAL '1 day'`,
      [req.session.user.id]
    );
    const total = rows[0]?.total ?? 0;
    log.debug({ total }, 'Protein total today');
    res.json({ total });
  } catch (err) {
    log.error({ err }, 'Error getting protein total');
    res.status(500).json({ error: 'Failed to calculate protein total' });
  }
});

router.get('/hydration-total-today', requireLogin, async (req, res) => {
  const log = getReqLogger(req);
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(hydration_amount), 0) AS total_ml
         FROM user_health_logs
        WHERE user_id = $1
          AND entry_type = 'hydration'
          AND recorded_at >= CURRENT_DATE
          AND recorded_at < CURRENT_DATE + INTERVAL '1 day'`,
      [req.session.user.id]
    );
    const total_ml = rows[0]?.total_ml ?? 0;
    log.debug({ total_ml }, 'Hydration total today');
    res.json({ total: total_ml });
  } catch (err) {
    log.error({ err }, 'Error getting hydration total');
    res.status(500).json({ error: 'Failed to calculate hydration total' });
  }
});

module.exports = router;