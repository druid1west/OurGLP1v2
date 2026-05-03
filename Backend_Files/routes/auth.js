// routes/auth.js
'use strict';
const signature = require('cookie-signature');
const crypto = require('crypto');

// NOTE: do NOT load dotenv here — it’s already loaded in server.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../models/db');
const baseLogger = require('../logger');
const { sendResetEmail, sendVerifyEmail } = require('../mailer');
const { fetchHasPro } = require('../lib/pro');

// ── Base origins (defined early so helpers can safely use them)

// If PUBLIC_API_URL/API_BASE_URL include a path (e.g. https://host/api),
// keep only the scheme+host for origin checks and OAuth redirect building.
const RAW_API_BASE = (process.env.API_BASE_URL || process.env.PUBLIC_API_URL || 'https://app.ourglp1.com').replace(/\/+$/, '');
function originOf(u) {
  try { return new URL(u).origin; }
  catch { return String(u).replace(/\/+$/, ''); }
}
const API_ORIGIN = originOf(RAW_API_BASE);

const APP_BASE_URL =
  (process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || 'https://app.ourglp1.com')
    .replace(/\/+$/, '');

const APP_SCHEME = process.env.APP_SCHEME || 'ourglp1://oauth-complete';

baseLogger.info({ APP_BASE_URL, API_ORIGIN }, '🔧 Auth origins configured');

// Align with server.js CORS (accept native shells + localhost + null)
const TRUSTED_ORIGINS = new Set([
  originOf(APP_BASE_URL),
  API_ORIGIN,
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'http://127.0.0.1',
  'null',                      // WKWebView sometimes sends Origin: null
]);
function isTrustedOrigin(origin) {
  return TRUSTED_ORIGINS.has(String(origin || ''));
}

const VERIFY_WINDOW_MS = 1000 * 60 * 60 * 24 * 3; // 3 days

const urlencodedParser = express.urlencoded({ extended: false });


baseLogger.info('✅ Loaded auth routes');

const { z } = require('zod');
const rateLimit = require('express-rate-limit');



