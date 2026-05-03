// src/telemetry/sentry.ts
/// <reference types="vite/client" />


import * as SentryCap from '@sentry/capacitor';
import * as SentryReact from '@sentry/react';
import { App } from '@capacitor/app';
import { Device, type DeviceInfo } from '@capacitor/device';
import type { History, Location } from 'history';
import type { Event as SentryEvent, Breadcrumb } from '@sentry/core';
import type { ErrorEvent as ReactErrorEvent, EventHint as ReactEventHint } from '@sentry/react';
import { logger } from '@/utils/logger';

/**
 * Runtime config typing from your project:
 * type AppConfig = {
 *   SENTRY_DSN?: string | null;
 *   SENTRY_ENV?: string;
 *   SENTRY_RELEASE?: string;
 *   SENTRY_DIST?: string;
 *   SENTRY_ENABLE_REPLAYS?: '1' | boolean;
 *   SENTRY_DEBUG?: '1' | boolean;
 * };
 * (Declared globally in src/types/app-config.d.ts)
 */
type RuntimeConfig = AppConfig & {
  SENTRY_ENABLE_REPLAYS?: boolean | '1' | '0';
  SENTRY_DEBUG?: boolean | '1' | '0';
};

type Extras = Record<string, unknown>;
type Ctx = Record<string, unknown>;

let _sentryReady = false;
export const isSentryReady = (): boolean => _sentryReady;

/* ------------------------------ small utils ------------------------------- */
function toBoolFlag(v: boolean | '1' | '0' | undefined): boolean {
  return v === true || v === '1';
}

async function sha256(text: string): Promise<string> {
  // Guard: some WebViews don’t have crypto.subtle
  const g = globalThis as unknown as { crypto?: Crypto };
  const subtle = g?.crypto?.subtle;
  if (!subtle) {
    // Lightweight djb2 fallback so we still get a stable pseudohash
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
    // produce 8 bytes hex
    const out = new Uint8Array(8);
    for (let i = 0; i < out.length; i++) out[i] = (h >> ((i % 4) * 8)) & 0xff;
    return Array.from(out).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const enc = new TextEncoder().encode(text);
  const buf = await subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
async function hashUserId8(uid: string): Promise<string> {
  const h = await sha256(uid);
  return `u_${h.slice(0, 8)}`;
}

// React-shaped wrapper that delegates to our generic scrubber
function beforeSendReact(event: ReactErrorEvent): ReactErrorEvent | null {
  return scrubEvent(event as unknown as SentryEvent) as unknown as ReactErrorEvent;
}

// Widen to the exact intersection type @sentry/capacitor expects
const beforeSendCompat =
  beforeSendReact as unknown as ((
    event: ReactErrorEvent,
    hint: ReactEventHint
  ) => ReactErrorEvent | PromiseLike<ReactErrorEvent | null> | null) &
    ((e: unknown, hint?: unknown) => unknown);

function toContext(obj: unknown): Ctx {
  return { ...(obj as Record<string, unknown>) };
}

async function flushIfAvailable(timeoutMs = 2000): Promise<void> {
  const maybe = (SentryCap as unknown as { flush?: (t?: number) => Promise<void> }).flush;
  if (typeof maybe === 'function') {
    try {
      await maybe(timeoutMs);
    } catch (err) {
      // Best-effort flush; log as debug only.
      logger.debug('[sentry] flush failed', { err });
    }
  }
}

/* -------------------------- PII scrubbing helpers ------------------------- */

const emailRx = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const bearerRx = /\bBearer\s+\S+\b/gi;
const pushRx = /\bAPA91|[a-f0-9]{64,}\b/i;
const redactKey = (k: string): boolean =>
  /(password|pass|secret|token|authorization|email)/i.test(k);

const cleanString = (s: string): string =>
  s.replace(emailRx, '[email]').replace(bearerRx, '[token]').replace(pushRx, '[push_token]');

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function sanitizeRecord<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactKey(k) ? '[redacted]' : typeof v === 'string' ? cleanString(v) : v;
  }
  return out as T;
}

function sanitizeHeaders(h: unknown): Record<string, string> | undefined {
  if (!isRecord(h)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    const key = k.toLowerCase();
    const val = typeof v === 'string' ? v : String(v);
    out[k] =
      key === 'authorization' || key === 'cookie' || key === 'set-cookie' ? '[redacted]' : val;
  }
  return out;
}

function scrubCrumb(crumb: Breadcrumb): Breadcrumb {
  const bb: Breadcrumb = { ...crumb };
  if (typeof bb.message === 'string') bb.message = cleanString(bb.message);
  if (isRecord(bb.data)) bb.data = sanitizeRecord(bb.data);
  return bb;
}

