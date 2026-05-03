// routes/user.js
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { pool } = require('../models/db');
const baseLogger = require('../logger');          // pino base logger

const { USE_PUSH_QUEUE } = require('../config/flags');
const { enqueueReminder } = require('../jobs/enqueueReminder');

const uploadDir = '/var/www/Paris-Clinic/uploads/profile-photos';
const sharp = require('sharp');
const { DateTime } = require('luxon');
const { validate, validateQuery, validateParams } = require('../lib/validate');

const crypto = require('crypto');
const { z } = require('zod'); // ✅ Phase-2: input validation
const requirePro = require('../middleware/requirePro');

const { purgeUser } = require('../lib/purgeUser');

// ---------- Phase-2: validation helpers & schemas --------------------------
const isValidTimeZone = (tz) => {
  if (tz === undefined || tz === null || tz === '') return true; // optional
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
};

const emptyToUndef = (v) => (v === '' || v === null ? undefined : v);


const tzSet = new Set(Intl.supportedValuesOf('timeZone'));
const { maybeToUTCFromLocal } = require('../lib/time');

// primitives
const TimeHHMMSS = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'HH:MM or HH:MM:SS');

const TimeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

const DayShortEnum = z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

const DateYYYYMMDD = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const LocalISO_NoZ = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'YYYY-MM-DDTHH:MM (no Z)');

// schemas (use preprocess so empty strings remain "unset" like your current logic)
// --- params/query schemas we’ll use below ---
// accept UUIDs (and optionally numeric ids if you still have any older rows)
const IdParam = z.object({
  id: z.union([
    z.string().uuid(),
    z.string().regex(/^\d+$/)  // keep if you also use numeric ids anywhere
  ])
});
const UuidParam = z.object({ id: z.string().uuid() });
const DayParam = z.object({ date: DateYYYYMMDD });
const FastingDayParam = z.object({ day: DateYYYYMMDD });
const RemindersRangeQuery = z.object({
  from: z.string().datetime({ offset: true }),
  to:   z.string().datetime({ offset: true }),
  tz:   z.string().optional()
});
const UpcomingQuery = z.object({
  window: z.coerce.number().int().min(1).max(1440).optional()
});
const ProfileSchema = z.object({
  first_name: z.preprocess(emptyToUndef, z.string().min(1).max(60)).optional(),
  last_name: z.preprocess(emptyToUndef, z.string().min(1).max(60)).optional(),
  email: z.preprocess(emptyToUndef, z.string().email()).optional(),
  medication_name: z.preprocess(emptyToUndef, z.string().max(120)).optional(),
  medication_dose: z.preprocess(emptyToUndef, z.string().max(60)).optional(),
  height: z.preprocess(emptyToUndef, z.coerce.number().min(100).max(250)).optional(),
  weight: z.preprocess(emptyToUndef, z.coerce.number().min(30).max(400)).optional(),
  fasting_schedule: z.preprocess(emptyToUndef, z.string().max(120)).optional(),
  fasting_start: z.preprocess(emptyToUndef, TimeHHMMSS).optional(),
  bmi: z.preprocess(emptyToUndef, z.coerce.number().min(10).max(80)).optional(),
  injection_time: z.preprocess(emptyToUndef, TimeHHMMSS).optional(),
  injection_day: z.preprocess(emptyToUndef, z.string().min(3).max(9)).optional(), // you normalize later
  timezone: z.preprocess(emptyToUndef, z.string().min(1)).optional(),
});

const PlanSchema = z.object({
  injection_day: z.preprocess(emptyToUndef, z.string().min(3).max(9)), // you normalize to 3-letter later
  injection_time: z.preprocess(emptyToUndef, TimeHHMMSS),
  reminder_option: z
    .preprocess(emptyToUndef, z.enum(['24h', '1h', '0h']).optional())
    .optional(),
});

const InjectionInfoSchema = z.object({
  injectionDay: z.preprocess(emptyToUndef, z.string().min(3).max(9)),
  injectionTime: z.preprocess(emptyToUndef, TimeHHMMSS),
  medicationName: z.preprocess(emptyToUndef, z.string().max(120)).optional(),
  medicationDose: z.preprocess(emptyToUndef, z.string().max(60)).optional(),
});

const FastingOverrideSchema = z.object({
  day: z.preprocess(emptyToUndef, DateYYYYMMDD),
  start_time: z.preprocess(
    (v, ctx) => v ?? ctx?.parent?.first_meal_at ?? v,
    TimeHHMMSS
  ),
  end_time: z.preprocess(
    (v, ctx) => v ?? ctx?.parent?.last_meal_at ?? v,
    TimeHHMMSS
  ),
  first_meal_at: z.preprocess(emptyToUndef, TimeHHMMSS).optional(),
  last_meal_at: z.preprocess(emptyToUndef, TimeHHMMSS).optional(),
});

const RangeQuerySchema = z.object({
  from: DateYYYYMMDD,
  to: DateYYYYMMDD,
});

const ReminderCreateSchema = z.object({
  title: z.preprocess(emptyToUndef, z.string().min(1).max(120)),
  // Accept either full ISO with offset/Z OR local "YYYY-MM-DDTHH:MM" (no Z)
  datetime: z
    .preprocess(emptyToUndef, z.string().min(10))
    .optional(),
  day_of_week: z.preprocess(emptyToUndef, z.string().min(3).max(9)).optional(),
  method: z.union([z.string(), z.array(z.string()), z.record(z.any())]).optional(),
  methods: z.union([z.string(), z.array(z.string()), z.record(z.any())]).optional(),
  advance_minutes: z.preprocess(
    emptyToUndef,
    z.coerce.number().int().min(0)
  ).optional(),
  reminder_type: z.preprocess(emptyToUndef, z.string().max(50)).optional(),
});

const ReminderUpdateSchema = z.object({
  title: z.preprocess(emptyToUndef, z.string().min(1).max(120)).optional(),
  datetime: z.preprocess(emptyToUndef, z.string().min(10)).optional(),
  method: z.union([z.string(), z.array(z.string()), z.record(z.any())]).optional(),
  methods: z.union([z.string(), z.array(z.string()), z.record(z.any())]).optional(),
  advance_minutes: z.preprocess(
    emptyToUndef,
    z.coerce.number().int().min(0)
  ).optional(),
  enabled: z.preprocess(emptyToUndef, z.coerce.boolean()).optional(),
  day_of_week: z.preprocess(emptyToUndef, z.string().min(3).max(9)).optional(),
  reminder_type: z.preprocess(emptyToUndef, z.string().max(50)).optional(),
});

// ---------- Phase-2: timezone helper (local → UTC) -------------------------



async function getUserTimezone(pool, userId) {
  try {
    const { rows } = await pool.query('SELECT timezone FROM users WHERE id = $1', [userId]);
    return rows[0]?.timezone || null;
  } catch {
    return null;
  }
}


// ---------- your original code (unchanged other than added validation hooks) -----

// 🔒 tiny helpers for safe logging
const hash8 = (s) => (s ? crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8) : '');
const SENSITIVE_KEYS = [
  'password','pass','pwd','token','access_token','refresh_token','authorization',
  'api_key','x-api-key','secret','device_id','email','sid','session','cookie'
];
const sanitize = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_KEYS.some((sk) => k.toLowerCase().includes(sk));
    if (isSensitive) {
      out[k] = '[redacted]';
    } else if (v && typeof v === 'object') {
      out[k] = sanitize(v);
    } else {
      out[k] = v;
    }
  }
  return out;
};

fs.mkdirSync(uploadDir, { recursive: true });
try {
  fs.accessSync(uploadDir, fs.constants.W_OK);
} catch (e) {
  baseLogger.error({ route: 'user', uploadDir }, e, 'Upload dir not writable');
  // optional: throw e;
}