// --- OAuth session handoff helpers ---
async function issueHandoffToken(userId) {
  const raw = crypto.randomBytes(32).toString('hex'); // 64 hex chars
  const tokenHash = hashToken(raw);
  const expires = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

  let client;
  try {
    client = await pool.connect();
    await client.query(
      `INSERT INTO session_handoff (token_hash, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [tokenHash, userId, expires.toISOString()]
    );
    return raw;
  } finally {
    client?.release?.();
  }
}

async function consumeHandoffToken(raw) {
  const tokenHash = hashToken(raw);
  let client;
  try {
    client = await pool.connect();
    const { rows } = await client.query(
      `DELETE FROM session_handoff
         WHERE token_hash = $1
           AND used_at IS NULL
           AND expires_at > now()
       RETURNING user_id`,
      [tokenHash]
    );
    return rows.length ? rows[0].user_id : null;
  } finally {
    client?.release?.();
  }
}

function signedSid(sessionID) {
  const secret = process.env.SESSION_SECRET || 'default';
  return 's:' + signature.sign(sessionID, secret);
}

function setAliasCookie(res, signedValue) {
  // Mirror flags on the main cookie so the browser/native store accepts it
  res.cookie('glp1.sid', signedValue, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
    // no Domain (so it behaves like __Host-*; also works fine at host scope)
  });
}


function isNativeOrigin(req) {
  const o = req.get('Origin') || '';
  return o === 'capacitor://localhost' || o === 'ionic://localhost';
}
// Centralized allowlist for native/web origins hitting auth endpoints.
function isTrustedOrigin(origin) {
  // Accept missing Origin (e.g., direct navigations / native sheets)
  if (!origin) return true;
  try {
    const o = originOf(origin);
    // 1) Your SPA’s web origin
    if (o === originOf(APP_BASE_URL)) return true;
    // 2) Your API origin (often the same host, but be explicit)
    if (o === originOf(API_ORIGIN)) return true;
    // 3) Optional extra allow-list from env (comma-separated)
    const extras = String(process.env.EXTRA_TRUSTED_ORIGINS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(originOf);
    if (extras.includes(o)) return true;
  } catch { /* ignore parse errors */ }

  // Capacitor/iOS & Ionic schemes
  if (origin === 'capacitor://localhost' || origin === 'ionic://localhost') return true;

  // Android Capacitor local server (http://localhost[:port]) + 127.0.0.1
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return true;

  // Some WebViews report a literal "null" Origin
  if (origin === 'null') return true;

  return false;
}





  /* ─────────────────────────── NEW: tiny log helpers ─────────────────────────── */
function probeReq(req, tag, extra = {}) {
  const h = req.headers || {};
  (req.log || baseLogger).info({
    tag,
    method: req.method,
    url: (req.originalUrl || req.url || '').split('?')[0],
    origin: req.get('Origin') || null,
    hasCookieHdr: Boolean(h.cookie),
    cookieLen: h.cookie ? String(h.cookie).length : 0,
    ua: req.get('user-agent') || null,
    sessionId: req.sessionID || null,
    hasSessionUser: !!req.session?.user,
    ...extra,
  }, 'probe');
}
function probeSetCookie(req, res, tag, extra = {}) {
  const sc = res.getHeader('set-cookie');
  (req.log || baseLogger).info({
    tag,
    setCookie: sc,
    sessionId: req.sessionID || null,
    hasUser: !!req.session?.user,
    ...extra,
  }, 'set-cookie snapshot');
}



function htmlRedirectPage(url) {
  const esc = String(url).replace(/"/g, '&quot;');
  return `<!doctype html>
<meta charset="utf-8">
<title>Signing you in…</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px;line-height:1.4}
  a{font-weight:600}
</style>
<p>Redirecting you to the app… If this doesn’t happen automatically, 
  <a id="link" href="${esc}" target="_top" rel="noopener noreferrer">continue here</a>.
</p>
<script>
(function(){
  var u="${esc}";
  try { if (window.opener && !window.opener.closed) window.opener.postMessage('oauth:success', '*'); } catch(e){}
  try {
    // 1) try top frame (Apple sheet)
    if (window.top && window.top !== window) { window.top.location.assign(u); return; }
    // 2) normal same-window replace
    window.location.replace(u);
  } catch(e) {
    try { window.open(u, '_top'); } catch(_) { location.href = u; }
  }
})();
</script>
<noscript><meta http-equiv="refresh" content="0;url=${esc}"></noscript>`;
}

// Coerce various DB time-ish values → "HH:MM"
function toHHMM(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    // handles "HH:MM:SS" or ISO "YYYY-...THH:MM:SS..."
    const m = v.match(/T?(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : v.slice(0, 5);
  }
  if (v instanceof Date && !isNaN(v)) {
    const hh = String(v.getHours()).padStart(2, '0');
    const mm = String(v.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return null;
}

function maskEmail(email = '') {
  const [name, domain] = String(email).split('@');
  if (!domain) return '***';
  const [host, ...tldParts] = domain.split('.');
  const tld = tldParts.join('.') || '';
  const safe = (s) => (s?.length > 1 ? s[0] + '***' : '*');
  return `${safe(name)}@${safe(host)}${tld ? '.' + tld : ''}`;
}

/** Build per-request meta safely (used in log calls) */
function meta(req, extra = {}) {
  return {
    userId: req.session?.user?.id ?? null,
    ip: req.ip,
    ua: req.get('user-agent'),
    ...extra,
  };
}

// jose (ESM) lazy loader for CommonJS files
let _jose;
async function getJose() {
  if (!_jose) {
    try {
      _jose = await import('jose'); // works once globalThis.crypto is set
    } catch {
      _jose = await import('jose/webcrypto'); // fallback if your version exposes this path
    }
  }
  return _jose;
}

// --- ID Token verification helpers (Google & Apple) ---
let _googleJwks, _appleJwks;

async function getRemoteJwks(provider) {
  const { createRemoteJWKSet } = await getJose();
  if (provider === 'google') {
    if (!_googleJwks) {
      _googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    }
    return _googleJwks;
  }
  if (provider === 'apple') {
    if (!_appleJwks) {
      _appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
    }
    return _appleJwks;
  }
  throw new Error('Unsupported provider for JWKS');
}

async function verifyIdToken(provider, idToken) {
  const { jwtVerify } = await getJose();
  const jwks = await getRemoteJwks(provider);

 const audience =
    provider === 'google' ? (GOOGLE_CLIENT_IDS.length ? GOOGLE_CLIENT_IDS : undefined) :
    provider === 'apple'  ? (APPLE_AUDIENCES.length   ? APPLE_AUDIENCES   : undefined) :
    undefined;

  const issuer =
    provider === 'google' ? ['https://accounts.google.com', 'accounts.google.com'] :
    provider === 'apple'  ? ['https://appleid.apple.com'] :
    undefined;

  const { payload } = await jwtVerify(idToken, jwks, {

    audience,
    issuer,
    // allow a little clock skew
    clockTolerance: 5,
  });

  // Normalize shape
  const sub = payload.sub;
  const email = (payload.email || null);
  const email_verified =
    String(payload.email_verified).toLowerCase() === 'true' || payload.email_verified === true;

  // Google often includes names in the id_token; Apple usually does not.
  const given_name  = payload.given_name || null;
  const family_name = payload.family_name || null;

  return { sub, email, email_verified, given_name, family_name, raw: payload };
}

async function upsertUserFromProvider({ provider, sub, email, email_verified, given_name, family_name }) {
  let client, user;
  try {
    client = await pool.connect();

    // 1) Already linked by provider/sub?
    const sel = await client.query(
      `SELECT * FROM users WHERE auth_provider = $1 AND provider_sub = $2 LIMIT 1`,
      [provider, sub]
    );

    if (sel.rowCount > 0) {
      user = sel.rows[0];

      if (!user.email && email) {
        await client.query(
          `UPDATE users SET email = $1, updated_at = now() WHERE id = $2 AND email IS NULL`,
          [email.toLowerCase(), user.id]
        );
        user.email = email.toLowerCase();
      }
      if (email && email_verified && !user.email_verified_at) {
        await client.query(
          `UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1`,
          [user.id]
        );
        user.email_verified_at = new Date().toISOString();
      }
      if (provider === 'apple' && email && isAppleRelay(email) && user.apple_private_relay !== true) {
        await client.query(
          `UPDATE users SET apple_private_relay = true, updated_at = now() WHERE id = $1`,
          [user.id]
        );
        user.apple_private_relay = true;
      }
    } else {
      // 2) Not linked; try to link by email if we have one
      let linked = null;
      if (email) {
        const selByEmail = await client.query(
          `SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          [email]
        );
        if (selByEmail.rowCount > 0) linked = selByEmail.rows[0];
      }

      if (linked) {
        const upd = await client.query(
          `UPDATE users
             SET auth_provider = $1,
                 provider_sub  = $2,
                 apple_private_relay = COALESCE($3, apple_private_relay),
                 email_verified_at   = CASE
                   WHEN $4::bool = true AND email_verified_at IS NULL THEN now()
                   ELSE email_verified_at
                 END,
                 updated_at = now()
           WHERE id = $5
           RETURNING *`,
          [provider, sub, (provider === 'apple' && email && isAppleRelay(email)) || null, email_verified, linked.id]
        );
        user = upd.rows[0];
      } else {
        const relay = provider === 'apple' && email && isAppleRelay(email);
        const ins = await client.query(
          `INSERT INTO users (
             auth_provider, provider_sub, email,
             first_name, last_name, apple_private_relay, is_active,
             email_verified_at
           )
           VALUES ($1,$2,$3,$4,$5,$6,true,$7)
           RETURNING *`,
          [
            provider,
            sub,
            email ? email.toLowerCase() : null,
            given_name,
            family_name,
            relay,
            email && email_verified ? new Date().toISOString() : null,
          ]
        );
        user = ins.rows[0];
      }
    }

    try {
      await client.query(`UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`, [user.id]);
    } catch {}

    return user;
  } finally {
    client?.release?.();
  }
}


const normalizeEmail = (s) => String(s || '').toLowerCase().trim();
const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');

// zod schemas
const ResetRequestSchema = z.object({
  email: z.string().email().max(320),
});

const ResetPasswordSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid token'), // 32 bytes hex
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be 72 characters or fewer'), // bcrypt limit
});

const TokenParamSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid token'),
});

// Local validator (no global middleware needed here)
const validate = (schema, src = 'body') => (req, res, next) => {
  const data = src === 'params' ? req.params : req.body;
  const out = schema.safeParse(data);
  if (!out.success) {
    req.log?.warn({ route: 'auth', reason: 'validation_failed', details: out.error.flatten() });
    return res.status(400).json({ error: 'validation_failed', details: out.error.flatten() });
  }
  if (src === 'params') req.validParams = out.data;
  else req.valid = out.data;
  next();
};

// Rate limits (memory; swap for Redis in prod if needed)
const rlResetRequest = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 5,                    // per key
  keyGenerator: (req) => `${req.ip}|${normalizeEmail(req.body?.email)}`,
  standardHeaders: true,
  legacyHeaders: false,
});

const rlResetSubmit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `${req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
});


// Ensure we always have a logger on req (tests, scripts)
router.use((req, _res, next) => {
  req.log = req.log ? req.log.child({ route: 'auth' }) : baseLogger.child({ route: 'auth' });
  next();
});

// ─────────────────────────── NEW: quick cookie probe ───────────────────────────
// GET /api/auth/debug-cookies
router.get('/debug-cookies', (req, res) => {
  probeReq(req, 'auth_debug_cookies_enter');
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({
    origin: req.get('Origin') || null,
    cookieHeaderPresent: !!req.headers.cookie,
    cookieHeaderLen: req.headers.cookie ? String(req.headers.cookie).length : 0,
    sessionId: req.sessionID || null,
    hasSessionUser: !!req.session?.user,
  });
});
// Quick session probe too (what /me would see, without DB work)
router.get('/debug-session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({
    sessionId: req.sessionID || null,
    hasUser: !!req.session?.user,
    keys: req.session ? Object.keys(req.session) : [],
  });
});

// === POST /login (hardened)
router.post('/login', async (req, res) => {
  const started = Date.now();

  // (Optional) Old path heads-up (kept but sanitized)
  if (req.originalUrl === '/auth/login') {
    req.log.warn(meta(req, { reason: 'deprecated-path' }), 'Incoming request to deprecated /auth/login');
  }

// Probe at entry
  probeReq(req, 'login_enter');
  // Same-origin / trusted-origin check (defense-in-depth)
  const origin = req.get('Origin') || '';
  if (!isTrustedOrigin(origin)) {
    req.log?.warn({ tag: 'origin_reject', origin }, 'Forbidden origin on /auth/login');
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Enforce JSON body
  if (!/application\/json/i.test(req.get('content-type') || '')) {
    return res.status(400).json({ error: 'Expected application/json' });
  }

  const emailRaw = req.body?.email;
  const email = emailRaw?.toLowerCase().trim();
  const password = req.body?.password;

  if (!email || !password) {
    req.log.warn(meta(req, { emailMasked: maskEmail(emailRaw), reason: 'missing-fields' }), 'Login: missing fields');
    return res.status(400).json({ error: 'Missing fields' });
  }

  req.log.info(meta(req, { emailMasked: maskEmail(email) }), 'Login attempt');

  // Dummy bcrypt hash of the string "invalid" (cost 12) to normalize timing for unknown users
  const DUMMY_HASH = '$2b$12$C8Vb0h9u4m6zJY5mRkQ7wOb0H8a4m9TQqJ7mM9yGv9w2b6z.6bJ3S';

  let client;
  try {
    client = await pool.connect();
    const q = await client.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);

    // If user not found, do a dummy compare to keep timing similar
    if (q.rowCount === 0) {
      await bcrypt.compare(password, DUMMY_HASH);
      req.log.warn(meta(req, { emailMasked: maskEmail(email), reason: 'user-not-found' }), 'Login failed');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = q.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash || DUMMY_HASH);
    if (!ok) {
      req.log.warn(meta(req, { emailMasked: maskEmail(email), reason: 'bad-password' }), 'Login failed');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // ✅ NEW: record successful login time (non-blocking if it fails)
    try {
      await client.query(
        `UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`,
        [user.id]
      );
    } catch (e) {
      req.log?.warn(meta(req, { userId: user.id, reason: e.message }), 'last_login_at update failed');
      // continue login flow even if this fails
    }

    // 🛡️ Session fixation defense: rotate the SID BEFORE populating session
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        req.log.error(meta(req, { emailMasked: maskEmail(email) }), regenErr, 'Session regen failed');
        return res.status(500).json({ error: 'Session error' });
      }

      // Minimal-but-useful session; no secrets/PHI
      req.session.user = {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        medication_name: user.medication_name,
        medication_dose: user.medication_dose,
        profile_photo: user.profile_photo,
        height: user.height,
        weight: user.weight,
        bmi: user.bmi,
        fasting_schedule: user.fasting_schedule,
        fasting_start: user.fasting_start,
        timezone: user.timezone || 'UTC',
        injection_day: user.injection_day || null,
        injection_time: toHHMM(user.injection_time) || null,
      };
      // add has_pro to the session so the UI can gate immediately
      fetchHasPro(client, user.id)
        .then((hp) => { req.session.user.has_pro = hp; })
        .catch(() => { req.session.user.has_pro = false; });

      // Useful auth metadata (can help detect session theft)
      req.session.createdAt = Date.now();
      req.session.lastAuthAt = Date.now();
      // Bind lightweight, non-identifying client hints
      try {
        const ua = (req.get('user-agent') || '').slice(0, 200);
        const ip = req.ip || '';
        // use top-level `crypto` import
        req.session.client_fp = crypto
          .createHash('sha256')
          .update(`${ip}|${ua}`) // not unique PII; just a coarse hint
          .digest('hex')
          .slice(0, 16);
      } catch (_) { /* ignore */ }


      req.session.save((saveErr) => {
        if (saveErr) {
          req.log.error(meta(req, { emailMasked: maskEmail(email) }), saveErr, 'Session save failed');
          return res.status(500).json({ error: 'Session save failed' });
        }

        // Ensure the response is never cached
        res.set('Cache-Control', 'no-store');

        // Rebind logger so this response’s logs include userId automatically
        if (req.log) req.log = req.log.child({ userId: req.session.user.id });
        req.log.info(
          meta(req, { userId: req.session.user.id, ms: Date.now() - started }),
          'Login success'
        );
         // NEW: snapshot Set-Cookie we are sending
        probeSetCookie(req, res, 'login_after_save', { ms: Date.now() - started });
        // Always set the alias cookie too (helps WKWebView)
        try {
          if (req.sessionID) setAliasCookie(res, signedSid(req.sessionID));
        } catch {}

        // Also return a signed SID envelope so the app can write via CapacitorCookies if needed
        const body = {
          message: 'Login successful',
          sid: req.sessionID ? signedSid(req.sessionID) : undefined,
        };
        return res.status(200).json(body);
      });
    });
  } catch (err) {
    req.log.error({ ...meta(req, { emailMasked: maskEmail(email) }), err }, 'Login error');
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client?.release?.();
  }
});

// ——— OAuth helpers & env ———

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const APPLE_TEAM_ID    = process.env.APPLE_TEAM_ID;
const APPLE_KEY_ID     = process.env.APPLE_KEY_ID;
const APPLE_CLIENT_ID  = process.env.APPLE_CLIENT_ID; // Apple "Services ID"
const APPLE_PRIVATE_KEY = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

// NEW: native audiences
// For Google: allow comma-separated list (iOS client ID, Web client ID, etc.)
const GOOGLE_CLIENT_IDS = String(process.env.GOOGLE_CLIENT_IDS || GOOGLE_CLIENT_ID || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
// For Apple: allow both your Services ID (web) and your Bundle ID (native)
const APPLE_AUDIENCES = [
  process.env.APPLE_CLIENT_ID,   // Services ID  (web)
  process.env.APPLE_APP_ID,      // old var name some teams use
  process.env.APPLE_BUNDLE_ID,   // Bundle ID    (native)
].filter(Boolean);

// URL-encode an object (x-www-form-urlencoded)
const qstr = (obj) =>
  Object.entries(obj)
    .filter(([,v]) => v !== undefined && v !== null)
    .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

const isAppleRelay = (email) => /@privaterelay\.appleid\.com$/i.test(String(email || ''));

async function buildAppleClientSecret() {
  const { SignJWT, importPKCS8 } = await getJose(); // 👈 dynamic import

  const alg = 'ES256';
  const key = await importPKCS8(APPLE_PRIVATE_KEY, alg);

  return await new SignJWT({
    iss: APPLE_TEAM_ID,
    aud: 'https://appleid.apple.com',
    sub: APPLE_CLIENT_ID,
  })
    .setProtectedHeader({ alg, kid: APPLE_KEY_ID, typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key);
}


// === POST /register
router.post('/register', async (req, res) => {
  const started = Date.now();
  const { first_name, last_name, email, password } = req.body || {};

  if (!email || !password || !first_name || !last_name) {
    req.log.warn(meta(req, { reason: 'missing-fields' }), 'Register: missing fields');
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let client;
  try {
    client = await pool.connect();
    const exists = await client.query(
      'SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (exists.rowCount > 0) {
      req.log.warn(meta(req, { emailMasked: maskEmail(email), reason: 'email-exists' }), 'Register conflict');
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const ins = await client.query(
     `INSERT INTO users (first_name, last_name, email, password_hash)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email`,
     [first_name, last_name, email.toLowerCase(), passwordHash]
   );

   // Kick off email verification (best-effort)
   try {
     const raw   = crypto.randomBytes(32).toString('hex'); // 64 chars
     const hash  = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
     const until = new Date(Date.now() + VERIFY_WINDOW_MS);
     await client.query(
       `UPDATE users SET email_verify_token = $1, email_verify_expiry = $2 WHERE id = $3`,
       [hash, until, ins.rows[0].id]
     );
     const link = `${API_ORIGIN}/api/auth/verify-email/${raw}`;
    await sendVerifyEmail(ins.rows[0].email, link);
   } catch (e) {
     req.log?.warn(meta(req, { reason: e?.message }), 'verify email send failed (non-fatal)');
   }

    req.log.info(meta(req, { emailMasked: maskEmail(email), ms: Date.now() - started }), 'Register success');
    res.status(200).json({ message: 'Registration successful' });
  } catch (err) {
    req.log.error({ ...meta(req, { emailMasked: maskEmail(email) }), err }, 'Registration error');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client?.release?.();
  }
});

// === POST /logout  (CSRF-protected; idempotent)
router.post('/logout', (req, res) => {
  probeReq(req, 'logout_enter');
  const userId = req.session?.user?.id ?? null;

  const finish = () => {
    // Clear BOTH cookies with the SAME attributes used when setting them
    const clear = (name) =>
      res.clearCookie(name, { path: '/', httpOnly: name !== '__Host-csrf', secure: true, sameSite: 'none' });
    clear('__Host-glp1.sid');
    clear('glp1.sid');
    // CSRF cookie (readable) — use your configured SameSite (default None)
    res.clearCookie('__Host-csrf', { path: '/', secure: true, sameSite: (process.env.CSRF_SAMESITE || 'None') });

    res.set('Cache-Control', 'no-store');
    req.log?.info(meta(req, { userId }), 'Logout success');
    return res.status(200).json({ message: 'Logged out' });
  };

  if (!req.session) return finish();
  req.session.destroy((_err) => finish());
});

// === GET /me
router.get('/me', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const userId = req.session?.user?.id ?? null;
  req.log.info(meta(req, { userId }), '/auth/me');
  if (!req.session?.user) return res.status(200).json({});
  try {
    const hasPro = await fetchHasPro(pool, userId);
    req.session.user.has_pro = hasPro;
  } catch (_) {
    // if the check fails, don’t crash the endpoint
  }
  return res.status(200).json(req.session.user);
});

// === POST /reset-password-request
router.post('/reset-password-request', rlResetRequest, validate(ResetRequestSchema), async (req, res) => {
  const email = normalizeEmail(req.valid.email);
  if (!email) {
    req.log.warn(meta(req, { reason: 'missing-email' }), 'Reset request missing email');
    return res.status(400).json({ error: 'Email is required' });
  }

  let client;
  try {
    client = await pool.connect();

 // DB-backed throttle (per email+IP per hour bucket)
    const windowStart = new Date(Math.floor(Date.now() / 3600000) * 3600000); // hour start
    const { rows: rl } = await client.query(`
      INSERT INTO password_reset_rate (email, ip, window_start, count)
      VALUES ($1, $2::inet, $3, 1)
      ON CONFLICT (email, ip) DO UPDATE SET
        count = CASE          
            WHEN password_reset_rate.window_start = EXCLUDED.window_start
            THEN password_reset_rate.count + 1
          ELSE 1
        END,
        window_start = CASE
          WHEN password_reset_rate.window_start = EXCLUDED.window_start
            THEN password_reset_rate.window_start
          ELSE EXCLUDED.window_start
        END
      RETURNING count
    `, [email, req.ip, windowStart.toISOString()]);
    if (rl[0].count > 5) {
      req.log.warn(meta(req, { emailMasked: maskEmail(email), reason: 'reset-throttled' }), 'Reset request throttled');
      return res.status(429).json({ error: 'Too many requests' });
    }


   const q = await client.query('SELECT id FROM users WHERE email = $1', [email]);

    // Always 200 to avoid enumeration
    if (q.rowCount === 0) {
      req.log.info(meta(req, { emailMasked: maskEmail(email), reason: 'no-account' }), 'Reset request processed');
      return res.json({ success: true });
    }

    const userId = q.rows[0].id;
    const token = crypto.randomBytes(32).toString('hex'); // raw token (send to user)
    const tokenHash = hashToken(token);                   // store only the hash
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1h

    await client.query(
      `UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE id = $3`,
      [tokenHash, expiry, userId]
    );

    const resetLink = `https://app.ourglp1.com/reset-password/${token}`;
    try {
      await sendResetEmail(email, resetLink);
      req.log.info(meta(req, { userId, emailMasked: maskEmail(email) }), 'Reset email sent');
    } catch (e) {
      req.log.warn(
        meta(req, { userId, emailMasked: maskEmail(email), reason: e?.message }),
        'Reset email send failed (returning 200 to avoid enumeration)'
      );
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error({ ...meta(req, { emailMasked: maskEmail(email) }), err }, 'Reset request error');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client?.release?.();
  }
});

