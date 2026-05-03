// server.js
require('./lib/load-env'); // ✅ Load .env ASAP
const { webcrypto } = require('crypto');
const cookieSignature = require('cookie-signature');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { URL } = require('url');

const express = require('express');
const app = express();
const { pool } = require('./models/db');
if (typeof pool?.query !== 'function') {
  console.error('FATAL: models/db did not export a pg Pool (no .query)');
  process.exit(1);
}

const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const pinoHttp = require('pino-http');
const crypto = require('crypto');
const logger = require('./logger');
const csurf = require('csurf');
const { parseUnsubToken } = require('./lib/unsubToken');

// --------- TEST/ENV SWITCHES --------------
const IS_TEST = process.env.NODE_ENV === 'test';
const AUTO_LOGIN_TEST = process.env.AUTO_LOGIN_TEST === '1';
const SKIP_CSRF = process.env.SKIP_CSRF === '1';

// Optional: compression
let compression = null;
try { compression = require('compression'); }
catch (e) { logger.warn({ err: e && e.message }, 'compression module not installed — skipping gzip'); }

// --- Config
const PORT = process.env.PORT || 3000;

// ---- Origins (keep in sync with routes/auth.js) ----
const originOf = (u) => {
  try { return new URL(u).origin; } catch { return String(u).replace(/\/+$/, ''); }
};
const RAW_API_BASE = (process.env.API_BASE_URL || process.env.PUBLIC_API_URL || 'https://app.ourglp1.com').replace(/\/+$/, '');
const API_ORIGIN   = originOf(RAW_API_BASE);
const APP_BASE_URL = (process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || 'https://app.ourglp1.com').replace(/\/+$/, '');
const APP_ORIGIN   = originOf(APP_BASE_URL);
const EXTRA_TRUSTED = String(process.env.EXTRA_TRUSTED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(originOf);

logger.info(
  { APP_BASE_URL, APP_ORIGIN, RAW_API_BASE, API_ORIGIN, EXTRA_TRUSTED },
  '🔧 Auth/CORS origins configured'
);

// Feature flags
const { USE_PUSH_QUEUE } = require('./config/flags');
console.log('[flags] USE_PUSH_QUEUE =', USE_PUSH_QUEUE);
if (USE_PUSH_QUEUE && !IS_TEST) {
  require('./jobs/dispatchPushQueue').start();
}

app.locals.pool = pool;

// --- Trust proxy (behind Nginx)
app.set('trust proxy', 1);
app.disable('x-powered-by');

// --- Masked env check
const present = (k) => (process.env[k] ? 'set' : 'missing');
const tightMask = (v) => (v ? v.replace(/.(?=.{4})/g, '*') : v);
logger.info(
  {
    MAIL_HOST: present('MAIL_HOST'),
    MAIL_USER: tightMask(process.env.MAIL_USER),
    MAIL_FROM: present('MAIL_FROM'),
  },
  'Env check'
);

// --- Pino HTTP
app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => {
        const url = req.originalUrl || req.url || '';
        return (
          url.startsWith('/api/analytics/collect') ||
          url.startsWith('/api/user/secure-photo/') ||
          url.startsWith('/api/auth/refresh') ||
          url.startsWith('/api/auth/login') ||
          url.startsWith('/api/auth/register') ||
          url.startsWith('/api/user/reminders/count')
        );
      },
    },
    serializers: {
      req(req) {
        const pathOnly = (req.originalUrl || req.url || '').split('?')[0];
        return { method: req.method, url: pathOnly, ip: req.ip };
      },
      res(res) { return { statusCode: res.statusCode }; },
      err: pinoHttp.stdSerializers.err,
    },
    customLogLevel: (req, res, err) => {
      if (err) return 'error';
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      if (req.url && req.url.startsWith('/api/health')) return 'debug';
      return 'info';
    },
    genReqId(req) {
      const fromHeader = req.headers['x-request-id'];
      if (fromHeader) return String(fromHeader).slice(0, 64);
      return crypto.randomBytes(8).toString('hex');
    },
    customProps(req) { return { requestId: req.id }; },
  })
);

