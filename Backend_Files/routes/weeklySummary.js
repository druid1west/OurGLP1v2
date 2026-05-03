// GLP1/routes/weeklySummary.js
'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../models/db');        // pg pool
const baseLogger = require('../logger');     // pino
const { DateTime } = require('luxon');
const { makeLineChart, toDataUrl } = require('../lib/charting'); // no luxon adapter
const crypto = require('crypto');

function meta(req, extra = {}) {
  return {
    route: 'weekly-summary',
    userId: req.session?.user?.id || '',
    ip: req.ip,
    ua: req.get?.('user-agent'),
    ...extra,
  };
}

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    req.log?.warn(meta(req, { reason: 'no-session' }), 'Auth required');
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.user = req.session.user;
  next();
}

/** Most recent scheduled occurrence of weekday/time in tz (in the PAST) */
function mostRecentScheduledOccurrence({ tz, injectionDay, injectionTime }) {
  if (!tz || !injectionDay || !injectionTime) return null;

  const weekdayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const idx = weekdayNames.indexOf(injectionDay);
  if (idx < 0) return null;

  // Map Sunday..Saturday indexes (0..6) -> Luxon weekday (1..7, Mon=1..Sun=7)
  const luxonTarget = ((idx + 6) % 7) + 1; // Sun(0)->7, Mon(1)->1, ...

  const now = DateTime.now().setZone(tz);
  const [hh, mm] = injectionTime.slice(0,5).split(':').map(Number);
  let anchor = now.set({ hour: hh || 0, minute: mm || 0, second: 0, millisecond: 0 });

  while (anchor.weekday !== luxonTarget) {
    anchor = anchor.minus({ days: 1 });
  }
  if (anchor > now) anchor = anchor.minus({ days: 7 });
  return anchor;
}

/** Protein/Hydration helper: sum per local day within [start,end) */
async function getSeriesByDay({ userId, tz, startISO, endISO, type, valueColumn }) {
  const start = DateTime.fromISO(startISO).setZone(tz);
  const end   = DateTime.fromISO(endISO).setZone(tz);

  const labels = [];
  const indexMap = new Map();

  let i = 0;
  for (let d = start.startOf('day'); d < end; d = d.plus({ days: 1 })) {
    labels.push(d.toFormat('ccc dd LLL')); // e.g., Mon 19 Aug
    indexMap.set(d.toISODate(), i);
    i++;
  }
  const values = new Array(labels.length).fill(0);

  const sql = `
    SELECT
      (recorded_at AT TIME ZONE $2)::date AS day_local,
      SUM(${valueColumn})::float AS total
    FROM user_health_logs
    WHERE user_id = $1
      AND entry_type = $3
      AND recorded_at >= $4
      AND recorded_at <  $5
    GROUP BY 1
    ORDER BY 1
  `;
  const params = [userId, tz, type, start.toUTC().toISO(), end.toUTC().toISO()];
  const { rows } = await pool.query(sql, params);

  for (const r of rows) {
    const key = DateTime.fromISO(String(r.day_local)).toISODate();
    const idx = indexMap.get(key);
    if (idx != null) values[idx] = Number(r.total || 0);
  }

  return { labels, values };
}

/* -----------------------------
   Fasting helpers & chart
----------------------------- */

function parseFastingTarget(schedule) {
  if (!schedule) return null;
  const m = String(schedule).match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  return m ? Math.max(0, Math.min(24, parseInt(m[1], 10))) : null;
}

/** Build day labels and an index map for a [start,end) window in tz */
function buildDayIndex({ tz, startISO, endISO }) {
  const start = DateTime.fromISO(startISO, { zone: tz }).startOf('day');
  const end   = DateTime.fromISO(endISO,   { zone: tz });
  const labels = [];
  const index = new Map();
  let i = 0;
  for (let d = start; d < end; d = d.plus({ days: 1 })) {
    labels.push(d.toFormat('ccc dd LLL')); // Mon 19 Aug
    index.set(d.toISODate(), i++);
  }
  return { labels, index };
}