// --- helpers ---------------------------------------------------------------
function isDateOnlyYYYYMMDD(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}
function toHHMMSS_any(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const pad2 = (n) => String(Math.max(0, Math.min(59, n))).padStart(2, '0');
  const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  const ss = m[3] ? Math.max(0, Math.min(59, parseInt(m[3], 10))) : 0;
  return `${String(hh).padStart(2,'0')}:${pad2(mm)}:${pad2(ss)}`;
}

// Normalize a weekday string to FULL name to satisfy users_injection_day_check
function toFullWeekday(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  const map = {
    sun: 'Sunday',    sunday: 'Sunday',
    mon: 'Monday',    monday: 'Monday',
    tue: 'Tuesday',   tues: 'Tuesday', tuesday: 'Tuesday',
    wed: 'Wednesday', weds: 'Wednesday', wednesday: 'Wednesday',
    thu: 'Thursday',  thur: 'Thursday', thurs: 'Thursday', thursday: 'Thursday',
    fri: 'Friday',    friday: 'Friday',
    sat: 'Saturday',  saturday: 'Saturday'
  };
  const key = map[s] ? s : map[s.slice(0,3)] ? s.slice(0,3) : s;
  return map[key] || null;
}

const SHORT_DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function bumpShortWeekday(code) {
  const i = SHORT_DOW.indexOf(code);
  return i === -1 ? code : SHORT_DOW[(i + 1) % 7];
}
const FULL_DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function bumpFullWeekday(name) {
  const i = FULL_DOW.indexOf(name);
  return i === -1 ? name : FULL_DOW[(i + 1) % 7];
}

const reminderSchema = z.object({
  title: z.string().min(1),
  // tests send an ISO string; store it in TIMESTAMPTZ
  datetime: z.string().datetime().transform((s) => new Date(s).toISOString()),
  // API field is plural, DB column is singular -> we’ll map it
  methods: z.array(z.enum(['email', 'sms', 'push'])).min(1),
  advanceMinutes: z.number().int().min(0).default(0).optional(),
  enabled: z.boolean().default(true).optional(),
});

/*
 * Return the next occurrence of weekday+time in a given IANA tz as Luxon DateTime.
 */
function nextOccurrenceInTz(weekdayShort, hhmm, tz) {
  const map = { Sun:7, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }; // Luxon: Mon=1..Sun=7
  const wd = map[weekdayShort] ?? null;
  if (!wd) throw new Error('Invalid weekday: ' + weekdayShort);
  const [H, M] = String(hhmm).slice(0,5).split(':').map(n => parseInt(n, 10) || 0);

  let now = DateTime.now().setZone(tz);
  let target = now.set({ weekday: wd, hour: H, minute: M, second: 0, millisecond: 0 });
  if (target <= now) target = target.plus({ days: 7 });
  return target;
}

function toHHMMSS(t) {
  if (!t) return null;
  return t.length === 5 ? `${t}:00` : t;
}

/** Build safe per-request log meta (never emit raw IDs or emails) */
function meta(req, extra = {}) {
  const rawId = req.session?.user?.id || req.user?.id || '';
  return {
    route: 'user',
    userId: rawId ? `u_${hash8(rawId)}` : '',
    ip: req.ip,
    ua: req.get?.('user-agent'),
    ...extra,
  };
}

// Map UI terms -> DB text[] for reminders.method
function normalizeMethod(input) {
  let items = [];
  if (Array.isArray(input)) {
    items = input;
  } else if (typeof input === 'string') {
    items = input.split(/[,\s]+/).filter(Boolean);
  } else if (input && typeof input === 'object' && 'value' in input) {
    items = [input.value];
  }

  const set = new Set(items.map(s => String(s).toLowerCase().trim()));

  if (set.has('alerts') || set.has('alert') || set.has('notification') || set.has('notifications')) {
    set.delete('alerts'); set.delete('alert'); set.delete('notification'); set.delete('notifications');
    set.add('push');
  }

  if (set.size === 0) set.add('push');
  return Array.from(set);
}

function toDayShort(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  const map = { mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };
  if (map[s]) return map[s];
  const short = s.slice(0,3);
  return map[short] || null;
}

function snapToQuarterHHMMSS(t, mode = 'nearest') {
  if (!t) return { time: null, carry: 0 };
  const [H, M, S = '00'] = String(t).split(':');
  let h = parseInt(H, 10) || 0;
  let m = parseInt(M, 10) || 0;
  let s = parseInt(S, 10) || 0;

  let totalMin = h * 60 + m + (s >= 30 ? 1 : 0);

  let snapped;
  if (mode === 'floor')  snapped = Math.floor(totalMin / 15) * 15;
  else if (mode === 'ceil') snapped = Math.ceil(totalMin / 15) * 15;
  else                      snapped = Math.round(totalMin / 15) * 15;

  let carry = 0;
  if (snapped >= 24 * 60) { snapped -= 24 * 60; carry = 1; }

  const hh = String(Math.floor(snapped / 60)).padStart(2, '0');
  const mm = String(snapped % 60).padStart(2, '0');
  return { time: `${hh}:${mm}:00`, carry };
}

const TZ_LIST = (typeof Intl?.supportedValuesOf === 'function')
  ? Intl.supportedValuesOf('timeZone')
  : [];

// prefer explicit ?tz, then user's profile tz, else UTC
function resolveTz(req) {
  return (typeof req.query.tz === 'string' && req.query.tz) ||
         (req.user?.timezone) ||
         (req.session?.user?.timezone) ||
         'UTC';
}

router.use((req, _res, next) => {
  const parent = req.log || baseLogger;
  req.log = parent.child({ route: 'user' });
  next();
});

const requireLogin = require('../middleware/requireLogin');
router.use(requireLogin);

// ===== Multer storage for profile photos
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const safeFilename = `${req.user.id}.jpg`;
    req.log.info(meta(req, { filename: safeFilename }), 'Saving uploaded profile photo');
    cb(null, safeFilename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    /^image\/(jpe?g|png|webp|heic|avif)$/i.test(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only image uploads are allowed')),
});