// Drop console + ultra-noisy endpoints
function beforeBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === 'console') return null;

  const cat = crumb.category ?? '';
  if (cat.startsWith('ui.')) return null; // ui.click / ui.input / etc.

  if ((cat === 'xhr' || cat === 'fetch') && isRecord(crumb.data)) {
    const url = String((crumb.data as Record<string, unknown>).url ?? '');
    if (/\/api\/user\/reminders(?:\/count)?$/.test(url)) return null;
    if (/\/api\/push\/status$/.test(url)) return null;
  }

  return scrubCrumb(crumb);
}

/** SDK-version-agnostic scrubber */
function scrubEvent<T extends SentryEvent>(event: T): T {
  // request
  if (event.request) {
    const sanitized = sanitizeHeaders((event.request as { headers?: unknown }).headers);
    if (sanitized) (event.request as { headers?: Record<string, string> }).headers = sanitized;

    if (typeof event.request.url === 'string') {
      try {
        const u = new URL(event.request.url);
        for (const [k, val] of [...u.searchParams.entries()]) {
          if (redactKey(k) || bearerRx.test(val) || emailRx.test(val) || pushRx.test(val)) {
            u.searchParams.set(k, '[redacted]');
          }
        }
        event.request.url = u.toString();
      } catch (e) {
        // Ignore malformed URL; nothing else to scrub there.
        logger.debug('[sentry] skip URL scrub (malformed)', { e });
      }
    }
  }

  // extra/context
  if (isRecord(event.extra)) event.extra = sanitizeRecord(event.extra);
  if (isRecord(event.contexts)) {
    const ctxs = event.contexts as Record<string, unknown>;
    for (const [k, v] of Object.entries(ctxs)) {
      if (isRecord(v)) ctxs[k] = sanitizeRecord(v);
    }
  }

  // user → keep only hashed id (already hashed upstream via setUser)
  if (event.user && typeof event.user === 'object') {
    const id = typeof event.user.id === 'string' ? event.user.id : undefined;
    event.user = id ? { id } : undefined;
  }

  // breadcrumbs
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((b) => scrubCrumb(b));
  }

  return event;
}

/* ------------------------------ Initialization ---------------------------- */

export async function initSentry({
  dsn,
  environment,
  history,
  getUserId,
}: {
  dsn?: string;
  environment?: string;
  history: History;
  getUserId: () => string | undefined;
}): Promise<void> {
  if (_sentryReady) return;

  // Resolve strictly from runtime config (config.js written by build scripts)
  const runtime: RuntimeConfig =
    (typeof window !== 'undefined' ? window.__APP_CONFIG__ : undefined) ?? {};

  const effectiveDsn = (dsn ?? runtime.SENTRY_DSN ?? '') || '';
  const effectiveEnv = (environment ?? runtime.SENTRY_ENV ?? 'production') || 'production';

  if (effectiveDsn.length === 0) {
    logger.warn('[sentry] No DSN provided (runtime only). Skipping Sentry init.');
    return;
  }

  const [{ version, build }, deviceInfo] = await Promise.all([
    App.getInfo(),
    Device.getInfo() as Promise<DeviceInfo>,
  ]);

  const releaseFromEnv = runtime.SENTRY_RELEASE ?? `ourglp1@${version}+${build}`;
  const distFromEnv = runtime.SENTRY_DIST ?? (build ? String(build) : undefined);

  const enableReplay = toBoolFlag(runtime.SENTRY_ENABLE_REPLAYS);
  const debugLogs = toBoolFlag(runtime.SENTRY_DEBUG);

  logger.debug('[sentry] DSN prefix', { prefix: `${effectiveDsn.slice(0, 12)}…` });
  logger.info('[sentry] ENV', { env: effectiveEnv });
  logger.info('[sentry] Replays enabled', { enableReplay });

  SentryCap.init(
  {
    dsn: effectiveDsn,
    environment: effectiveEnv,
    debug: debugLogs,
    sendDefaultPii: false,

    beforeSend: beforeSendCompat,
    beforeBreadcrumb,

    integrations: [
      SentryReact.reactRouterV5BrowserTracingIntegration({ history }),
      ...(enableReplay
        ? [SentryReact.replayIntegration({ maskAllText: true, blockAllMedia: true })]
        : []),
    ],

   // Keep tracing modest; only propagate inside the WebView
    tracesSampleRate: 0.1,
    tracePropagationTargets: ['capacitor://localhost'],

    replaysSessionSampleRate: enableReplay ? 0.05 : 0,
    replaysOnErrorSampleRate: enableReplay ? 1.0 : 0,

    maxBreadcrumbs: 50,
    normalizeDepth: 4,

    release: releaseFromEnv,
    dist: distFromEnv,
  },
  SentryReact.init
);

  // Tags & contexts
  SentryCap.setTags({
    platform: deviceInfo.platform ?? 'web',
    os: deviceInfo.operatingSystem ?? 'unknown',
  });
  SentryCap.setContext('device', toContext(deviceInfo));
  SentryCap.setContext('app', toContext({ version, build }));

  // Initial + subsequent route breadcrumbs
  let lastRoute = '';
  try {
    const initialPath: string = (history?.location as Location | undefined)?.pathname ?? '';
    lastRoute = initialPath;
    if (lastRoute) {
      SentryCap.setTag('route', lastRoute);
      SentryCap.addBreadcrumb({
        category: 'navigation',
        message: `route:${lastRoute}`,
        level: 'info',
      });
    }
  } catch (e) {
    logger.debug('[sentry] initial route set failed', { e });
  }

  history.listen((loc) => {
    const next = (loc as Location | undefined)?.pathname ?? '';
    if (!next || next === lastRoute) return;
    lastRoute = next;
    SentryCap.setTag('route', next);
    SentryCap.addBreadcrumb({ category: 'navigation', message: `route:${next}`, level: 'info' });
  });

  // Attach hashed user id (if available)
  const uid = getUserId();
  if (uid) {
    SentryCap.setUser({ id: await hashUserId8(uid) });
  }

  _sentryReady = true;

  logger.info('[sentry] initialized ✓');

  // Optional connectivity signal (safe to remove later)
  SentryCap.captureMessage(`Sentry connectivity check (${effectiveEnv})`);
}