/** Compute fasting hours (24h - eating window) per day from user_fasting_days */
async function getFastingSeries({ userId, tz, startISO, endISO, targetHours }) {
  const { labels, index } = buildDayIndex({ tz, startISO, endISO });
  const values = new Array(labels.length).fill(null); // null means no data

  // Pull rows in [start,end) by local day
  const startLocal = DateTime.fromISO(startISO, { zone: tz }).toISODate();
  const endLocal   = DateTime.fromISO(endISO,   { zone: tz }).minus({ days: 1 }).toISODate();

  const sql = `
    SELECT id, day, first_meal_at, last_meal_at
      FROM user_fasting_days
     WHERE user_id = $1
       AND day >= $2
       AND day <= $3
     ORDER BY day ASC
  `;
  const { rows } = await pool.query(sql, [userId, startLocal, endLocal]);

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  for (const r of rows) {
    const i = index.get(r.day); // 'YYYY-MM-DD'
    if (i == null) continue;

    let fastingHours = null;
    if (r.first_meal_at && r.last_meal_at) {
      const first = DateTime.fromJSDate(r.first_meal_at, { zone: tz });
      const last  = DateTime.fromJSDate(r.last_meal_at,  { zone: tz });
      // Eating window in hours. If last < first (past midnight), add 24h and clamp.
      let eatHrs = (last.toMillis() - first.toMillis()) / 3_600_000;
      if (eatHrs < 0) eatHrs += 24;
      eatHrs = clamp(eatHrs, 0, 24);
      fastingHours = clamp(24 - eatHrs, 0, 24);
    }
    values[i] = fastingHours;
  }

  // Two datasets: actual fasting hours & target as a flat line
  return {
    labels,
    values,
    datasets: [
      {
        label: 'Fasting hours',
        data: values,
        borderColor: '#0d2b2b',
        backgroundColor: 'rgba(13,43,43,0.12)',
        spanGaps: true,
        fill: true,
      },
      ...(typeof targetHours === 'number'
        ? [{
            label: `Target (${targetHours}h)`,
            data: values.map(() => targetHours),
            borderColor: '#888',
            pointRadius: 0,
            borderDash: [6, 4],
          }]
        : []),
    ],
  };
}

/** Build fasting chart PNG and roll up stats */
async function buildFastingChartAndStats({ userId, win, profile }) {
  const tz = profile?.timezone || 'UTC';
  const targetHours = parseFastingTarget(profile?.fasting_schedule);
  const s = await getFastingSeries({
    userId,
    tz,
    startISO: win.start,
    endISO: win.end,
    targetHours,
  });

  // Render chart
  const png = await makeLineChart({
    title: 'Fasting (hours/day)',
    labels: s.labels,
    yTitle: 'hours',
    datasets: s.datasets,
  });

  // Stats
  const vals = s.values.filter(v => typeof v === 'number');
  const avg = vals.length ? (vals.reduce((a,b)=>a+b, 0) / vals.length) : null;
  const daysMet = (typeof targetHours === 'number')
    ? s.values.reduce((n, v) => (typeof v === 'number' && v >= targetHours ? n + 1 : n), 0)
    : null;

  return {
    dataUrl: toDataUrl(png),
    stats: {
      targetHours: targetHours ?? null,
      avgHours: avg != null ? Math.round(avg * 10) / 10 : null,
      daysMetTarget: daysMet != null ? daysMet : null,
    },
  };
}

/* -----------------------------
   Exercise minutes/day (new)
----------------------------- */

async function getExerciseMinutesByDay({ userId, tz, startISO, endISO }) {
  const { labels, index } = buildDayIndex({ tz, startISO, endISO });
  const values = new Array(labels.length).fill(0);

  const sql = `
    SELECT (start_at AT TIME ZONE $2)::date AS day_local,
           SUM(EXTRACT(EPOCH FROM (COALESCE(end_at, start_at) - start_at)) / 60.0)::float AS minutes
      FROM exercise_entries
     WHERE user_id = $1
       AND start_at IS NOT NULL
       AND start_at >= $3
       AND start_at <  $4
     GROUP BY 1
     ORDER BY 1
  `;
  const params = [
    userId,
    tz,
    DateTime.fromISO(startISO, { zone: tz }).toUTC().toISO(),
    DateTime.fromISO(endISO,   { zone: tz }).toUTC().toISO(),
  ];
  const { rows } = await pool.query(sql, params);

  for (const r of rows) {
    const key = DateTime.fromISO(String(r.day_local)).toISODate();
    const i = index.get(key);
    if (i != null) values[i] = Number(r.minutes || 0);
  }
  return { labels, values };
}