// --- CORS (single source of truth)
const corsOptions = {
  origin: (origin, cb) => {
    // Never produce "*" when credentials are needed.
    if (!origin) return cb(null, APP_ORIGIN);
    const ALLOWED = new Set([
      APP_ORIGIN,
      API_ORIGIN,
      ...EXTRA_TRUSTED,
      'capacitor://localhost',
      'ionic://localhost',
      'http://localhost',
      'http://127.0.0.1',
      'https://appleid.apple.com',
      'https://accounts.google.com',
      'null',
    ]);
    return cb(null, ALLOWED.has(origin));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'X-Session-SID', 'x-session-sid',
    'X-CSRF-Token','x-csrf-token','csrf-token','x-xsrf-token',
    'sentry-trace','baggage',
    'X-Requested-With','Authorization','Accept','Origin',
  ],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 600,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// --- Compression
if (compression) app.use(compression());

// --- Header → cookie & alias bridges (MUST be before session)
// --- Bridge: accept SID via header or alias cookie, but KEEP IT SIGNED ---
app.use((req, _res, next) => {
  const originalCookie = req.headers.cookie || '';

  // 1) Header-based transport: X-Session-SID or Authorization: Session <sid>
  let sidFromHeader = req.get('X-Session-SID') || '';
  const auth = req.get('Authorization') || '';
  if (!sidFromHeader && auth.startsWith('Session ')) {
    sidFromHeader = auth.slice('Session '.length).trim();
  }

  // Keep signed ("s:...sig") as-is; only decode percent-encoding if present
  const normalize = (val) => (val ? decodeURIComponent(String(val)) : '');

  let cookieHeader = originalCookie;

  // If we got a header SID, inject it as the canonical cookie (still signed)
  if (sidFromHeader) {
    const signed = normalize(sidFromHeader); // e.g., "s:abc.abcdef..."
    if (signed.startsWith('s:')) {
      cookieHeader = (cookieHeader ? cookieHeader + '; ' : '') + `__Host-glp1.sid=${signed}`;
    }
  }

  // If only alias cookie exists, mirror into canonical (still signed)
  if (!cookieHeader.includes('__Host-glp1.sid=')) {
    const m = (cookieHeader || '').match(/(?:^|;\s*)glp1\.sid=([^;]+)/);
    if (m) {
      const signed = normalize(m[1]);
      if (signed.startsWith('s:')) {
        cookieHeader = (cookieHeader ? cookieHeader + '; ' : '') + `__Host-glp1.sid=${signed}`;
      }
    }
  }

  if (cookieHeader !== originalCookie) req.headers.cookie = cookieHeader;
  return next();
});

// Legacy alias shim (kept; cheap)
app.use((req, _res, next) => {
  const raw = req.headers.cookie || '';
  if (!raw || raw.includes('__Host-glp1.sid=')) return next();
  const m = raw.match(/(?:^|;\s*)glp1\.sid=([^;]+)/);
  if (!m) return next();
  const aliasVal = decodeURIComponent(m[1]);
  req.headers.cookie = (raw ? raw + '; ' : '') + `__Host-glp1.sid=${aliasVal}`;
  return next();
});

// --- Sessions (Postgres-backed)
app.use(
  session({
    name: '__Host-glp1.sid',
    secret: process.env.SESSION_SECRET || 'default',
    resave: false,
    saveUninitialized: false,
    store: new pgSession({ pool }),
    cookie: {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// --- Auto-login for tests
if (IS_TEST && AUTO_LOGIN_TEST) {
  app.use((req, _res, next) => {
    if (!req.session.user) {
      req.session.user = { id: '00000000-0000-0000-0000-000000000001', timezone: 'UTC' };
    }
    next();
  });
}

// --- Attach userId (hashed) to logger context
app.use((req, res, next) => {
  if (req.id) res.setHeader('X-Request-Id', req.id);
  const uid = req.session?.user?.id;
  if (uid && req.log) {
    const uid12 = crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 12);
    req.log = req.log.child({ uid: uid12 });
  }
  next();
});

// --- Helmet
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(cookieParser());
app.use(express.json({ limit: '512kb' }));

// --- Public analytics endpoint (no CSRF)
app.use('/api/analytics/collect', express.json(), (_req, res) => res.sendStatus(204));

// --- CSRF (double-submit cookie)
const CSRF_SAMESITE = process.env.CSRF_SAMESITE || 'None';
const csrfProtection = csurf({
  cookie: {
    key: '__Host-csrf',
    httpOnly: false,
    secure: true,
    sameSite: CSRF_SAMESITE,
    path: '/',
  },
  ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
});
const csrfUnless = (skipPaths = []) => (req, res, next) => {
  const path = req.path || '';
  for (const sp of skipPaths) {
    if (typeof sp === 'string' && path.startsWith(sp)) return next();
    if (sp instanceof RegExp && sp.test(path)) return next();
  }
  return csrfProtection(req, res, next);
};

// Mint endpoint
app.get('/api/auth/csrf', csrfProtection, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ token: req.csrfToken() });
});
app.get('/api/csrf', csrfProtection, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ token: req.csrfToken() });
});