// === POST /reset-password
router.post('/reset-password', rlResetSubmit, validate(ResetPasswordSchema), async (req, res) => {
 const { token, password } = req.valid;

  let client;
  try {
    client = await pool.connect();
    const tokenHash = hashToken(token);
    // Backwards-compat: accept old plaintext tokens still in DB (if any)
    const q = await client.query(
      `SELECT id, reset_token, reset_token_expiry
         FROM users
        WHERE reset_token = $1 OR reset_token = $2`,
      [tokenHash, token]
    );
    if (q.rowCount === 0) return res.status(400).json({ error: 'Invalid or expired token' });

    const user = q.rows[0];
    if (Date.now() > new Date(user.reset_token_expiry).getTime()) {
      return res.status(400).json({ error: 'Reset token has expired' });
    }

    // Optional defense-in-depth: ensure the presented token matches stored hash
    // (covers the transition period if plaintexts exist)
    try {
      const stored = String(user.reset_token || '');
      const good = stored === tokenHash || stored === token;
      if (!good) return res.status(400).json({ error: 'Invalid or expired token' });
    } catch { /* no-op */ }


    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `UPDATE users
         SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL
       WHERE id = $2`,
      [passwordHash, user.id]
    );

    req.log.info(meta(req, { userId: user.id }), 'Password reset success');
    res.json({ success: true });
  } catch (err) {
   req.log.error({ ...meta(req), err }, 'Reset password error');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client?.release?.();
  }
});