/* -----------------------------
   Main routes
----------------------------- */

router.get('/', requireLogin, async (req, res) => {
  const userId = req.user.id;
  req.log = req.log || baseLogger.child({ route: 'weekly-summary' });

  try {
    // Profile (includes fasting_schedule for target)
    const profSql = `
      SELECT
        COALESCE(i.injection_day, u.injection_day) AS injection_day,
        to_char(COALESCE(i.injection_time::time, u.injection_time::time), 'HH24:MI') AS injection_time,
        COALESCE(u.timezone, 'UTC') AS timezone,
        u.fasting_schedule
      FROM users u
      LEFT JOIN LATERAL (
        SELECT injection_day, injection_time
          FROM user_injection_schedule
         WHERE user_id = u.id
         ORDER BY updated_at DESC
         LIMIT 1
      ) i ON true
      WHERE u.id = $1
    `;
    const prof = await pool.query(profSql, [userId]);
    const profileRow = prof.rows[0] || {};
    const tz = profileRow.timezone || 'UTC';
    const injectionDay = profileRow.injection_day || null;
    const injectionTime = profileRow.injection_time || null;

    // Try real "taken" anchor (if you track injections)
    const lastTakenSql = `
      SELECT taken_at
        FROM user_injection_log
       WHERE user_id = $1
    ORDER BY taken_at DESC
       LIMIT 1
    `;
    let anchorType = 'scheduled';
    let anchorTakenDT = null;
    let anchorSchedDT = null;
    const nowTz = DateTime.now().setZone(tz);

    try {
      const lastTaken = await pool.query(lastTakenSql, [userId]);
      if (lastTaken.rows[0]) {
        const takenDT = DateTime.fromJSDate(lastTaken.rows[0].taken_at).setZone(tz);
        const ageDays = nowTz.diff(takenDT, 'days').days;
        if (Number.isFinite(ageDays) && ageDays <= 14) {
          anchorType = 'taken';
          anchorTakenDT = takenDT;
        }
      }
    } catch {
      // If the table doesn't exist or no rows — just ignore.
    }

    if (!anchorTakenDT) {
      anchorSchedDT = mostRecentScheduledOccurrence({ tz, injectionDay, injectionTime }) || nowTz;
    }

    const anchorStartDT = anchorTakenDT || anchorSchedDT || nowTz;

    // Weekly window: [anchorStart, anchorStart + 7d)
    const startDT = anchorStartDT;
    const endDT = anchorStartDT.plus({ days: 7 });
    const isoOpts = { suppressMilliseconds: true, includeOffset: true };
    const win = { start: startDT.toISO(isoOpts), end: endDT.toISO(isoOpts), tz };

    // Build series (protein, hydration, exercise)
    const proteinTask = getSeriesByDay({
      userId, tz, startISO: win.start, endISO: win.end,
      type: 'protein', valueColumn: 'protein_grams'
    });
    const hydrationTask = getSeriesByDay({
      userId, tz, startISO: win.start, endISO: win.end,
      type: 'hydration', valueColumn: 'hydration_amount'
    });
    const exerciseTask = getExerciseMinutesByDay({
      userId, tz, startISO: win.start, endISO: win.end
    });

    // Fasting (chart + stats)
    const fastingTask = buildFastingChartAndStats({
      userId,
      win,
      profile: { fasting_schedule: profileRow.fasting_schedule, timezone: tz }
    });

    const [protein, hydration, exercise, fastingRes] =
      await Promise.all([proteinTask, hydrationTask, exerciseTask, fastingTask]);

    // Render charts
    const [proteinPng, hydrationPng, exercisePng] = await Promise.all([
      makeLineChart({
        title: 'Protein (g/day)',
        labels: protein.labels,
        yTitle: 'grams',
        datasets: [{
          data: protein.values,
          borderColor: '#0d2b2b',
          backgroundColor: 'rgba(13,43,43,0.12)',
          fill: true
        }],
      }),
      makeLineChart({
        title: 'Hydration (mL/day)',
        labels: hydration.labels,
        yTitle: 'mL',
        datasets: [{
          data: hydration.values,
          borderColor: '#0d2b2b',
          backgroundColor: 'rgba(13,43,43,0.12)',
          fill: true
        }],
      }),
      makeLineChart({
        title: 'Exercise (minutes/day)',
        labels: exercise.labels,
        yTitle: 'minutes',
        datasets: [{
          data: exercise.values,
          borderColor: '#0d2b2b',
          backgroundColor: 'rgba(13,43,43,0.12)',
          fill: true
        }],
      }),
    ]);

    // Bullets
    const proteinSum   = protein.values.reduce((a, b) => a + b, 0);
    const hydrationSum = hydration.values.reduce((a, b) => a + b, 0);
    const bullets = [
      `Protein total: ${Math.round(proteinSum)} g over the last 7 days`,
      `Hydration total: ${Math.round(hydrationSum)} mL over the last 7 days`,
    ];
    if (fastingRes?.stats) {
      const s = fastingRes.stats;
      bullets.unshift(
        `Fasting: avg ${s.avgHours ?? '–'}h • ${s.daysMetTarget ?? 0}/7 days ≥ ${s.targetHours ?? '–'}h`
      );
    }

    const charts = {
      fasting:   fastingRes?.dataUrl || null,
      protein:   toDataUrl(proteinPng),
      hydration: toDataUrl(hydrationPng),
      exercise:  toDataUrl(exercisePng),
    };

    const anchor = {
      type: anchorTakenDT ? 'taken' : 'scheduled',
      used: startDT.toISO(isoOpts),
      takenAt: anchorTakenDT ? anchorTakenDT.toISO(isoOpts) : null,
      scheduledAt: anchorSchedDT ? anchorSchedDT.toISO(isoOpts) : null,
    };

    const includePrefs = {
      injection: true,
      fasting:   true,
      protein:   true,
      hydration: true,
      exercise:  true,
      mood:      false,
      bloodPressure: false,
      bloodSugar:    false,
      bowel:         false,
    };

    const payload = {
      window: win,
      anchor,
      charts,
      includePrefs,
      summaryBullets: bullets,
      fasting: fastingRes?.stats || { targetHours: null, avgHours: null, daysMetTarget: null },
      profile: {
        injectionDay:  injectionDay || '',
        injectionTime: injectionTime || '',
        timezone:      tz,
        fastingSchedule: profileRow.fasting_schedule || null,
      },
    };

    req.log.info(meta(req, { status: 200 }), 'weekly summary payload');
    res.json(payload);
  } catch (err) {
    req.log.error({ ...meta(req), err }, 'weekly summary failed');
    res.status(500).json({ error: 'Failed to build weekly summary' });
  }
});

