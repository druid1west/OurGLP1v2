// src/telemetry/analytics.ts
import { App } from '@capacitor/app';
import { Device } from '@capacitor/device';
import { Capacitor } from '@capacitor/core';
import { FirebaseAnalytics } from '@capacitor-firebase/analytics';
import type { History } from 'history';
import { logger } from '@/utils/logger';

type ScreenName = string;

export type EventName =
  | 'screen_view'
  | 'login_success'
  | 'profile_saved'
  | 'push_token_registered'
  | 'reminder_created'
  | 'injection_marked_taken'
  | 'health_log_added'
  | 'fasting_schedule_saved'
  | 'biometric_login_success'
  | 'biometric_denied'
  | 'push_received'
  | 'push_opened'
  | 'push_tapped';

type CommonEvent = {
  name: EventName;
  ts: number; // ms epoch
  route?: string;
  screen?: ScreenName;
  user: { id_hashed?: string; id_short?: string };
  app: { version?: string; build?: string };
  device: { platform?: string; os?: string; model?: string };
};

export type EventProps = {
  BaseProps?: never;
  screen_view: { action?: string };
  login_success: { action?: string };
  profile_saved: { action?: string; fields?: string[] };
  push_token_registered: { action?: string; platform: string; token_hash12?: string };
  reminder_created: { action?: string; kind?: 'local' | 'push'; when_iso?: string };
  injection_marked_taken: { action?: string; scheduled_iso?: string; taken_iso?: string; delay_min?: number };
  health_log_added: { action?: string; type: 'weight' | 'bp' | 'mood' | 'note' | 'other' };
  fasting_schedule_saved: { action?: string; window: string };
  biometric_login_success: { action?: string; platform: string };
  biometric_denied: { action?: string; reason: 'user_cancel' | 'no_biometrics' | 'lockout' | 'system_cancel' | 'unknown' };

  push_received: {
    platform: 'ios' | 'android';
    topic?: string;
    token_hash12?: string;
    route?: string;
    notification_type?: string;
    foreground?: boolean;
    at?: string;
  };
  push_tapped: {
    platform: 'ios' | 'android';
    topic?: string;
    has_deeplink?: boolean;
    route?: string;
    notification_type?: string;
    at?: string;
  };
  push_opened: {
    platform: 'ios' | 'android';
    token_hash12?: string;
    route?: string;
    action?: string;
    at?: string;
  };
};

type Payload<N extends EventName> = CommonEvent & { props: EventProps[N] };

type Config = {
  /** Optional now. If omitted/empty, we queue locally and NO-OP on network sends. */
  endpoint?: string;
  history: History;
  getUserId: () => string | undefined;
  batchSize?: number;
  flushIntervalMs?: number;
};

let ctxApp: { version?: string; build?: string } = {};
let ctxDevice: { platform?: string; os?: string; model?: string } = {};
let _cfg: Config | undefined;
let _uidHashed = 'anon';
let _uidShort = 'anon';
let _queue: Array<Payload<EventName>> = [];
let _flushing = false;
let _timer: number | undefined;
let _flushHooksInstalled = false;

const log = logger.child('analytics');
const LS_KEY = 'analytics.queue.v1';

// Only these deliberately generic, non-health events are sent explicitly to
// Firebase/GA4. Firebase's native SDK separately collects its standard safe
// lifecycle and commerce events (for example first_open, session_start and
// in_app_purchase). Never add health, medication, route, notification-content,
// or biometric details here.
const FIREBASE_MARKETING_EVENTS = new Set<EventName>([
  'login_success',
  'profile_saved',
]);