// ===== POST /api/user/profile — update profile + optional photo (hardened)
router.post('/profile', requireLogin, requirePro(), upload.single('photo'), validate(ProfileSchema), async (req, res) => {
  const started = Date.now();
  const userId = req.user.id;

  // ---- helpers (minimal, pure) --------------------------------------------
  const pad2 = (n) => String(n).padStart(2, '0');
  const toHHMMSS_local = (v) => {
    if (typeof v !== 'string') return '';
    const m = v.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return '';
    let hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    let mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    const ss = m[3] ? Math.min(59, Math.max(0, parseInt(m[3], 10))) : 0;
    return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  };
  const snapToQuarterHHMMSS_local = (hhmmss, mode = 'nearest') => {
    if (!hhmmss) return { time: '', carry: 0 };
    const [h, m] = hhmmss.split(':').map((x) => parseInt(x, 10));
    let total = h * 3600 + m * 60; // ignore seconds for snapping
    const step = 15 * 60;
    const q = mode === 'up' ? Math.ceil(total / step) : mode === 'down' ? Math.floor(total / step) : Math.round(total / step);
    let snapped = q * step;
    let carry = 0;
    if (snapped >= 24 * 3600) { snapped -= 24 * 3600; carry = 1; }
    const nh = Math.floor(snapped / 3600);
    const nm = Math.floor((snapped % 3600) / 60);
    return { time: `${pad2(nh)}:${pad2(nm)}:00`, carry };
  };

  // ---- read body -----------------------------------------------------------
  let {
    first_name,
    last_name,
    medication_name,
    medication_dose,
    height,
    weight,
    fasting_schedule,
    fasting_start,
    bmi,
    injection_time,
    injection_day,
    timezone,
  } = req.body || {};

  // Normalize/sanitize incoming strings (treat falsy as empty)
 const s = (x) =>
   (x === undefined || x === null)
     ? ''
     : (typeof x === 'string' ? x.trim() : String(x));

  first_name       = s(first_name);
  last_name        = s(last_name);
  medication_name  = s(medication_name);
  medication_dose  = s(medication_dose);
  fasting_schedule = s(fasting_schedule);
  fasting_start    = toHHMMSS_local(s(fasting_start)) || '';   // '' means “leave as is”
 height           = height == null ? '' : String(height);
 weight           = weight == null ? '' : String(weight);
 bmi              = bmi == null ? '' : String(bmi);

  const tzValue    = s(timezone);
  
  if (tzValue && !isValidTimeZone(tzValue)) {
  return res.status(400).json({ error: 'invalid_timezone' });
}

  // Normalize day/time for injection (optional)
  let normDay  = toFullWeekday(s(injection_day));
  let normTime = toHHMMSS_local(s(injection_time));
  if (normTime) {
    const { time, carry } = snapToQuarterHHMMSS_local(normTime, 'nearest');
    normTime = time;                               // 'HH:MM:00' on 15m grid
    if (normDay && carry) normDay = bumpFullWeekday(normDay); // 23:53 -> next day
  } else {
    normTime = ''; // means “don’t touch”
  }

  // --- Handle photo upload (if any) ----------------------------------------
  let photoFilename = req.user.profile_photo || null;
  if (req.file) {
    const uploadedPath = path.join(uploadDir, req.file.filename);
    const finalFilename = `${req.user.id}.jpg`;
    const finalPath     = path.join(uploadDir, finalFilename);
    const tmpPath       = path.join(uploadDir, `${req.user.id}.tmp.jpg`);
    try {
      await sharp(uploadedPath, { limitInputPixels: 64e6 })
        .rotate()
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(tmpPath);
      await fs.promises.rename(tmpPath, finalPath);
      if (uploadedPath !== finalPath) {
        fs.unlink(uploadedPath, (err) => err && req.log.warn(meta(req, { filename: req.file.filename, reason: err.message }), 'Could not remove original upload after normalize'));
      }
      photoFilename = finalFilename;
      if (req.user.profile_photo && path.basename(req.user.profile_photo) !== finalFilename) {
        const oldPath = path.join(uploadDir, req.user.profile_photo);
        fs.unlink(oldPath, (err) => {
          if (err) req.log.warn(meta(req, { filename: req.user.profile_photo, reason: err.message }), 'Could not delete old profile photo');
          else req.log.info(meta(req, { filename: req.user.profile_photo }), 'Old profile photo deleted');
        });
      }
      req.log.info(meta(req, { filename: finalFilename }), 'Profile photo normalized');
    } catch (e) {
      req.log.warn(meta(req, { filename: req.file.filename, reason: e.message }), 'Image normalize failed; keeping original name');
      photoFilename = req.file.filename;
    }
  }

  try {
    const sets = [
      `first_name       = COALESCE(NULLIF($1,  ''), first_name)`,
      `last_name        = COALESCE(NULLIF($2,  ''), last_name)`,
      `medication_name  = COALESCE(NULLIF($3,  ''), medication_name)`,
      `medication_dose  = COALESCE(NULLIF($4,  ''), medication_dose)`,
      `height           = COALESCE(NULLIF($5,  '')::numeric, height)`,
      `weight           = COALESCE(NULLIF($6,  '')::numeric, weight)`,
      `fasting_schedule = COALESCE(NULLIF($7,  ''), fasting_schedule)`,
      `fasting_start    = COALESCE(NULLIF($8,  '')::time,    fasting_start)`,
      `bmi              = COALESCE(NULLIF($9,  '')::numeric, bmi)`,
      `profile_photo    = COALESCE(NULLIF($10, ''), profile_photo)`,
      `timezone         = COALESCE(NULLIF($11, ''), timezone)`,
    ];

    const vals = [
      first_name,
      last_name,
      medication_name,
      medication_dose,
      height,
      weight,
      fasting_schedule,
      fasting_start,
      bmi,
      photoFilename || '',
      tzValue,
    ];

    let p = vals.length + 1;
    if (normDay) {
      sets.push(`injection_day  = $${p++}`);
      vals.push(normDay);
    }
    if (normTime) {
      sets.push(`injection_time = (CURRENT_DATE + $${p++}::time)`);
      vals.push(normTime);
    }

    sets.push('updated_at = now()');
    vals.push(userId);

    const sql = `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}`;
    await pool.query(sql, vals);

    if (req.session?.user) {
      req.session.user = {
        ...req.session.user,
        first_name:       first_name       || req.session.user.first_name,
        last_name:        last_name        || req.session.user.last_name,
        medication_name:  medication_name  || req.session.user.medication_name,
        medication_dose:  medication_dose  || req.session.user.medication_dose,
        height:           height           || req.session.user.height,
        weight:           weight           || req.session.user.weight,
        fasting_schedule: fasting_schedule || req.session.user.fasting_schedule,
        fasting_start:    fasting_start    || req.session.user.fasting_start,
        bmi:              bmi              || req.session.user.bmi,
        timezone:         tzValue          || req.session.user.timezone,
        profile_photo:    photoFilename    || req.session.user.profile_photo,
        injection_day:    normDay          || req.session.user.injection_day || null,
        injection_time:   normTime ? normTime.slice(0, 5) : (req.session.user.injection_time ?? null),
      };
    }

    req.log.info(meta(req, { hasPhoto: Boolean(photoFilename), ms: Date.now() - started }), 'Profile updated');
    return res.json({ success: true, profile_photo: photoFilename });
  } catch (err) {
    req.log.error(
      meta(req, { ms: Date.now() - started, userId }),
      { pgCode: err?.code, detail: err?.detail, hint: err?.hint, constraint: err?.constraint, message: err?.message },
      'Profile update failed'
    );
    return res.status(500).json({ error: 'Failed to update profile', code: err?.code, detail: err?.detail, constraint: err?.constraint });
  }
});