router.post('/send', requireLogin, async (req, res) => {
  const userId = req.user.id;
  const { email, include = {}, confirmClickToken } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Missing or invalid email' });
  }

  const asErr = (e) => (e instanceof Error ? e : new Error(String(e)));

  try {
    // ---- Load profile (tz + schedule) -------------------------------------
    const profSql = `
      SELECT
        COALESCE(i.injection_day, u.injection_day) AS injection_day,
        to_char(COALESCE(i.injection_time::time, u.injection_time::time), 'HH24:MI') AS injection_time,
        COALESCE(u.timezone, 'UTC') AS timezone,
        u.fasting_schedule
      FROM users u
      LEFT JOIN LATERAL (
        SELECT injection_day, injection_time
          FROM user_injection_schedule
         WHERE user_id = u.id
         ORDER BY updated_at DESC
         LIMIT 1
      ) i ON true
      WHERE u.id = $1
    `;
    const prof = await pool.query(profSql, [userId]);
    const profileRow = prof.rows[0] || {};
    const tz = profileRow.timezone || 'UTC';
    const injectionDay = profileRow.injection_day || null;
    const injectionTime = profileRow.injection_time || null;

    // ---- Choose weekly anchor (taken if recent, else scheduled) -----------
    let anchorStartDT;
    try {
      const { rows } = await pool.query(
        `SELECT taken_at
           FROM user_injection_log
          WHERE user_id = $1
          ORDER BY taken_at DESC
          LIMIT 1`,
        [userId]
      );
      if (rows[0]) {
        const taken = DateTime.fromJSDate(rows[0].taken_at).setZone(tz);
        const ageDays = DateTime.now().setZone(tz).diff(taken, 'days').days;
        if (Number.isFinite(ageDays) && ageDays <= 14) {
          anchorStartDT = taken;
        }
      }
    } catch {
      // table might not exist yet — ignore
    }
    if (!anchorStartDT) {
      anchorStartDT = mostRecentScheduledOccurrence({ tz, injectionDay, injectionTime }) || DateTime.now().setZone(tz);
    }

    const startDT = anchorStartDT;
    const endDT   = anchorStartDT.plus({ days: 7 });
    const isoOpts = { suppressMilliseconds: true, includeOffset: true };
    const win = { start: startDT.toISO(isoOpts), end: endDT.toISO(isoOpts), tz };

    // ---- Persist confirmation token (idempotent) --------------------------
    const token = confirmClickToken || crypto.randomBytes(16).toString('hex');
    const weekStart = startDT.toISODate();

    let { rows } = await pool.query(
      `
      INSERT INTO weekly_summary_receipts (user_id, token, week_start)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, week_start) DO UPDATE
      SET token = EXCLUDED.token,
          created_at = now()
      WHERE weekly_summary_receipts.confirmed_at IS NULL
      RETURNING id, token, week_start, created_at, confirmed_at
      `,
      [userId, token, weekStart]
    );

    if (rows.length === 0) {
      const r2 = await pool.query(
        `SELECT id, token, week_start, created_at, confirmed_at
           FROM weekly_summary_receipts
          WHERE user_id = $1 AND week_start = $2`,
        [userId, weekStart]
      );
      rows = r2.rows;
    }

    const receipt = rows[0];
    if (!receipt) {
      throw new Error('weekly_summary_receipts upsert returned no row');
    }

    // If this week was already confirmed, don’t send again.
    if (receipt.confirmed_at) {
      req.log?.info(
        { userId, week_start: weekStart, receiptId: receipt.id },
        'Weekly summary already confirmed — skipping send'
      );
      return res.json({ success: true, alreadyConfirmed: true });
    }

    const linkToken = receipt.token;

    // ---- Build charts (fail-soft) -----------------------------------------
    const imgTag = (src, alt) =>
      src ? `<img src="${src}" alt="${alt}" style="max-width:100%;border-radius:12px;border:1px solid #eee;margin:8px 0"/>` : '';

    const tryBuild = async (label, fn) => {
      try {
        return await fn();
      } catch (e) {
        req.log?.warn({ route: 'weekly-summary', userId, label, err: asErr(e) }, `${label} chart build failed`);
        return null;
      }
    };

    let fastingUrl = null, proteinUrl = null, hydrationUrl = null, exerciseUrl = null;

    if (include.fasting !== false) {
      const fr = await tryBuild('fasting', async () => {
        const r = await buildFastingChartAndStats({
          userId,
          win,
          profile: { fasting_schedule: profileRow.fasting_schedule, timezone: tz },
        });
        return r?.dataUrl || null;
      });
      fastingUrl = fr;
    }

    if (include.protein !== false) {
      const series = await tryBuild('protein-series', async () =>
        getSeriesByDay({ userId, tz, startISO: win.start, endISO: win.end, type: 'protein', valueColumn: 'protein_grams' })
      );
      if (series) {
        const png = await tryBuild('protein-chart', async () =>
          makeLineChart({
            title: 'Protein (g/day)',
            labels: series.labels,
            yTitle: 'grams',
            datasets: [{ data: series.values, borderColor: '#0d2b2b', backgroundColor: 'rgba(13,43,43,0.12)', fill: true }],
          })
        );
        proteinUrl = png ? toDataUrl(png) : null;
      }
    }

    if (include.hydration !== false) {
      const series = await tryBuild('hydration-series', async () =>
        getSeriesByDay({ userId, tz, startISO: win.start, endISO: win.end, type: 'hydration', valueColumn: 'hydration_amount' })
      );
      if (series) {
        const png = await tryBuild('hydration-chart', async () =>
          makeLineChart({
            title: 'Hydration (mL/day)',
            labels: series.labels,
            yTitle: 'mL',
            datasets: [{ data: series.values, borderColor: '#0d2b2b', backgroundColor: 'rgba(13,43,43,0.12)', fill: true }],
          })
        );
        hydrationUrl = png ? toDataUrl(png) : null;
      }
    }

    if (include.exercise !== false) {
      const series = await tryBuild('exercise-series', async () =>
        getExerciseMinutesByDay({ userId, tz, startISO: win.start, endISO: win.end })
      );
      if (series) {
        const png = await tryBuild('exercise-chart', async () =>
          makeLineChart({
            title: 'Exercise (minutes/day)',
            labels: series.labels,
            yTitle: 'minutes',
            datasets: [{ data: series.values, borderColor: '#0d2b2b', backgroundColor: 'rgba(13,43,43,0.12)', fill: true }],
          })
        );
        exerciseUrl = png ? toDataUrl(png) : null;
      }
    }

    // ---- Compose & send ----------------------------------------------------
    let transporter, MAIL_FROM;
    try {
      ({ transporter, MAIL_FROM } = require('../mailer'));
      if (!transporter || !MAIL_FROM) throw new Error('Mailer not configured');
    } catch (e) {
      const err = asErr(e);
      req.log?.error({ ...meta(req), err }, 'Mailer init failed');
      return res.status(500).json({ error: 'Mailer not configured' });
    }

const appOrigin = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
const apiOrigin = process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}/api`;

const confirmHref = `${apiOrigin.replace(/\/$/, '')}/weekly-summary/confirm?token=${encodeURIComponent(linkToken)}`;

const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
    <h2>Weekly summary</h2>
    <p>Here are your charts for the last week.</p>
    ${include.fasting   !== false ? imgTag(fastingUrl,   'Fasting')   : ''}
    ${include.protein   !== false ? imgTag(proteinUrl,   'Protein')   : ''}
    ${include.hydration !== false ? imgTag(hydrationUrl, 'Hydration') : ''}
    ${include.exercise  !== false ? imgTag(exerciseUrl,  'Exercise')  : ''}
    <p style="margin-top:16px">
      <a href="${confirmHref}">Click to confirm you received this summary</a>
    </p>
  </div>
`;

    await transporter.sendMail({
      from: MAIL_FROM,
      to: email,
      subject: 'Your weekly summary',
      html,
    });

    req.log?.info(
      { ...meta(req, { email, week_start: weekStart, receiptId: receipt.id, token: linkToken }) },
      'Weekly summary sent'
    );
    return res.json({ success: true });
  } catch (e) {
    const err = asErr(e);
    req.log?.error({ ...meta(req, { email }), err }, 'Weekly summary send failed');
    return res.status(500).json({ error: 'Failed to send email', detail: err.message });
  }
});

// routes/weeklySummary.js
router.get('/confirm', async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(400).send('Missing token');

  const { rowCount } = await pool.query(
    `UPDATE weekly_summary_receipts
       SET confirmed_at = now()
     WHERE token = $1 AND confirmed_at IS NULL`,
    [token]
  );

  baseLogger.info({ route: 'weekly-summary', token, updated: rowCount }, 'confirm clicked');

  const appOrigin = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
  const dest = `${appOrigin.replace(/\/$/, '')}/weekly-summary?confirmed=${rowCount > 0 ? '1' : '0'}`;
  res.redirect(dest);
});

router.get('/archive', requireLogin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT token, week_start, created_at, confirmed_at
       FROM weekly_summary_receipts
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 12`,
    [req.user.id]
  );
  res.json(rows);
});

module.exports = router;