// === GET /reset-password/:token (validate)
router.get('/reset-password/:token', validate(TokenParamSchema, 'params'), async (req, res) => {
  const token = req.validParams.token;
  let client;
  try {
    client = await pool.connect();
    const tokenHash = hashToken(token);
    const q = await client.query(
      `SELECT id, reset_token_expiry
         FROM users
        WHERE reset_token = $1 OR reset_token = $2`,
      [tokenHash, token]
    );

    if (q.rowCount === 0) return res.status(400).json({ error: 'Invalid or expired token' });

    const expiry = new Date(q.rows[0].reset_token_expiry);
    if (Date.now() > expiry.getTime()) {
      return res.status(400).json({ error: 'Reset token has expired' });
    }

    req.log.info(meta(req, { userId: q.rows[0].id }), 'Reset token valid');
   res.json({ success: true });
  } catch (err) {
    req.log.error({ ...meta(req), err }, 'Token validation error');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client?.release?.();
  }
});
// POST /api/auth/verify-email/request  (re-send or first send)
router.post('/verify-email/request', async (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  let client;
  try {
    client = await pool.connect();
    const { rows } = await client.query('SELECT email, email_verified_at FROM users WHERE id = $1', [userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const { email, email_verified_at } = rows[0];
    if (!email) return res.status(400).json({ error: 'No email on file' });
    if (email_verified_at) return res.status(200).json({ alreadyVerified: true });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
    const expiry = new Date(Date.now() + VERIFY_WINDOW_MS);

    await client.query(
      `UPDATE users
         SET email_verify_token = $1,
             email_verify_expiry = $2
       WHERE id = $3`,
      [tokenHash, expiry, userId]
    );

  const link = `${API_ORIGIN}/api/auth/verify-email/${token}`;
    await sendVerifyEmail(email, link);

    req.log.info(meta(req, { userId, emailMasked: maskEmail(email) }), 'Verify email sent');
    res.json({ success: true });
  } catch (err) {
    req.log.error(meta(req), err, 'Verify email request failed');
    res.status(500).json({ error: 'Server error' });
  } finally {
    client?.release?.();
  }
});

// GET /api/auth/verify-email/:token
router.get('/verify-email/:token', async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: 'Invalid token' });

  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');

  let client;
  try {
    client = await pool.connect();
    const { rows } = await client.query(
      `SELECT id, email_verify_expiry FROM users WHERE email_verify_token = $1`,
      [tokenHash]
    );
    if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired token' });

    const u = rows[0];
    if (!u.email_verify_expiry || Date.now() > new Date(u.email_verify_expiry).getTime()) {
      return res.status(400).json({ error: 'Token expired' });
    }

    await client.query(
      `UPDATE users
          SET email_verified_at = now(),
              email_verify_token = NULL,
              email_verify_expiry = NULL,
              updated_at = now()
        WHERE id = $1`,
      [u.id]
    );

    req.log.info(meta(req, { userId: u.id }), 'Email verified');
    // Redirect to an in-app "success" page (adjust path to your route)
    res.redirect(302, 'https://app.ourglp1.com/verify-email/success');
  } catch (err) {
    req.log.error(meta(req), err, 'Verify email token error');
    res.status(500).json({ error: 'Server error' });
  } finally {
    client?.release?.();
  }
});
// GET /api/auth/oauth/:provider/start
router.get('/oauth/:provider/start', (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  const rawReturnTo = req.query.returnTo ? String(req.query.returnTo) : '/information';
  const appUrl      = req.query.appUrl ? String(req.query.appUrl) : null;

  // Sanitize returnTo to an in-app path only
  const returnTo = rawReturnTo.startsWith('/') ? rawReturnTo : '/information';

const origin = req.get('Origin') || '';
  probeReq(req, 'handoff_consume_enter');
  if (!isTrustedOrigin(origin)) {
    req.log?.warn({ tag: 'origin_reject', origin }, 'Forbidden origin on oauth start');
    return res.status(403).json({ error: 'Forbidden' });
  }

  const state = crypto.randomBytes(16).toString('hex');

  // Build exact redirectUri and stash it
  const redirectUri = `${API_ORIGIN}/api/auth/oauth/${provider}/callback`;

// Allow either same-origin HTTPS or the *exact* deep-link back to the app.
  function isAllowedAppUrl(u) {
    if (typeof u !== 'string' || !u) return false;
    try {
      const url = new URL(u);
      // Accept our custom scheme
      if (url.protocol === 'ourglp1:') return u === APP_SCHEME;
      // Or same-origin HTTPS back into the SPA
      return u.startsWith(APP_BASE_URL);
    } catch {
      return false;
    }
  }
  const safeAppUrl = isAllowedAppUrl(appUrl) ? appUrl : null;

  req.session.oauth = { provider, state, returnTo, appUrl: safeAppUrl, redirectUri };
  req.log?.info({ tag:'oauth_start', provider, returnTo, appUrl: safeAppUrl, redirectUri }, 'OAuth start');


  if (provider === 'google') {
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + qstr({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'consent',
      access_type: 'offline',
    });
    return req.session.save(err => {
      if (err) return res.status(500).json({ error: 'Session error' });
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, url);
    });
  }

  if (provider === 'apple') {
    const url = 'https://appleid.apple.com/auth/authorize?' + qstr({
      client_id: APPLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'name email',
      state,
    });
    return req.session.save(err => {
      if (err) return res.status(500).json({ error: 'Session error' });
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, url);
    });
  }

  return res.status(400).json({ error: 'Unsupported provider' });
});