// ===== GET /api/user/profile
router.get('/profile', requireLogin, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `
      SELECT
        u.email, u.first_name, u.last_name,
        u.medication_name, u.medication_dose,
        u.profile_photo, u.fasting_schedule, u.fasting_start,
        u.height, u.weight, u.bmi,
        SUBSTRING(COALESCE(i.injection_day, u.injection_day) FROM 1 FOR 3) AS injection_day,
        to_char(COALESCE(i.injection_time::time, u.injection_time::time), 'HH24:MI:SS') AS injection_time,
        u.timezone,

        -- ✅ expose verification status (timestamp or null). DO NOT expose tokens.
        u.email_verified_at,

        COALESCE((
          SELECT SUM(protein_grams)
            FROM user_health_logs
           WHERE user_id = u.id
             AND entry_type = 'protein'
             AND (recorded_at AT TIME ZONE u.timezone)::date = (now() AT TIME ZONE u.timezone)::date
        ), 0) AS protein_total_today,

        COALESCE((
          SELECT SUM(hydration_amount)
            FROM user_health_logs
           WHERE user_id = u.id
             AND entry_type = 'hydration'
             AND (recorded_at AT TIME ZONE u.timezone)::date = (now() AT TIME ZONE u.timezone)::date
        ), 0) AS hydration_total_today

      FROM users u
      LEFT JOIN LATERAL (
        SELECT injection_day, injection_time
          FROM user_injection_schedule
         WHERE user_id = u.id
         ORDER BY updated_at DESC
         LIMIT 1
      ) i ON true
      WHERE u.id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      req.log?.warn({ route: 'user', userId, reason: 'user-not-found' }, 'Profile fetch');
      return res.status(404).json({ error: 'User not found' });
    }

    req.log?.info({ route: 'user', userId, hasPhoto: Boolean(result.rows[0].profile_photo) }, 'Profile fetched');
    res.json(result.rows[0]);
  } catch (err) {
    req.log?.error({ route: 'user', userId, err }, 'Profile fetch failed');
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== Helper: map weekday/time -> next ISO datetime
function getNextDateForWeekday(weekday, timeStr) {
  const code = weekday.charAt(0).toUpperCase() + weekday.slice(1,3).toLowerCase(); // Mon..Sun
  const idx = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(code);
  if (idx === -1) throw new Error('Invalid weekday name: ' + weekday);

  const now = new Date();
  const target = new Date(now);
  const [hh, mm] = timeStr.split(':').map(Number);

  const daysAhead = (7 + idx - now.getDay()) % 7; // 0..6
  target.setDate(now.getDate() + daysAhead);
  target.setHours(hh, mm, 0, 0);

  if (target <= now) target.setDate(target.getDate() + 7);
  return target.toISOString();
}

// ===== POST /api/user/plan
router.post('/plan', requireLogin, requirePro(), validate(PlanSchema), async (req, res) => {
  const started = Date.now();
  const userId = req.user.id;

  const pad2 = (n) => String(n).padStart(2, '0');
  const toHHMMSS_local = (v) => {
    if (typeof v !== 'string') return '';
    const m = v.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return '';
    let hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    let mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    const ss = m[3] ? Math.min(59, Math.max(0, parseInt(m[3], 10))) : 0;
    return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  };
  const snapToQuarter = (hhmmss) => {
    if (!hhmmss) return { time: '', carry: 0 };
    const [h, m] = hhmmss.split(':').map((x) => parseInt(x, 10));
    const step = 15 * 60;
    let total = h * 3600 + m * 60;
    let q = Math.round(total / step);
    let snapped = q * step;
    let carry = 0;
    if (snapped >= 24 * 3600) { snapped -= 24 * 3600; carry = 1; }
    const nh = Math.floor(snapped / 3600);
    const nm = Math.floor(snapped % 3600 / 60);
    return { time: `${pad2(nh)}:${pad2(nm)}:00`, carry };
  };

  let { injection_day, injection_time, reminder_option } = req.body || {};
  const dayShort = toDayShort(injection_day);
  injection_time = toHHMMSS_local(injection_time);
  if (!dayShort) {
    return res.status(400).json({ error: 'Invalid injection_day; expected Mon..Sun' });
  }
  if (!injection_time) {
    return res.status(400).json({ error: 'Invalid injection_time; expected HH:MM or HH:MM:SS' });
  }
  const { time: snapped, carry } = snapToQuarter(injection_time);
  const finalDayShort = carry ? bumpShortWeekday(dayShort) : dayShort;

  if (reminder_option != null) {
    const ok = ['24h','1h','0h'];
    if (!ok.includes(reminder_option)) {
      return res.status(400).json({ error: 'Invalid reminder_option', allowed: ok });
    }
  }

  try {
    await pool.query(
      `INSERT INTO user_injection_schedule (user_id, injection_day, injection_time, updated_at)
       VALUES ($1, $2, $3::time, now())
       ON CONFLICT (user_id)
       DO UPDATE SET injection_day = EXCLUDED.injection_day,
                     injection_time = EXCLUDED.injection_time,
                     updated_at = now()`,
      [userId, finalDayShort, snapped]
    );

    if (reminder_option != null) {
      await pool.query(`DELETE FROM injection_reminders WHERE user_id = $1`, [userId]);
      await pool.query(
        `INSERT INTO injection_reminders (user_id, reminder_option, enabled) VALUES ($1, $2, true)`,
        [userId, reminder_option]
      );
    }

    req.log.info({ userId, day: finalDayShort, time: snapped, ms: Date.now() - started }, 'Plan updated');
    return res.json({ success: true, injection_day: finalDayShort, injection_time: snapped, reminder_option });
  } catch (err) {
    req.log.error(
      { userId, ms: Date.now() - started, pgCode: err?.code, detail: err?.detail, message: err?.message },
      'Plan update failed'
    );
    return res.status(500).json({ error: 'Failed to update plan' });
  }
});

// ===== POST /api/user/injection-info
router.post(
  '/injection-info',
  requireLogin,
  requirePro(),
  validate(InjectionInfoSchema),
  async (req, res) => {
    let { injectionDay, injectionTime, medicationName, medicationDose } = req.body || {};

    // Accept 'Sat' / 'Saturday' / 6 etc.
    let fullDay = toFullWeekday(injectionDay); // => 'Saturday'
    let hhmmss  = injectionTime ? toHHMMSS(injectionTime) : null; // '12:00:00'
    if (!fullDay || !hhmmss) {
      return res.status(400).json({ error: 'Missing injectionDay or injectionTime' });
    }

    const { time: snapped, carry } = snapToQuarterHHMMSS(hhmmss, 'nearest');
    if (carry) fullDay = bumpFullWeekday(fullDay);

    const userId = req.user.id;
    const dayAbbrev = fullDay.slice(0, 3); // 'Sat'

    try {
      // 1) (Optional) update medication fields only, if provided
      if (medicationName != null || medicationDose != null) {
        await pool.query(
          `UPDATE users
             SET medication_name = COALESCE($1, medication_name),
                 medication_dose = COALESCE($2, medication_dose)
           WHERE id = $3`,
          [medicationName ?? null, medicationDose ?? null, userId]
        );
      }

      // 2) Upsert the injection schedule (snake_case table + ::time cast)
      await pool.query(
        `INSERT INTO user_injection_schedule (user_id, injection_day, injection_time, updated_at)
         VALUES ($1, $2, $3::time, now())
         ON CONFLICT (user_id)
         DO UPDATE SET injection_day = EXCLUDED.injection_day,
                       injection_time = EXCLUDED.injection_time,
                       updated_at = now()`,
        [userId, dayAbbrev, snapped]
      );

      // 3) Create/refresh the weekly reminder with T-24h pre-alert
      const { rows: tzRow } = await pool.query(
        `SELECT timezone FROM users WHERE id = $1`,
        [userId]
      );
      const tz = tzRow[0]?.timezone || 'Europe/Isle_of_Man';

      // nextOccurrenceInTz expects 'Sat' + '12:00' (HH:MM)
      const reminderDatetimeISO = nextOccurrenceInTz(dayAbbrev, snapped.slice(0, 5), tz).toISO();

      // NOTE: your reminders schema uses (user_id, title, datetime, method, advance_minutes, enabled)
      // Pass method as an array safely using ARRAY[...] to avoid cast quirks
          await pool.query(
        `INSERT INTO reminders (
            user_id, title, datetime, method, advance_minutes, enabled,
            reminder_type, day_of_week
         )
         VALUES ($1, $2, $3, ARRAY['push','email'], 1440, true, 'injection', $4)
         ON CONFLICT (user_id, title) DO UPDATE
           SET datetime        = EXCLUDED.datetime,
               method          = EXCLUDED.method,
               advance_minutes = EXCLUDED.advance_minutes,
               enabled         = true,
               reminder_type   = 'injection',
               day_of_week     = EXCLUDED.day_of_week`,
        [userId, 'Weekly Injection', reminderDatetimeISO, dayAbbrev]
      );

      req.log.info(meta(req, { day: fullDay, time: snapped }), 'Injection info + reminder saved');
      return res.json({ success: true, injectionDay: dayAbbrev, injectionTime: snapped, tz });
    } catch (err) {
      // expose a helpful detail so we can diagnose fast next time
      req.log.error(meta(req, { err: err?.message, code: err?.code, constraint: err?.constraint }), err, 'Injection info save failed');
      return res.status(500).json({
        error: 'Failed to save injection info',
        detail: err?.code || err?.constraint || err?.message
      });
    }
  }
);

// ===== POST /api/user/fasting-override
router.post('/fasting-override', requireLogin, requirePro(), validate(FastingOverrideSchema), async (req, res) => {
  const userId = req.user.id;
  let { day, start_time, end_time, first_meal_at, last_meal_at } = req.body || {};

  start_time = start_time || first_meal_at;
  end_time   = end_time   || last_meal_at;

  const dayStr = isDateOnlyYYYYMMDD(day) ? day : null;
  const start = toHHMMSS_any(start_time);
  const end = toHHMMSS_any(end_time);

  if (!dayStr || !start || !end) {
    return res.status(400).json({
      error: 'Invalid payload',
      expects: { day: 'YYYY-MM-DD', start_time: 'HH:MM[:SS]', end_time: 'HH:MM[:SS]' }
    });
  }

  try {
    const existing = await pool.query(
      `SELECT 1 FROM user_fasting_overrides WHERE user_id = $1 AND day = $2`,
      [userId, dayStr]
    );

    if (existing.rowCount > 0) {
      await pool.query(
        `UPDATE user_fasting_overrides SET start_time = $1, end_time = $2
         WHERE user_id = $3 AND day = $4`,
        [start, end, userId, dayStr]
      );
    } else {
      await pool.query(
        `INSERT INTO user_fasting_overrides (user_id, day, start_time, end_time)
         VALUES ($1, $2, $3, $4)`,
        [userId, dayStr, start, end]
      );
    }

    req.log.info(meta(req, { day: dayStr }), 'Fasting override upserted');
    res.json({ success: true, day: dayStr, first_meal_at: start, last_meal_at: end });
  } catch (err) {
    req.log.error(meta(req), err, 'Fasting override save failed');
    res.status(500).json({ error: 'Failed to save fasting override' });
  }
});

// ===== DELETE /api/user/fasting-override/:day
router.delete('/fasting-override/:day', requireLogin, requirePro(), validate(FastingDayParam, 'params'), async (req, res) => {
  const { day } = req.validParams;
  const userId = req.user.id;
  try {
    await pool.query(
      `DELETE FROM user_fasting_overrides
       WHERE user_id = $1 AND day = $2`,
      [userId, day]
    );
    return res.status(204).send();
  } catch (err) {
    req.log.error(meta(req, { day }), err, 'Fasting override delete failed');
    return res.status(500).json({ error: 'Failed to delete fasting override' });
  }
});

// ===== GET /api/user/fasting-overrides/range?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get(
  '/fasting-overrides/range',
  requireLogin,
  validate(RangeQuerySchema, 'query'),
  async (req, res) => {
    const userId = req.user.id;
    const from = String(req.validQuery.from);
    const to   = String(req.validQuery.to);

    if (from >= to) {
      return res.status(400).json({ error: '`from` must be < `to` (end is exclusive)' });
    }

    try {
      const { rows } = await pool.query(
        `SELECT day, start_time, end_time
           FROM user_fasting_overrides
          WHERE user_id = $1
            AND day >= $2
            AND day <  $3
          ORDER BY day`,
        [userId, from, to]
      );

      const out = rows.map(r => ({
        id: String(r.day),
        day: r.day,
        first_meal_at: String(r.start_time).slice(0, 5),
        last_meal_at:  String(r.end_time).slice(0, 5),
      }));

      res.json({ rows: out });
    } catch (err) {
      req.log.error(meta(req), err, 'Fasting overrides range fetch failed');
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ===== GET /api/user/fasting-override/:day
router.get('/fasting-override/:day', requireLogin, validate(FastingDayParam, 'params'), async (req, res) => {
  const { day } = req.validParams;
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT * FROM user_fasting_overrides WHERE user_id = $1 AND day = $2`,
      [userId, day]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No fasting override found for this day' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    req.log.error(meta(req), err, 'Fasting override fetch failed');
    res.status(500).json({ error: 'Failed to fetch fasting override' });
  }
});