// Apply CSRF to /api/* non-GETs with targeted skips
if (!(IS_TEST && SKIP_CSRF)) {
  const NATIVE_ORIGINS = new Set(['capacitor://localhost', 'ionic://localhost', 'null']);
  const isNativeOrigin = (req) => NATIVE_ORIGINS.has(req.get('Origin') || '');
  const isAuthPath = (p) =>
    p === '/auth/login' ||
    p === '/auth/register' ||
    p === '/auth/logout' ||
    p === '/auth/verify-email/request';

  app.use('/api', (req, res, next) => {
    const path = req.path || '';

    // Public paths (no CSRF)
    if (
      path.startsWith('/push/token-public') ||
      path.startsWith('/push/claim-token') ||
      path.startsWith('/auth/reset-password-request') ||
      path.startsWith('/auth/reset-password') ||
      path.startsWith('/auth/oauth') ||
      path.startsWith('/metrics/offline')
    ) {
      return next();
    }

    // Native shells get a CSRF pass only on core auth POSTs
    if (isNativeOrigin(req) && isAuthPath(path)) {
      return next();
    }

    return csrfProtection(req, res, next);
  });
}

app.use('/api/pay', require('./routes/pay'));

// --- Rate limit auth endpoints
const authLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RL_WINDOW_MS ?? 15 * 60 * 1000),
  max: Number(process.env.AUTH_RL_MAX ?? 100),
  standardHeaders: true,
  legacyHeaders: false,
});
app.post('/api/auth/login', authLimiter);
app.post('/api/auth/register', authLimiter);
app.post('/api/auth/reset-password-request', authLimiter);
app.post('/api/auth/reset-password', authLimiter);

// --- Health: liveness + readiness
app.get('/healthz', async (req, res) => {
  const startedAt = process.env.APP_STARTED_AT || new Date().toISOString();
  const info = {
    status: 'ok',
    service: 'glp1-backend',
    node_env: process.env.NODE_ENV,
    uptime_s: Math.floor(process.uptime()),
    started_at: startedAt,
    version: process.env.COMMIT_SHA || process.env.APP_VERSION || null,
  };

  let dbOk = false;
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('DB timeout')), 1500));
    const ping = pool.query('SELECT 1');
    await Promise.race([ping, timeout]);
    dbOk = true;
  } catch (e) {
    info.status = 'degraded';
    info.db_error = e.message;
  }

  const httpCode = dbOk ? 200 : 503;
  res.set('Cache-Control', 'no-store');
  return res.status(httpCode).json(info);
});