// === POST /api/auth/oauth (native idToken flow)
router.post('/oauth', async (req, res) => {
 // Origin/CT checks similar to /login
  const origin = req.get('Origin') || '';
  if (!isTrustedOrigin(origin)) {
    req.log?.warn({ tag: 'origin_reject', origin }, 'Forbidden origin on native /auth/oauth');
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!/application\/json/i.test(req.get('content-type') || '')) {
    return res.status(400).json({ error: 'Expected application/json' });
  }

  const provider = String(req.body?.provider || '').toLowerCase();
  const idToken  = String(req.body?.idToken || '');
  const authorizationCode = typeof req.body?.authorizationCode === 'string' ? req.body.authorizationCode : '';

 if (!provider || !['apple', 'google'].includes(provider)) {
    return res.status(400).json({ error: 'Bad request' });
  }

  try {
    let workingIdToken = idToken;

    // For native Apple, allow code -> token exchange if idToken is absent
    if (provider === 'apple' && !workingIdToken && authorizationCode) {
      const client_secret = await buildAppleClientSecret(); // you already use this in callback
      const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: qstr({
          client_id: APPLE_CLIENT_ID,    // set this to your iOS bundle id if you split web/native
          client_secret,
          code: authorizationCode,
          grant_type: 'authorization_code',
        }),
      });
      const token = await tokenRes.json();
      if (!tokenRes.ok || !token?.id_token) {
        req.log?.warn({ provider, err: token?.error || token }, 'Apple code exchange failed');
        return res.status(400).json({ error: 'Invalid token' });
      }
      workingIdToken = String(token.id_token);
    }

    if (!workingIdToken) {
      return res.status(400).json({ error: 'Missing idToken' });
    }

    // 1) Verify the ID token signature & claims
    const { sub, email, email_verified, given_name, family_name } =
      await verifyIdToken(provider, workingIdToken);

    if (!sub) return res.status(400).json({ error: 'Invalid token (no sub)' });

    // 2) Upsert/link user
    const user = await upsertUserFromProvider({
      provider, sub, email, email_verified, given_name, family_name,
    });
    if (!user) return res.status(500).json({ error: 'OAuth error' });

    // 3) Create session (same structure as your other flows)
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        req.log?.error({ provider }, regenErr, 'Session regen failed');
        return res.status(500).json({ error: 'Session error' });
      }

      req.session.user = {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        medication_name: user.medication_name,
        medication_dose: user.medication_dose,
        profile_photo: user.profile_photo,
        height: user.height,
        weight: user.weight,
        bmi: user.bmi,
        fasting_schedule: user.fasting_schedule,
        fasting_start: user.fasting_start,
        timezone: user.timezone || 'UTC',
        injection_day: user.injection_day || null,
        injection_time: toHHMM(user.injection_time) || null,
      };

      fetchHasPro(pool, user.id)
        .then((hp) => { req.session.user.has_pro = hp; })
        .catch(() => { req.session.user.has_pro = false; });

      req.session.createdAt = Date.now();
      req.session.lastAuthAt = Date.now();

      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'Session save failed' });
        res.set('Cache-Control', 'no-store');
        req.log?.info(meta(req, { userId: user.id, provider }), 'OAuth (idToken) login success');
        try { if (req.sessionID) setAliasCookie(res, signedSid(req.sessionID)); } catch {}
        // Include sid so native can persist cookie explicitly
        return res.status(200).json({ ok: true, sid: req.sessionID ? signedSid(req.sessionID) : undefined });
      });
    });
  } catch (e) {
    const msg = (e && (e.message || e.toString())) || 'verify error';
    req.log?.warn(meta(req, { provider, reason: msg }), 'ID token verification failed');
    return res.status(400).json({ error: 'Invalid token' });
  }
});


