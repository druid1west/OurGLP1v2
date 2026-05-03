type Level = 'debug' | 'info' | 'warn' | 'error';
export type LogMeta = unknown;

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Defaults: dev=debug, prod=warn (override with VITE_LOG_LEVEL=info|warn|error)
let currentLevel: Level =
  (import.meta.env.VITE_LOG_LEVEL as Level) ||
  (import.meta.env.DEV ? 'debug' : 'warn');

/**
 * Set the global log level at runtime.
 */
export const setLogLevel = (lvl: Level) => {
  currentLevel = lvl;
};

/**
 * Read the current global log level (useful for debugging / diagnostics).
 */
export const getLogLevel = (): Level => currentLevel;

const shouldLog = (lvl: Level) => LEVEL_ORDER[lvl] >= LEVEL_ORDER[currentLevel];

// ---------- PII scrub helpers ----------
const REDACT = '***REDACTED***';

const emailRx     = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const bearerRx    = /\bBearer\s+[A-Za-z0-9._~+/= -]+\b/gi;
const jwtRx       = /\b[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g; // naive JWT
const oauthCodeRx = /\b(id_token|access_token|refresh_token|code)=([^&\s]+)/gi;
const pushRx      = /\bAPA91[0-9A-Za-z_-]+|[a-f0-9]{64,}\b/gi;
const credLikeRx  = /\b(pass(word)?|pwd|secret|token|api[-_]?key)\b/i;
const longTokenRx = /\b[A-Za-z0-9_-]{24,}\b/g;

const maskEnd = (s: string, keep = 4) =>
  s.length <= keep ? '*'.repeat(s.length) : '*'.repeat(Math.max(0, s.length - keep)) + s.slice(-keep);

// FULL redaction keys (value replaced entirely)
const FULL_REDACT_KEYS =
  /(password|pass|pwd|secret|token|authorization|cookie|api[-_]?key|serverAuthCode|id[_-]?token|access[_-]?token|refresh[_-]?token|otp|mfa|verification(code)?)/i;

// PARTIAL masking keys (end-masked for readability)
const PARTIAL_MASK_KEYS = /(email|username|device[_-]?id)/i;

function scrubString(s: string, parentKey?: string): string {
  if (parentKey) {
    if (FULL_REDACT_KEYS.test(parentKey)) return REDACT;
    if (PARTIAL_MASK_KEYS.test(parentKey)) return maskEnd(s);
  }

  return s
    .replace(oauthCodeRx, (_, k) => `${k}=${REDACT}`)
    .replace(bearerRx, 'Bearer ' + REDACT)
    .replace(jwtRx, REDACT)
    .replace(pushRx, '[push_token]')
    .replace(longTokenRx, (m) => (credLikeRx.test(s) ? REDACT : m))
    .replace(emailRx, '[email]');
}

function sanitizeDeep(
  val: unknown,
  parentKey?: string,
  opts = { depth: 0, maxDepth: 5, seen: new WeakSet<object>(), maxArray: 50, maxString: 2000 }
): unknown {
  if (val == null) return val;

  if (typeof val === 'string') {
    const trimmed = val.length > opts.maxString ? val.slice(0, opts.maxString) + '…' : val;
    return scrubString(trimmed, parentKey);
  }
  if (typeof val !== 'object') return val;
  if (val instanceof Date) return val.toISOString();

  if (opts.seen.has(val as object)) return '[Circular]';
  opts.seen.add(val as object);
  if (opts.depth >= opts.maxDepth) return '[MaxDepth]';

  if (Array.isArray(val)) {
    const out = val.slice(0, opts.maxArray).map((v) =>
      sanitizeDeep(v, undefined, { ...opts, depth: opts.depth + 1 })
    );
    if (val.length > opts.maxArray) out.push(`[+${val.length - opts.maxArray} more]`);
    return out;
  }

  const obj = val as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (FULL_REDACT_KEYS.test(k)) {
      out[k] = typeof v === 'string' ? REDACT : '[REDACTED]';
      continue;
    }
    if (PARTIAL_MASK_KEYS.test(k) && typeof v === 'string') {
      out[k] = maskEnd(v);
      continue;
    }
    out[k] = sanitizeDeep(v, k, { ...opts, depth: opts.depth + 1 });
  }
  return out;
}

// Export the sanitizer so we can reuse in Sentry / Axios
export const logSanitize = (meta: LogMeta) => sanitizeDeep(meta);

// ---------- Core logger (warn/error only to satisfy ESLint) ----------
const emit = (lvl: Level, msg: string, meta?: LogMeta): void => {
  if (!shouldLog(lvl)) return;
  const text = `[${lvl.toUpperCase()}] ${scrubString(String(msg))}`;

  if (lvl === 'error') {
    if (meta !== undefined) {
    
      console.error(text, logSanitize(meta));
    } else {
    
      console.error(text);
    }
    return;
  }

  if (meta !== undefined) {
   
    console.warn(text, logSanitize(meta));
  } else {
    
    console.warn(text);
  }
};

export const logger = {
  debug: (m: string, meta?: LogMeta) => emit('debug', m, meta),
  info:  (m: string, meta?: LogMeta) => emit('info',  m, meta),
  warn:  (m: string, meta?: LogMeta) => emit('warn',  m, meta),
  error: (m: string, meta?: LogMeta) => emit('error', m, meta),

  child(prefix: string) {
    const tag = prefix ? `[${prefix}] ` : '';
    return {
      debug: (m: string, meta?: LogMeta) => emit('debug', tag + m, meta),
      info:  (m: string, meta?: LogMeta) => emit('info',  tag + m, meta),
      warn:  (m: string, meta?: LogMeta) => emit('warn',  tag + m, meta),
      error: (m: string, meta?: LogMeta) => emit('error', tag + m, meta),
    };
  },
};