async function sha256Hex(text: string): Promise<string> {
  try {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    // Minimal non-crypto fallback (FNV-1a 32-bit) – only for analytics pseudonymous IDs
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    log.debug('sha256Hex fallback used', { msg: String(err) });
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}

function loadQueue(): void {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Array<Payload<EventName>>;
      if (Array.isArray(parsed)) _queue = parsed;
    }
  } catch (err) {
    log.warn('loadQueue failed; starting fresh', { msg: String(err) });
  }
}
function saveQueue(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(_queue));
  } catch (err) {
    log.warn('saveQueue failed; queue not persisted', { msg: String(err) });
  }
}

function scheduleFlush(): void {
  if (!_cfg) return;
  if (!_cfg.endpoint) return; // no backend → don't schedule network flushes
  const interval = _cfg.flushIntervalMs ?? 10_000;
  if (_timer) return;
  _timer = window.setTimeout(() => {
    _timer = undefined;
    void flush();
  }, interval);
}

function redactString(s: string): string {
  return s
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, '[token]');
}
function sanitizeRoute(path?: string): string | undefined {
  if (!path) return path;
  const r = path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ':uuid')
    .replace(/\b[0-9a-f]{12,}\b/gi, ':hex')
    .replace(/\b\d{8,}\b/g, ':id');
  return redactString(r);
}

function sanitizeProps<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  const allowHashedKey = /(_hash(12)?|^id_(hashed|short)$)$/i;
  for (const [k, v] of Object.entries(input)) {
    if (!allowHashedKey.test(k) &&
        /(password|pass|secret|token|authorization|cookie|sid|session|contact|email|^x-)/i.test(k)) {
      continue;
    }
    if (typeof v === 'string') {
      const scrubbed = redactString(v);
      out[k] = scrubbed.length > 256 ? scrubbed.slice(0, 256) : scrubbed;
    } else if (typeof v === 'number' || typeof v === 'boolean' || v == null) {
      out[k] = v;
    } else {
      out[k] = JSON.parse(JSON.stringify(v ?? null));
    }
  }
  return out as T;
}

async function flush(): Promise<void> {
  if (!_cfg || _flushing || _queue.length === 0) return;
  if (!_cfg.endpoint) {
    // No backend → keep the capped local queue for debugging
    return;
  }
  _flushing = true;
  try {
    const batch = _queue.slice(0, _cfg.batchSize ?? 20);
    const payload = JSON.stringify({ events: batch });
    let ok = false;
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      const blob = new Blob([payload], { type: 'application/json' });
      ok = navigator.sendBeacon(_cfg.endpoint, blob);
    }
    if (!ok) {
      const res = await fetch(_cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: payload,
      });
      ok = res.ok;
    }
    if (ok) {
      _queue.splice(0, batch.length);
      saveQueue();
    }
  } catch (err) {
    // offline/server error → keep queue
    log.debug('flush failed; will retry', { msg: String(err) });
  } finally {
    _flushing = false;
    if (_queue.length > 0) scheduleFlush();
  }
}

export function installFlushOnUnload(): void {
  if (_flushHooksInstalled) return;
  _flushHooksInstalled = true;

  const onBeforeUnload = () => { void flush(); };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') void flush();
  };

  window.addEventListener('beforeunload', onBeforeUnload, { capture: true });
  document.addEventListener('visibilitychange', onHidden);

  try {
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) void flush();
    });
  } catch (err) {
    log.debug('App.addListener unavailable', { msg: String(err) });
  }
}

function base<N extends EventName>(name: N, route?: string): Omit<Payload<N>, 'props'> {
  const appCtx = (ctxApp && (ctxApp.version || ctxApp.build)) ? ctxApp : { version: 'web' };
  const devCtx = (ctxDevice && (ctxDevice.platform || ctxDevice.os || ctxDevice.model))
    ? ctxDevice
    : { platform: Capacitor.getPlatform() };

  return {
    name,
    ts: Date.now(),
    route: sanitizeRoute(route),
    user: { id_hashed: _uidHashed || 'anon', id_short: _uidShort || 'anon' },
    app: appCtx,
    device: devCtx,
  } as Omit<Payload<N>, 'props'>;
}