// ===== GET /api/user/reminders/day/:date (YYYY-MM-DD)
router.get('/reminders/day/:date', requireLogin, validate(DayParam, 'params'), async (req, res) => {
  const userId = req.user.id;
  const { date } = req.validParams;

  try {
    const tz = resolveTz(req);
    const reminders = await pool.query(
      `SELECT * FROM reminders
        WHERE user_id = $1
          AND (datetime AT TIME ZONE $3)::date = $2::date
         
      ORDER BY datetime`,
      [userId, date, tz]
    );

    req.log.info(meta(req, { date, status: 200 }), 'Day reminders fetched');
    res.json(reminders.rows);
  } catch (err) {
    req.log.error(meta(req, { date }), err, 'Day reminders fetch failed');
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== GET /api/user/reminders/range?from=ISO&to=ISO&tz=Area/City
router.get('/reminders/range', requireLogin, validate(RemindersRangeQuery, 'query'), async (req, res) => {
  const userId = req.user.id;
  const from = String(req.validQuery.from);
  const to   = String(req.validQuery.to);
  const tz   = resolveTz(req);
  try {
    const fromDT = DateTime.fromISO(from, { setZone: true });
    const toDT   = DateTime.fromISO(to,   { setZone: true });
    if (!fromDT.isValid || !toDT.isValid) {
      return res.status(400).json({ error: 'Invalid from/to' });
    }
    const { rows } = await pool.query(
      `SELECT *
         FROM reminders
        WHERE user_id = $1
          AND datetime >= $2::timestamptz
          AND datetime <  $3::timestamptz
          AND enabled = true
        ORDER BY datetime`,
      [userId, fromDT.toUTC().toISO(), toDT.toUTC().toISO()]
    );
    res.json(rows);
  } catch (err) {
    req.log.error(meta(req), err, 'Reminders range fetch failed');
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== GET /api/user/reminders
router.get('/reminders', requireLogin, async (req, res) => {
  try {
    const userId = req.user.id;
   const sql = `
      SELECT *
        FROM reminders
       WHERE user_id = $1
       ORDER BY datetime NULLS FIRST, created_at DESC
    `;
    const { rows } = await pool.query(sql, [userId]);

    res.json(rows);
  } catch (err) {
    req.log.error(meta(req), err, 'Reminders fetch failed');
    res.status(500).json({ error: 'Server error' });
  }
});
// ===== GET /api/user/reminders/weekday/:day
router.get('/reminders/weekday/:day', requireLogin, validate(z.object({ day: z.string().min(3).max(9) }), 'params'), async (req, res) => {
  const userId = req.user.id;
  const dayRaw = req.validParams.day || '';
  const dayShort = dayRaw.slice(0,1).toUpperCase() + dayRaw.slice(1,3).toLowerCase();
  const valid = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  if (!valid.includes(dayShort)) {
    return res.status(400).json({ error: 'Invalid day abbreviation' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM reminders
        WHERE user_id = $1
          AND (
            day_of_week = $2
            OR LOWER(day_of_week) = CASE LOWER($2)
                 WHEN 'mon' THEN 'monday' WHEN 'tue' THEN 'tuesday' WHEN 'wed' THEN 'wednesday'
                 WHEN 'thu' THEN 'thursday' WHEN 'fri' THEN 'friday' WHEN 'sat' THEN 'saturday'
                 WHEN 'sun' THEN 'sunday' END
            OR LOWER(title) = 'weekly injection'
          )
       
      ORDER BY datetime`,
      [userId, dayShort]
    );
    res.json(rows);
  } catch (err) {
    req.log.error(meta(req, { day: dayShort }), err, 'Weekday reminders fetch failed');
    res.status(500).json({ error: 'Failed to fetch reminders for weekday' });
  }
});

// ===== POST /api/user/reminders
router.post(
  '/reminders',
  requireLogin,
 requirePro(),
  validate(ReminderCreateSchema),
  async (req, res) => {
    const userId = req.user.id;

    // tests send: { title, datetime, methods, advanceMinutes, enabled? }
    let {
      title,
      datetime,
      method,           // singular
      methods,          // plural
      advanceMinutes,      // camelCase in payload
      advance_minutes,     // snake_case from UI
      enabled = true,
      timezone,
    } = req.body || {};

    // Convert local "YYYY-MM-DDTHH:MM" → UTC using user's timezone
   if (datetime) {
  const userTzFromDb = await getUserTimezone(pool, userId);
  const tz = req.body?.timezone || req.body?.tz || userTzFromDb || req.user?.timezone || 'UTC';
  datetime = maybeToUTCFromLocal(datetime, tz);
}

    // Normalize methods -> DB column "method" (text[])
    const payloadMethods = methods ?? method ?? [];
    const methodArr = normalizeMethod(payloadMethods); // returns [] on bad input → default to ['push'] inside
    // Optional: tiny debug to confirm what's saved (remove later)
    req.log?.info(meta(req, { methodArr }), 'reminder method normalized');
    // Normalize advance minutes from either snake_case or camelCase
    // DB column is NOT NULL → default to 0 if absent/blank/invalid
    const adv = (() => {
      const raw = (advance_minutes ?? advanceMinutes);
      if (raw === undefined || raw === null) return 0;
      const s = String(raw).trim();
      if (s === '' || !/^\d+$/.test(s)) return 0;
      const n = parseInt(s, 10);
      return n >= 0 ? n : 0;
    })();

    try {
      const { rows } = await pool.query(
        `INSERT INTO reminders (user_id, title, datetime, method, advance_minutes, enabled)
         VALUES ($1, $2, $3, $4::text[], $5, $6)
         ON CONFLICT (user_id, title) DO UPDATE
           SET datetime        = COALESCE(EXCLUDED.datetime,        reminders.datetime),
               method          = COALESCE(EXCLUDED.method,          reminders.method),
               advance_minutes = COALESCE(EXCLUDED.advance_minutes, reminders.advance_minutes),
               enabled         = COALESCE(EXCLUDED.enabled,         reminders.enabled)
         RETURNING *`,
        [userId, title, datetime || null, methodArr, adv, enabled]
      );

      const row = rows[0];

      if (USE_PUSH_QUEUE) {
        const hasPush = Array.isArray(row.method) && row.method.includes('push');
        const enabledOk = row.enabled !== false;
        const hasTime = !!row.datetime;

        if (hasPush && enabledOk && hasTime) {
          enqueueReminder(row, { replacePending: true }).catch(err =>
            req.log?.error({ err, rid: row.id }, 'enqueueReminder failed (create-upsert)')
          );
        } else {
          pool
            .query(`DELETE FROM push_queue WHERE reminder_id = $1 AND status = 'pending'`, [row.id])
            .catch(err =>
              req.log?.error({ err, rid: row.id }, 'dequeue pending failed (create-upsert)')
            );
        }
      }

      req.log.info(meta(req), 'Reminder upserted');
      return res.json({ success: true, reminder: row });
    } catch (err) {
      if (err?.code === '23505') {
        return res.status(409).json({ error: 'Duplicate reminder', constraint: err.constraint });
      }
      req.log.error(meta(req), err, 'Reminder create failed');
      return res.status(500).json({ error: 'Failed to create reminder' });
    }
  }
);

// ===== PUT /api/user/reminders/:id
router.put('/reminders/:id', requireLogin, requirePro(), validate(ReminderUpdateSchema), validate(UuidParam, 'params'), async (req, res) => {
  const userId = req.user.id;
  const { id } = req.validParams;

let { title, datetime, method, methods, advance_minutes, enabled, day_of_week, reminder_type, timezone } = req.body || {};

  if (datetime) {
  const userTzFromDb = await getUserTimezone(pool, userId);
  const tz = req.body?.timezone || req.body?.tz || userTzFromDb || req.user?.timezone || 'UTC';
  datetime = maybeToUTCFromLocal(datetime, tz);
}
  const incomingMethod = methods ?? method;
  const methodArr =
    incomingMethod === undefined ? undefined : normalizeMethod(incomingMethod);

  const adv =
    advance_minutes === undefined || advance_minutes === null || advance_minutes === ''
      ? undefined
      : Number.parseInt(advance_minutes, 10);

  const dayShort =
    day_of_week === undefined ? undefined : toDayShort(day_of_week);

  const sets = [];
  const vals = [];
  let p = 1;
  const add = (col, val, cast = '') => {
    sets.push(`${col} = COALESCE($${p}${cast}, ${col})`);
    vals.push(val);
    p++;
  };

  if (title !== undefined) add('title', title);
  if (datetime !== undefined) add('datetime', datetime);
  if (dayShort !== undefined) add('day_of_week', dayShort);
  if (methodArr !== undefined) add('method', methodArr, '::text[]');
  if (adv !== undefined) add('advance_minutes', Number.isNaN(adv) ? null : adv);
  if (enabled !== undefined) add('enabled', enabled);
  if (reminder_type !== undefined) add('reminder_type', reminder_type);

  if (sets.length === 0) {
    return res.json({ success: true, noop: true });
  }

  try {
    const sql = `
      UPDATE reminders
         SET ${sets.join(', ')}
       WHERE id = $${p} AND user_id = $${p + 1}
     RETURNING *`;
    vals.push(id, userId);

    const result = await pool.query(sql, vals);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reminder not found or not yours' });
    }

    const updated = result.rows[0];

    if (USE_PUSH_QUEUE) {
      const hasPush = Array.isArray(updated?.method) && updated.method.includes('push');
      const enabledOk = updated?.enabled !== false;
      const hasTime = !!updated?.datetime;

      if (hasPush && enabledOk && hasTime) {
        enqueueReminder(updated, { replacePending: true }).catch(err =>
          req.log?.error({ err, rid: updated.id }, 'enqueueReminder failed (update)')
        );
      } else {
        pool.query(
          `DELETE FROM push_queue WHERE reminder_id = $1 AND status = 'pending'`,
          [updated.id]
        ).catch(err =>
          req.log?.error({ err, rid: updated.id }, 'dequeue pending failed (update)')
        );
      }
    }

    req.log.info(meta(req, { reminderId: id }), 'Reminder updated');
    res.json(updated);
  } catch (err) {
    req.log.error(meta(req, { reminderId: id }), err, 'Reminder update failed');
    res.status(500).json({ error: 'Failed to update reminder' });
  }
});

// ===== POST /api/user/reminders/push-subscribe
router.post('/reminders/push-subscribe', requireLogin, async (req, res) => {
 const userId = req.user.id;


  try {
    await pool.query(
      `UPDATE users SET push_subscription = $1 WHERE id = $2`,
      [JSON.stringify(req.body || {}), userId]
    );
    req.log.info(meta(req), 'Push subscription saved');
    res.json({ success: true });
  } catch (err) {
    req.log.error(meta(req), err, 'Push subscription save failed');
    res.status(500).json({ error: 'Failed to save push subscription' });
  }
});

// ===== DELETE /api/user/reminders/push-subscribe
router.delete('/reminders/push-subscribe', requireLogin, async (req, res) => {
  const userId = req.user.id;
  try {
    await pool.query(`UPDATE users SET push_subscription = NULL WHERE id = $1`, [userId]);
    req.log.info(meta(req), 'Push subscription cleared');
    res.json({ success: true });
  } catch (err) {
    req.log.error(meta(req), err, 'Push unsubscribe failed');
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// ===== DELETE /api/user/reminders/:id
router.delete('/reminders/:id', requireLogin, requirePro(), async (req, res) => {
  const userId = req.user.id;
  const idRaw = String(req.params?.id || '');
  const isUuid = z.string().uuid().safeParse(idRaw).success;
  req.log?.info({ route:'user', action:'reminder-delete-attempt', id: idRaw, isUuid, userId }, 'Delete requested');

  try {
    // clean up any pending queue items
    try {
      await pool.query(
        `DELETE FROM push_queue WHERE reminder_id::text = $1 AND status = 'pending'`,
        [idRaw]
      );
    } catch (e) {
      req.log?.warn({ route:'user', reminderId: idRaw, reason: e.message }, 'Queue cleanup failed (delete)');
    }

    const sql = isUuid
      ? `DELETE FROM reminders WHERE id = $1::uuid AND user_id = $2 RETURNING id`
      : `DELETE FROM reminders WHERE id::text = $1 AND user_id = $2 RETURNING id`;
    const result = await pool.query(sql, [idRaw, userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Reminder not found or not yours' });
    }

    req.log.info({ route:'user', reminderId: idRaw }, 'Reminder deleted');
    return res.status(204).send();
  } catch (err) {
   req.log.error({ route:'user', reminderId: idRaw }, err, 'Reminder delete failed');;
    return res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

// ===== POST /api/user/exercise
router.post('/exercise', requireLogin, requirePro(), async (req, res) => {
  const {
    day_of_week,
    start_time,
    end_time,
    exercise_type,
    calories_burned,
    exercise_date,
    date
  } = req.body || {};
  const userId = req.user.id;

  if (!start_time || !end_time || !exercise_type || (!day_of_week && !exercise_date && !date)) {
    req.log.warn(meta(req, { reason: 'missing-fields' }), 'Exercise create missing fields');
    return res.status(400).json({
      error: 'Missing required fields (title, start, end, and either day_of_week or date)'
    });
  }

  try {
  // resolve timezone once for this handler
  const userTzFromDb = await getUserTimezone(pool, userId);
  const tz = req.body?.timezone || req.body?.tz || userTzFromDb || req.user?.timezone || 'UTC';

  const toHHMMSS = (t) => (t && t.length === 5 ? `${t}:00` : String(t));
  const sTime = toHHMMSS(start_time);
  const eTime = toHHMMSS(end_time);

    let startDT, endDT, normalizedDay;

    const dateOnly = String(exercise_date || date || '').trim();
    if (dateOnly) {
      const [sH, sM] = sTime.slice(0,5).split(':').map(n => parseInt(n,10) || 0);
      const [eH, eM] = eTime.slice(0,5).split(':').map(n => parseInt(n,10) || 0);

      startDT = DateTime.fromISO(`${dateOnly}T00:00`, { zone: tz })
        .set({ hour: sH, minute: sM, second: 0, millisecond: 0 });
      endDT = DateTime.fromISO(`${dateOnly}T00:00`, { zone: tz })
        .set({ hour: eH, minute: eM, second: 0, millisecond: 0 });

      if (!startDT.isValid || !endDT.isValid) {
        return res.status(400).json({ error: 'Invalid date/start_time/end_time' });
      }
      if (endDT <= startDT) endDT = endDT.plus({ days: 1 });

      normalizedDay = startDT.toFormat('ccc');
    } else {
      const dow = String(day_of_week || '').slice(0,3);
      normalizedDay = dow.slice(0,1).toUpperCase() + dow.slice(1).toLowerCase();

      startDT = nextOccurrenceInTz(normalizedDay, sTime.slice(0,5), tz);
      endDT   = startDT.set({
        hour:   parseInt(eTime.slice(0,2),10) || 0,
        minute: parseInt(eTime.slice(3,5),10) || 0,
        second: 0, millisecond: 0,
      });
      if (endDT <= startDT) endDT = endDT.plus({ days: 1 });
    }

    const start_at = startDT.toISO();
    const end_at   = endDT.toISO();
    const cals = (calories_burned === '' || calories_burned == null)
      ? null
      : Number(calories_burned);

    await pool.query(
      `DELETE FROM exercise_entries
        WHERE user_id = $1 AND exercise_type = $2
          AND start_at = $3::timestamptz AND end_at = $4::timestamptz`,
      [userId, exercise_type, start_at, end_at]
    );

    const { rows } = await pool.query(
      `INSERT INTO exercise_entries (
         user_id, day_of_week, start_time, end_time, exercise_type, calories_burned, start_at, end_at
       )
       VALUES ($1, $2, $3::time, $4::time, $5, $6, $7::timestamptz, $8::timestamptz)
       ON CONFLICT (user_id, exercise_type, start_at, end_at)
       WHERE start_at IS NOT NULL AND end_at IS NOT NULL
       DO UPDATE SET
         calories_burned = COALESCE(EXCLUDED.calories_burned, exercise_entries.calories_burned)
       RETURNING id`,
      [userId, normalizedDay, sTime, eTime, exercise_type, cals, start_at, end_at]
    );

    req.log.info(meta(req, { day: normalizedDay, exerciseId: String(rows[0].id) }), 'Exercise saved');
    return res.json({ success: true, id: rows[0].id });
  } catch (err) {
    req.log.error(meta(req), { code: err?.code, detail: err?.detail, message: err?.message }, 'Exercise save failed');
    return res.status(500).json({ error: 'Failed to save exercise' });
  }
});

// ===== PATCH /api/user/exercise/:id
router.patch('/exercise/:id', requireLogin, requirePro(), async (req, res) => {
   const { calories_burned } = req.body || {};
   const id = req.params?.id;
   const parsed = z.string().uuid().safeParse(id);
   if (!parsed.success) {
     return res.status(400).json({ error: 'Invalid id' });
   }
   // use parsed.data as the UUID
  const userId = req.user.id;

  if (typeof calories_burned !== 'number' || calories_burned < 0) {
    return res.status(400).json({ error: 'Invalid calories value' });
  }

  try {
    await pool.query(
      `UPDATE exercise_entries
          SET calories_burned = $1
        WHERE id = $2 AND user_id = $3`,
      [calories_burned, parsed.data, userId]
    );
    req.log.info(meta(req, { exerciseId: id }), 'Exercise calories updated');
    res.json({ success: true });
  } catch (err) {
    req.log.error(meta(req, { exerciseId: id }), err, 'Exercise calories update failed');
    res.status(500).json({ error: 'Failed to update exercise entry' });
  }
});

// ===== GET /api/user/exercise
router.get('/exercise', requireLogin, async (req, res) => {
  const userId = req.user.id;


  try {
    const result = await pool.query(
      `SELECT * FROM exercise_entries WHERE user_id = $1 ORDER BY COALESCE(start_at, created_at) DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error(meta(req), err, 'Exercise fetch failed');
    res.status(500).json({ error: 'Failed to load exercises' });
  }
});

// ===== DELETE /api/user/exercise/:id
router.delete('/exercise/:id', requireLogin, requirePro(), async (req, res) => {
   const id = req.params?.id;
   const parsed = z.string().uuid().safeParse(id);
   if (!parsed.success) {
     return res.status(400).json({ error: 'Invalid id' });
   }
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `DELETE FROM exercise_entries
         WHERE id = $1::uuid AND user_id = $2
      RETURNING id`,
      [parsed.data, userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });

    return res.json({ success: true });
  } catch (err) {
    req.log.error(meta(req, { exerciseId: id }), err, 'Exercise delete failed');
    return res.status(500).json({ error: 'Failed to delete exercise' });
  }
});

// ===== DELETE /api/user/exercise/expired
router.delete('/exercise/expired', requireLogin, requirePro(), async (req, res) => {
  try {
    await pool.query(
       `DELETE FROM exercise_entries
        WHERE user_id = $1
          AND COALESCE(end_at, start_at, created_at) < NOW() - INTERVAL '24 hours'`,
      [req.user.id]
    );
    req.log.info(meta(req), 'Old exercises cleaned');
    res.json({ success: true });
  } catch (err) {
    req.log.error(meta(req), err, 'Exercise cleanup failed');
    res.status(500).json({ error: 'Failed to clean up' });
  }
});

// ===== GET /api/user/secure-photo/:filename
router.get('/secure-photo/:filename', requireLogin, async (req, res) => {
  const requested = path.basename(String(req.params.filename || ''));
  const safePath  = path.join(uploadDir, requested);

  req.log.info(meta(req, { filename: requested }), 'Secure photo requested');

  try {
    const { rows } = await pool.query(
      'SELECT profile_photo FROM users WHERE id = $1',
      [req.user.id]
    );
    const expected = rows[0]?.profile_photo || '';

    if (requested !== path.basename(expected)) {
      req.log.warn(meta(req, { filename: requested, reason: 'filename-mismatch' }), 'Secure photo denied');
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      await fsp.access(safePath, fs.constants.R_OK);
    } catch {
      req.log.warn(meta(req, { filename: requested, reason: 'not-found' }), 'Secure photo not found');
      return res.status(404).json({ error: 'File not found' });
    }

    res.type(path.extname(requested) || '.jpg');
    res.set('Cache-Control', 'no-store');

    return res.sendFile(safePath, (err) => {
      if (err) {
        req.log.error(meta(req, { filename: requested }), err, 'Secure photo send error');
        if (!res.headersSent) res.status(500).json({ error: 'Server error' });
      }
    });
  } catch (err) {
    req.log.error(meta(req, { filename: requested }), err, 'Secure photo error');
    return res.status(500).json({ error: 'Server error' });
  }
});

// routes/user.js
router.get('/reminders/count', requireLogin, async (req, res) => {
  const log = req.log || require('../logger');
  const userId = req.session?.user?.id || req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
   const { rows } = await pool.query(
      `SELECT COALESCE(COUNT(*),0)::int AS count
         FROM reminders
        WHERE user_id = $1`,
      [userId]
    );
    res.json({ count: Number(rows?.[0]?.count ?? 0) });
  } catch (err) {
    log.error({ err, userId }, 'Reminders count failed');
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== GET /api/user/reminders/upcoming?window=60
router.get('/reminders/upcoming', requireLogin, validate(UpcomingQuery, 'query'), async (req, res) => {
  const userId = req.user.id;
  const windowMin = req.validQuery.window ?? 60;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        r.id, r.title, r.reminder_type, r.datetime, r.advance_minutes, r.method,
        (r.datetime - COALESCE(r.advance_minutes,0)::double precision * '00:01:00'::interval) AS fire_at
      FROM reminders r
      WHERE r.user_id = $1
        AND r.enabled = true
        AND (r.method IS NULL OR 'push' = ANY(r.method))
        AND (r.datetime - COALESCE(r.advance_minutes,0)::double precision * '00:01:00'::interval)
             BETWEEN now() AND now() + ($2 || ' minutes')::interval
      ORDER BY fire_at ASC
      `,
      [userId, windowMin]
    );
    res.json(rows);
  } catch (err) {
    req.log.error({ route: 'user', userId, windowMin }, err, 'Upcoming reminders failed');
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== GET /api/user/reminders/due-now
router.get('/reminders/due-now', requireLogin, async (req, res) => {
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        r.id, r.title, r.reminder_type, r.datetime, r.advance_minutes, r.method,
        (r.datetime - COALESCE(r.advance_minutes,0)::double precision * '00:01:00'::interval) AS fire_at
      FROM reminders r
      WHERE r.user_id = $1
        AND r.enabled = true
        AND (r.method IS NULL OR 'push' = ANY(r.method))
        AND (r.datetime - COALESCE(r.advance_minutes,0)::double precision * '00:01:00'::interval) <= now()
        AND (r.last_sent_at IS NULL
             OR r.last_sent_at < (r.datetime - COALESCE(r.advance_minutes,0)::double precision * '00:01:00'::interval))
      ORDER BY fire_at ASC
      `,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    req.log.error({ route: 'user', userId }, err, 'Due-now reminders failed');
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== POST /api/user/injection/taken
router.post('/injection/taken', requireLogin, requirePro(), async (req, res) => {
  const userId = req.user.id;
  const { taken_at, medication_name, medication_dose } = req.body || {};

  const userTzFromDb = await getUserTimezone(pool, userId);
  const tz = req.body?.timezone || req.body?.tz || userTzFromDb || req.user?.timezone || 'UTC';

  const takenAtIso = taken_at
    ? maybeToUTCFromLocal(String(taken_at), tz)
    : new Date().toISOString();

  try {
    const sql = `
      WITH u AS (
        SELECT medication_name, medication_dose
          FROM users
         WHERE id = $1
      )
      INSERT INTO user_injection_log (user_id, medication_name, medication_dose, taken_at)
      SELECT $1,
             COALESCE($2, u.medication_name),
             COALESCE($3, u.medication_dose),
             $4::timestamptz
        FROM u
      RETURNING id, user_id, medication_name, medication_dose, taken_at, created_at
    `;
    const vals = [userId, medication_name || null, medication_dose || null, takenAtIso];
    const { rows } = await pool.query(sql, vals);
    return res.json({ success: true, log: rows[0] });
  } catch (err) {
    req.log?.error({ err }, 'injection taken save failed');
    return res.status(500).json({ error: 'Failed to save injection log' });
  }
});

// ===== GET /api/user/injection/last
router.get('/injection/last', requireLogin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, medication_name, medication_dose, taken_at
         FROM user_injection_log
        WHERE user_id = $1
     ORDER BY taken_at DESC
        LIMIT 1`,
      [req.user.id]
    );
    return res.json(rows[0] || null);
  } catch (err) {
    req.log?.error({ err }, 'injection last fetch failed');
    return res.status(500).json({ error: 'Failed to fetch last injection' });
  }
});

// ===== GET /api/user/injection/history?start=ISO&end=ISO
router.get('/injection/history', requireLogin, async (req, res) => {
  const { start, end } = req.query || {};
  try {
    let sql = `SELECT id, medication_name, medication_dose, taken_at
                 FROM user_injection_log
                WHERE user_id = $1`;
    const args = [req.user.id];
    if (start && end) {
      sql += ` AND taken_at >= $2::timestamptz AND taken_at < $3::timestamptz`;
      args.push(String(start), String(end));
    }
    sql += ` ORDER BY taken_at DESC`;
    const { rows } = await pool.query(sql, args);
    return res.json(rows);
  } catch (err) {
    req.log?.error({ err }, 'injection history fetch failed');
    return res.status(500).json({ error: 'Failed to fetch injection history' });
  }
});

// ===== GET /api/user/pro-status — sanity check for Pro gating
router.get('/pro-status', requireLogin, async (req, res) => {
  // Mirror the same logic requirePro uses (local flags only; no DB)
  const u = req.user || req.session?.user || {};
  const now = Date.now();
  const proUntilMs = u?.pro_until ? new Date(u.pro_until).getTime() : 0;
  const localPro = Boolean(
    u?.has_pro === true ||
    u?.is_pro === true ||
    (proUntilMs && proUntilMs > now) ||
    (u?.rc_entitlements && u.rc_entitlements.pro === true) ||
    u?.subscription_tier === 'pro'
  );
   // also check DB using the same fetch
const { fetchHasPro } = require('../lib/pro');
  const dbPro = await fetchHasPro(require('../models/db').pool, u?.id);
  res.json({ user_id: u?.id || null, localPro, dbPro });
});

router.delete('/account', requireLogin, async (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const r = await purgeUser(req.app.locals.pool, userId);
    if (!r.ok && r.notFound) return res.status(404).json({ error: 'Not found' });

    // Destroy session after successful purge
    req.session.destroy(() => {});
    return res.json({ ok: true, deleted: r.counts });
  } catch (e) {
    req.log?.error({ errCode: e?.code, table: e?._label, message: e?.message }, 'account delete failed');
    return res.status(500).json({ error: 'Deletion failed' });
  }
});



module.exports = router;