// --- Auth guard
function requireLogin(req, res, next) {
  if (!req.session?.user) {
    req.log?.warn('❌ [Auth] No session user — rejecting');
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.user = req.session.user;
  next();
}

// --- Routes (modular)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/health', require('./routes/health'));
app.use('/api/push', require('./routes/pushRoutes'));
app.use('/api/weekly-summary', require('./routes/weeklySummary'));
app.use('/api/analytics', require('./routes/analytics'));

// --- Block .env
app.get('/.env', (req, res) => {
  req.log?.warn({ ip: req.ip }, '🚫 Blocked attempt to access .env');
  res.status(403).send('Forbidden');
});

// --- Unsubscribe email reminders
app.get('/api/reminders/unsubscribe', async (req, res) => {
  const t = String(req.query.t || '');
  const parsed = parseUnsubToken(t);

  if (parsed) {
    const { userId, reminderId } = parsed;
    try {
      await pool.query(
        `UPDATE reminders
            SET method = array_remove(method, 'email'),
                updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [reminderId, userId]
      );
      await pool.query(
        `UPDATE reminders
            SET enabled = false
          WHERE id = $1 AND user_id = $2
            AND (method IS NULL OR array_length(method,1) = 0)`,
        [reminderId, userId]
      );
    } catch (e) {
      req.log?.warn({ err: e?.message }, 'per-reminder unsubscribe failed');
    }
  } else {
    req.log?.info('unsubscribe token invalid/expired');
  }

  res.set('Cache-Control', 'no-store');
  res.send('<h2>You have unsubscribed from emails for this reminder.</h2><p>You can turn email back on any time when editing that reminder or creating a new one.</p>');
});

app.get('/api/reminders/unsubscribe/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    await pool.query(
      `UPDATE reminders
          SET method = array_remove(method, 'email'),
              updated_at = now()
        WHERE user_id = $1
          AND array_position(method, 'email') IS NOT NULL`,
      [userId]
    );
    res.send('<h2>Email turned off for your existing reminders.</h2><p>New reminders with email checked will still send.</p>');
  } catch {
    res.status(500).send('<h2>Something went wrong.</h2>');
  }
});

// --- Root health
app.get('/', (_req, res) => {
  res.send('✅ GLP-1 Backend API is running');
});

// --- CSRF error handler (after mounts)
app.use((err, req, res, next) => {
  if (err?.code === 'EBADCSRFTOKEN') {
    req.log?.warn({ reason: 'bad_token', haveCookie: Boolean(req.cookies?.['__Host-csrf']) }, 'CSRF rejected');
    return res.status(403).json({ error: 'csrf' });
  }
  next(err);
});

// --- Global error handler
app.use((err, req, res, _next) => {
  req.log?.error({ err }, '❌ Unhandled Error');
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// --- Start only outside tests
if (!IS_TEST) {
  app.listen(PORT, () => logger.info(`✅ API running on port ${PORT}`));
}

app.get('/verify-email', async (req, res) => {
  const token = String(req.query.token || '').trim();
  const { pool } = require('./models/db');
  if (!token) return res.redirect('/settings?verified=0');

  try {
    const { rows } = await pool.query(
      `SELECT id FROM users
        WHERE email_verify_token=$1
          AND (email_verify_expiry IS NULL OR email_verify_expiry > now())`,
      [token]
    );
    const u = rows[0];
    if (!u) return res.redirect('/settings?verified=0');

    await pool.query(
      `UPDATE users
          SET email_verified_at = now(),
              email_verify_token = NULL,
              email_verify_expiry = NULL
        WHERE id=$1`,
      [u.id]
    );

    return res.redirect('/settings?verified=1');
  } catch {
    return res.redirect('/settings?verified=0');
  }
});

module.exports = app;