// --- OAuth callback core (supports GET=Google, POST=Apple) ---
async function oauthCallbackCore(req, res) {
  const provider = String(req.params.provider || '').toLowerCase();
  const stash = req.session?.oauth || {};

  // probe log
  req.log.info({
    tag: 'oauth_cb_enter',
    provider,
    method: req.method,
    ct: req.get('content-type'),
    hasQuery: !!Object.keys(req.query || {}).length,
    hasBody:  !!Object.keys(req.body  || {}).length,
    hasStash: !!stash.state,
  }, 'oauth callback enter');

  // GET for Google, POST for Apple
  const isPost = req.method === 'POST';
  const code  = isPost ? req.body?.code  : req.query?.code;
  const state = isPost ? req.body?.state : req.query?.state;

  // 🔒 robust API origin for redirectUri fallback
  const apiOriginSafe =
    (typeof API_ORIGIN !== 'undefined' && API_ORIGIN) ||
    originOf(process.env.API_BASE_URL || process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`);

  // Use stashed redirectUri if present, else fallback
  const redirectUri = stash.redirectUri || `${apiOriginSafe}/api/auth/oauth/${provider}/callback`;

  if (!code || !state || state !== stash.state || provider !== stash.provider) {
    req.log.warn({ tag:'oauth_state_fail', provider, gotCode:!!code, gotState:!!state, stashProvider: stash.provider, stashStatePresent: !!stash.state }, 'Invalid state');
    return res.status(400).send('Invalid state');
  }
// Drop the stash ASAP after validation (avoid lingering state if later steps fail)
 try { req.session.oauth = null; } catch (_) {}


  try {
    // ---------- 1) exchange + profile ----------
    let sub, email = null, given_name = null, family_name = null, email_verified = false;

    if (provider === 'google') {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: qstr({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code: String(code),
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const token = await tokenRes.json();
      if (!tokenRes.ok) {
        req.log?.warn({ provider, err: token.error || token }, 'Google token exchange failed');
        return res.status(400).send('Token exchange failed');
      }
      const uiRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const ui = await uiRes.json();
      sub = ui.sub;
      email = ui.email || null;
      given_name = ui.given_name || null;
      family_name = ui.family_name || null;
      email_verified = Boolean(ui.email_verified);
    } else if (provider === 'apple') {
      if (isPost && req.body?.user) {
        try {
          const uj = JSON.parse(req.body.user);
          if (uj?.name) {
            given_name = uj.name.firstName || null;
            family_name = uj.name.lastName || null;
          }
        } catch {}
      }
      const client_secret = await buildAppleClientSecret();
      const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: qstr({
          client_id: APPLE_CLIENT_ID,
          client_secret,
          code: String(code),
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });
      const token = await tokenRes.json();
      if (!tokenRes.ok) {
        req.log?.warn({ provider, err: token.error || token }, 'Apple token exchange failed');
        return res.status(400).send('Token exchange failed');
      }
      const parts = String(token.id_token || '').split('.');
      if (parts.length !== 3) return res.status(400).send('Bad id_token');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      sub = payload.sub;
      email = payload.email || null;
      email_verified =
        String(payload.email_verified).toLowerCase() === 'true' || payload.email_verified === true;
    } else {
      return res.status(400).send('Unsupported provider');
    }

    if (!sub) return res.status(400).send('Missing subject');

    // ---------- 2) upsert/link ----------
    let user;
    let client;
    try {
      client = await pool.connect();

      const sel = await client.query(
        `SELECT * FROM users WHERE auth_provider = $1 AND provider_sub = $2 LIMIT 1`,
        [provider, sub]
      );

      if (sel.rowCount > 0) {
        user = sel.rows[0];

        if (!user.email && email) {
          await client.query(
            `UPDATE users SET email = $1, updated_at = now() WHERE id = $2 AND email IS NULL`,
            [email.toLowerCase(), user.id]
          );
          user.email = email.toLowerCase();
        }
        if (email && email_verified && !user.email_verified_at) {
          await client.query(
            `UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1`,
            [user.id]
          );
          user.email_verified_at = new Date().toISOString();
        }
        if (provider === 'apple' && email && isAppleRelay(email) && user.apple_private_relay !== true) {
          await client.query(
            `UPDATE users SET apple_private_relay = true, updated_at = now() WHERE id = $1`,
            [user.id]
          );
          user.apple_private_relay = true;
        }
      } else {
        let linked = null;
        if (email) {
          const selByEmail = await client.query(
            `SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
            [email]
          );
          if (selByEmail.rowCount > 0) linked = selByEmail.rows[0];
        }

        if (linked) {
          const upd = await client.query(
            `UPDATE users
               SET auth_provider = $1,
                   provider_sub  = $2,
                   apple_private_relay = COALESCE($3, apple_private_relay),
                   email_verified_at   = CASE
                     WHEN $4::bool = true AND email_verified_at IS NULL THEN now()
                     ELSE email_verified_at
                   END,
                   updated_at = now()
             WHERE id = $5
             RETURNING *`,
            [provider, sub, (provider === 'apple' && email && isAppleRelay(email)) || null, email_verified, linked.id]
          );
          user = upd.rows[0];
        } else {
          const relay = provider === 'apple' && email && isAppleRelay(email);
          const ins = await client.query(
            `INSERT INTO users (
               auth_provider, provider_sub, email,
               first_name, last_name, apple_private_relay, is_active,
               email_verified_at
             )
             VALUES ($1,$2,$3,$4,$5,$6,true,$7)
             RETURNING *`,
            [
              provider,
              sub,
              email ? email.toLowerCase() : null,
              given_name,
              family_name,
              relay,
              email && email_verified ? new Date().toISOString() : null,
            ]
          );
          user = ins.rows[0];
        }
      }

      try { await client.query(`UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`, [user.id]); } catch {}
    } finally {
      client?.release?.();
    }

    // 🔒 guard: bail if somehow no user
    if (!user) {
      req.log.error({ tag:'oauth_no_user', provider }, 'SSO completed but no user record');
      return res.status(500).send('OAuth error');
    }

    // ---------- 3) session ----------
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        req.log?.error({ provider }, regenErr, 'Session regen failed');
        return res.status(500).send('Session error');
      }

      req.session.user = {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        medication_name: user.medication_name,
        medication_dose: user.medication_dose,
        profile_photo: user.profile_photo,
        height: user.height,
        weight: user.weight,
        bmi: user.bmi,
        fasting_schedule: user.fasting_schedule,
        fasting_start: user.fasting_start,
        timezone: user.timezone || 'UTC',
        injection_day: user.injection_day || null,
        injection_time: toHHMM(user.injection_time) || null,
      };

      // ✅ guard this too
      if (user.id) {
        fetchHasPro(pool, user.id)
          .then((hp) => { req.session.user.has_pro = hp; })
          .catch(() => { req.session.user.has_pro = false; });
      } else {
        req.session.user.has_pro = false;
      }

      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).send('Session save error');
         probeSetCookie(req, res, 'oauth_after_save', { provider });
         try { if (req.sessionID) setAliasCookie(res, signedSid(req.sessionID)); } catch {}