/* --------------------------- public helper API ---------------------------- */

export async function sentrySetUser(userId?: string): Promise<void> {
  if (!userId) {
    SentryCap.setUser(null);
    return;
  }
  SentryCap.setUser({ id: await hashUserId8(userId) });
}

export function logAnalyticsEvent(name: string, props?: Record<string, unknown>): void {
  SentryCap.addBreadcrumb({
    category: 'analytics',
    message: name,
    data: props ? toContext(props) : undefined,
    level: 'info',
  });
}

export function pushRegistered(tokenHash12?: string, platform?: string): void {
  SentryCap.addBreadcrumb({
    category: 'push',
    message: 'push_registered',
    data: tokenHash12 ? { tokenHash12, platform } : platform ? { platform } : undefined,
    level: 'info',
  });
}
export function pushReceived(meta?: { title?: string; body?: string; channel?: string }): void {
  SentryCap.addBreadcrumb({
    category: 'push',
    message: 'push_received',
    data: meta ? toContext(meta) : undefined,
    level: 'info',
  });
}
export function pushOpened(meta?: { deeplink?: string; fromTray?: boolean }): void {
  SentryCap.addBreadcrumb({
    category: 'push',
    message: 'push_opened',
    data: meta ? toContext(meta) : undefined,
    level: 'info',
  });
}

export function sentryCrashTest(reason = 'scrub test'): void {
  logAnalyticsEvent('crash_test_triggered');
  setTimeout(() => {
    // Throwing here will be captured by Sentry boundary if present
    throw new Error(reason);
  }, 0);
}

export function sentryHandledTest(reason = 'scrub test'): void {
  logAnalyticsEvent('crash_test_handled');
  SentryCap.captureException(new Error(`${reason} ${Date.now()}`), {
    tags: { test: 'true', purpose: 'signal-pipeline' },
    fingerprint: ['scrub-test', 'handled', 'v1'],
    level: 'error',
  });
}

export function attachSentryDevHelpers(): void {
  // @ts-expect-error dev helpers
  window.sentryHandledTest = (): void => sentryHandledTest();
  // @ts-expect-error dev helpers
  window.sentryUnhandledTest = (): void => sentryCrashTest('UNHANDLED scrub test');

  logger.info('[sentry] Dev helpers attached', {
    hint: 'call window.sentryHandledTest() or window.sentryUnhandledTest()',
  });
}

export function captureError(err: unknown, extras?: Extras): string | undefined {
  const id = SentryCap.captureException(err, extras ? { extra: extras } : undefined);
  logger.info('[sentry] captureError', { id: typeof id === 'string' ? id : String(id) });
  void flushIfAvailable(2000);
  return typeof id === 'string' ? id : undefined;
}

export function captureMessage(msg: string, extras?: Extras): string | undefined {
  const id = SentryCap.captureMessage(msg, extras ? { extra: extras } : undefined);
  logger.info('[sentry] captureMessage', { id: typeof id === 'string' ? id : String(id) });
  void flushIfAvailable(2000);
  return typeof id === 'string' ? id : undefined;
}

export const SentryErrorBoundary = SentryReact.ErrorBoundary;
// Back-compat alias for callers expecting captureException
export const captureException = captureError;