export async function initAnalytics(cfg: Config): Promise<void> {
  _cfg = cfg;
  loadQueue();
  installFlushOnUnload();

  // Identify ASAP so the first screen_view carries a hash.
  await setAnalyticsUser(cfg.getUserId?.());

  try {
    const [{ version, build }, di] = await Promise.all([App.getInfo(), Device.getInfo()]);
    ctxApp = { version, build: build ? String(build) : undefined };
    ctxDevice = { platform: di.platform, os: di.operatingSystem, model: di.model };
  } catch (err) {
    log.debug('App/Device info not available', { msg: String(err) });
  }

  // Router screen views
  cfg.history.listen((loc) => {
    trackScreenView(loc.pathname);
  });

  // First screen on boot
  trackScreenView(cfg.history.location.pathname);
}

export async function setAnalyticsUser(rawUserId?: string): Promise<void> {
  if (!rawUserId) {
    _uidHashed = 'anon';
    _uidShort = 'anon';
    if (Capacitor.isNativePlatform()) {
      void FirebaseAnalytics.setUserId({ userId: null }).catch((err: unknown) => {
        log.debug('Firebase setUserId clear failed', { msg: String(err) });
      });
    }
    return;
  }
  const h = await sha256Hex(rawUserId);
  _uidHashed = h;
  _uidShort = h.slice(0, 12);
  if (Capacitor.isNativePlatform()) {
    void FirebaseAnalytics.setUserId({ userId: _uidShort }).catch((err: unknown) => {
      log.debug('Firebase setUserId failed', { msg: String(err) });
    });
  }
}

export function trackScreenView(screenOrRoute: ScreenName, meta?: EventProps['screen_view']): void {
  enqueue('screen_view', meta ?? {}, sanitizeRoute(screenOrRoute));
}

export function trackEvent<N extends Exclude<EventName, 'screen_view'>>(
  name: N,
  props: EventProps[N],
  route?: string
): void {
  enqueue(name, props, route);
}

export function trackPushReceived(props: EventProps['push_received'], route?: string): void {
  enqueue('push_received', props, route);
}
export function trackPushOpened(props: EventProps['push_opened'], route?: string): void {
  enqueue('push_opened', props, route);
}
export function trackPushTapped(props: EventProps['push_tapped'], route?: string): void {
  enqueue('push_tapped', props, route);
}

function enqueue<N extends EventName>(name: N, props: EventProps[N], route?: string): void {
  const p = sanitizeProps(props as Record<string, unknown>) as EventProps[N];
  const safeRoute = sanitizeRoute(route);
  sendMarketingEventToFirebase(name);

  // The custom collector is a development-only diagnostic endpoint. Firebase
  // Analytics above remains enabled in production native builds.
  if (!_cfg?.endpoint) return;

  const ev = { ...(base(name, safeRoute)), screen: safeRoute, props: p } as Payload<N>;
  _queue.push(ev as Payload<EventName>);

  // Cap: keep last 500 events
  if (_queue.length > 500) _queue.splice(0, _queue.length - 500);

  saveQueue();

  if (_cfg?.endpoint && _queue.length >= (_cfg.batchSize ?? 20)) {
    void flush();
  } else {
    scheduleFlush();
  }
}

function sendMarketingEventToFirebase(name: EventName): void {
  if (!Capacitor.isNativePlatform() || !FIREBASE_MARKETING_EVENTS.has(name)) return;

  // Intentionally omit custom parameters. Even safe event names must not carry
  // health fields, screen routes, notification content, or other sensitive data.
  void FirebaseAnalytics.logEvent({ name }).catch((err: unknown) => {
    log.debug('Firebase logEvent failed', { name, msg: String(err) });
  });
}

/** convenience helper for push tokens */
export async function hash12(s: string): Promise<string> {
  const h = await sha256Hex(s);
  return h.slice(0, 12);
}