// Build redirect target. If we're deep-linking back into the native app,
        // attach a short-lived handoff token so the WKWebView can mint its own session.
        let target = stash.appUrl ? stash.appUrl : `${APP_BASE_URL}${stash.returnTo || '/information'}`;
        if (stash.appUrl && /^ourglp1:\/\//i.test(stash.appUrl)) {
          (async () => {
            try {
              const raw = await issueHandoffToken(user.id);
              const sep = stash.appUrl.includes('?') ? '&' : '?';
              target = `${stash.appUrl}${sep}t=${encodeURIComponent(raw)}`;
              req.log.info({ tag: 'oauth_handoff_issued', userId: user.id }, 'issued handoff token');
            } catch (e) {
              req.log.warn({ tag: 'oauth_handoff_issue_failed', err: e?.message }, 'handoff issue failed; continuing without token');
            } finally {
              req.log.info({ tag: 'oauth_cb_success', provider, target, userId: user.id }, 'redirecting after OAuth');
              res.set('Cache-Control', 'no-store');
              probeSetCookie(req, res, 'oauth_native_after_save', { provider });
              // Prefer explicit 303 + Location header for custom-scheme redirects from a POST.
              res.status(303);
              res.set('Location', target);
              req.log.info({ tag: 'oauth_native_redirect_sent', status: 303, location: target }, 'sent redirect to app');
              return res.end();
            }
          })();
          return; // response will be sent inside the IIFE
        }

       res.set('Cache-Control', 'no-store');
       return res.redirect(303, target);
      });
    });
  } catch (e) {
    req.log?.error({ err: e?.message, provider, stack: e?.stack }, 'OAuth callback error');
    return res.status(500).send('OAuth error');
  } finally {
     // best-effort cleanup (already nulled above)
    try { req.session.oauth = null; } catch (_) {}
  }
}

// Establish the session INSIDE the WKWebView using the one-time token from the deep link.
// GET /api/auth/oauth/handoff/consume?t=<64-hex>
router.get('/oauth/handoff/consume', async (req, res) => {
const origin = req.get('Origin') || '';
  probeReq(req, 'handoff_consume_enter');
  if (!isTrustedOrigin(origin)) {
    req.log?.warn({ tag: 'origin_reject', origin }, 'Forbidden origin on handoff/consume');
    return res.status(403).json({ error: 'Forbidden' });
  }

  const token = String(req.query.t || req.query.token || '');
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: 'Bad token' });

  try {
    const userId = await consumeHandoffToken(token);
    if (!userId) return res.status(400).json({ error: 'Invalid or expired token' });

    let client, user;
    try {
      client = await pool.connect();
      const q = await client.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
      if (q.rowCount === 0) return res.status(400).json({ error: 'User not found' });
      user = q.rows[0];
    } finally {
      client?.release?.();
    }

    req.session.regenerate((regenErr) => {
      if (regenErr) return res.status(500).json({ error: 'Session error' });

     req.session.user = {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        medication_name: user.medication_name,
        medication_dose: user.medication_dose,
        profile_photo: user.profile_photo,
        height: user.height,
        weight: user.weight,
        bmi: user.bmi,
        fasting_schedule: user.fasting_schedule,
        fasting_start: user.fasting_start,
        timezone: user.timezone || 'UTC',
        injection_day: user.injection_day || null,
        injection_time: toHHMM(user.injection_time) || null,
      };
      fetchHasPro(pool, user.id)
        .then((hp) => { req.session.user.has_pro = hp; })
        .catch(() => { req.session.user.has_pro = false; });

      req.session.createdAt = Date.now();
     req.session.lastAuthAt = Date.now();

      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'Session save failed' });
        res.set('Cache-Control', 'no-store');
        probeSetCookie(req, res, 'handoff_consume_after_save');
        try { if (req.sessionID) setAliasCookie(res, signedSid(req.sessionID)); } catch {}
        return res.json({ ok: true, sid: req.sessionID ? signedSid(req.sessionID) : undefined });
      });
    });
  } catch (e) {
    req.log?.error({ tag: 'oauth_handoff_consume_err', err: e?.message }, 'handoff consume failed');
    return res.status(500).json({ error: 'Server error' });
  }
});

// Mount both variants:
router.get('/oauth/:provider/callback', oauthCallbackCore); // Google
router.post('/oauth/:provider/callback', urlencodedParser, oauthCallbackCore); // Apple

router.all('/oauth/:provider/callback', urlencodedParser, (req, _res, next) => {
  req.log.info({
    tag: 'oauth_callback_probe',
    method: req.method,
    ct: req.get('content-type'),
    hasQuery: Object.keys(req.query || {}).length > 0,
    hasBody: Object.keys(req.body || {}).length > 0,
  }, 'callback hit');
  next();
});

module.exports = router;