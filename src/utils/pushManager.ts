// src/utils/pushManager.ts
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Device } from '@capacitor/device';
import { PushNotifications } from '@capacitor/push-notifications';
import { App } from '@capacitor/app';

import { hash12 } from '../telemetry/analytics';
import { logger } from '../utils/logger';

// ✅ Single source of truth (the only place allowed to prompt)
export { reinitPushPermissions } from '../utils/reinitPushPermissions';

// ---- Config (local-only) ----------------------------------------------------

const PREFS = {
  apnToken: 'apn_token',
  pushPrompted: 'push_perm_prompted', // kept for compatibility, but we no longer auto-prompt on boot
  pushPerm: 'push_perm', // 'granted' | 'denied'
} as const;

// ---- Caches / guards --------------------------------------------------------

let cachedDeviceId: string | null = null;
let lastSentPushToken: string | null = null; // dedupe identical tokens
let listenersReady = false; // ensure one-time wiring
let iosFallbackRan = false;

// guard for double-claim (kept for API parity; no-op in local)
let claimInFlight = false;

// ---- Types ------------------------------------------------------------------

interface NativeStorage {
  getItem?: (key: string) => Promise<string | null>;
  getAllItems?: () => Promise<Record<string, string | number | boolean | null>>;
}

interface DebugWindow {
  Preferences: typeof Preferences;
  PushNotifications: typeof PushNotifications;
}

declare global {
  interface Window {
    NativeStorage?: NativeStorage;
    __debug?: DebugWindow;
    forceClaim?: typeof claimTokenForUser;
  }
}

// ---- Utils ------------------------------------------------------------------

function getNormalizedPlatform(): 'ios' | 'android' | 'web' {
  const raw = Capacitor.getPlatform();
  if (raw === 'android') return 'android';
  if (raw === 'web') return 'web';
  return 'ios';
}

// ---- Public API -------------------------------------------------------------

/**
 * Wire up native → web token flow and register for pushes.
 * Local mode: we still register with APNs/FCM and keep the token in Preferences/LS for future backend use,
 * but we do NOT send it to any server here.
 *
 * IMPORTANT:
 * - We DO NOT auto-prompt for notification permission during app boot.
 * - We only register automatically if permission is already granted.
 * - Prompting must be triggered by an explicit user action/screen (AllowNotification.tsx → reinitPushPermissions()).
 */
export function setupPushTokenListener(): void {
  if (listenersReady) {
    logger.info('[push] setupPushTokenListener already initialized — skipping');
    return;
  }
  listenersReady = true;

  if (typeof window !== 'undefined') {
    window.__debug = { Preferences, PushNotifications };
  }

  const handleNewToken = async (pushToken: string | undefined | null) => {
    if (!pushToken || pushToken.length === 0) {
      logger.warn('[push] handleNewToken: no token provided');
      return;
    }
    if (pushToken === lastSentPushToken) {
      logger.info('[push] handleNewToken: duplicate token, skipping');
      return;
    }

    lastSentPushToken = pushToken;
    const pushHash12 = await hash12(pushToken);
    logger.info('[push] new token captured', { token_hash12: pushHash12 });

    await storeToken(pushToken);
    const deviceId = await getDeviceId();

    logger.info('[push] token stored (local-only)', { token_hash12: pushHash12, deviceId });
  };

  // Native (custom) events from AppDelegate / bridge
  window.addEventListener('capacitorDidRegisterForRemoteNotifications', async (event: Event) => {
    const custom = event as CustomEvent<string> & { object?: string };
    const pushToken = custom.detail || custom.object;
    logger.info('[push] capacitorDidRegisterForRemoteNotifications', {
      token_hash12: pushToken ? await hash12(pushToken) : 'none',
    });
    await handleNewToken(pushToken);
  });

  window.addEventListener('pushTokenUpdated', async (e: Event) => {
    const pushToken = (e as CustomEvent<string>).detail;
    logger.info('[push] pushTokenUpdated', { token_hash12: pushToken ? await hash12(pushToken) : 'none' });
    await handleNewToken(pushToken);
  });

  // Capacitor plugin’s registration event
  PushNotifications.addListener('registration', async (t) => {
    logger.info('[push] registration event', { token_hash12: await hash12(t.value) });
    await handleNewToken(t.value);
  });

  // Fallback: read what native saved to Preferences and re-dispatch to JS
  setTimeout(() => {
    void (async () => {
      if (getNormalizedPlatform() !== 'android') return; // iOS fires native events reliably
      const { value: pushToken } = await Preferences.get({ key: PREFS.apnToken });
      if (pushToken && pushToken !== lastSentPushToken) {
        logger.warn('[push] redispatching apn_token fallback', { token_hash12: await hash12(pushToken) });
        window.dispatchEvent(new CustomEvent('pushTokenUpdated', { detail: pushToken }));
      }
    })();
  }, 3000);

  // Optional iOS-native storage pull (older bridges)
  PullNativeFallback();

  // IMPORTANT: never prompt during boot. Only register if already granted.
  setTimeout(() => {
    void ensureRegisteredIfGranted();
  }, 1200);
}

/** Returns the cached/saved push token if present. */
export async function getStoredToken(): Promise<string | null> {
  const p = getNormalizedPlatform();
  if (p === 'android') {
    const { value } = await Preferences.get({ key: PREFS.apnToken });
    return value ?? null;
  }
  if (lastSentPushToken) return lastSentPushToken;
  try {
    return localStorage.getItem('__debug_apn_token');
  } catch {
    return null;
  }
}

/** Returns a stable device identifier from Capacitor. */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const info = await Device.getId();
  cachedDeviceId = info.identifier;
  return cachedDeviceId;
}

// Re-try after returning from Settings (safe; does NOT prompt)
App.addListener('resume', () => {
  void ensureRegisteredIfGranted();
});

/**
 * Local-only: no-op claim (kept for API compatibility with old callers).
 * When you add a backend later, implement posting token+deviceId here.
 */
export async function claimTokenForUser(): Promise<void> {
  if (claimInFlight) return;
  claimInFlight = true;
  try {
    const pushToken = await getStoredToken();
    const deviceId = await getDeviceId();
    const pushHash12 = pushToken ? await hash12(pushToken) : 'none';
    logger.info('[push] claimTokenForUser (noop, local-only)', { token_hash12: pushHash12, deviceId });
  } finally {
    claimInFlight = false;
  }
}

// ---- Internal helpers -------------------------------------------------------

async function ensureRegisteredIfGranted(): Promise<void> {
  try {
    const status = await PushNotifications.checkPermissions();
    if (status.receive === 'granted') {
      logger.info('[push] permission granted — registering (non-blocking)…');
      void PushNotifications.register();
      await Preferences.set({ key: PREFS.pushPerm, value: 'granted' });
    } else {
      logger.info('[push] permission not granted — skipping auto register');
    }
  } catch (e) {
    logger.warn('[push] ensureRegisteredIfGranted failed (non-fatal)', { e });
  }
}

/** Persist token (native + debug mirror) */
async function storeToken(pushToken: string): Promise<void> {
  const pushHash12 = await hash12(pushToken);
  logger.info('[push] storeToken', { token_hash12: pushHash12 });
  if (getNormalizedPlatform() === 'android') {
    await Preferences.set({ key: PREFS.apnToken, value: pushToken });
  }
  try {
    localStorage.setItem('__debug_apn_token', pushToken);
  } catch {
    // ignore
  }
}

/** iOS-native fallback for very old bridges that wrote into window.NativeStorage. */
export function PullNativeFallback(): void {
  // Keep your existing env toggle behavior without importing import.meta here
  // (if you want the old ENABLE_IOS_NATIVE_FALLBACK behaviour back, re-add it safely)
  if (getNormalizedPlatform() !== 'ios') return;
  if (iosFallbackRan) return;
  iosFallbackRan = true;

  setTimeout(() => {
    void (async () => {
      try {
        const ns = window.NativeStorage;
        const raw = ns && typeof ns.getItem === 'function' ? await ns.getItem('apn_token') : null;
        if (!raw) {
          logger.debug('[Fallback] No native token found');
          return;
        }
        const tok12 = await hash12(raw);
        logger.info('[Fallback] Found native token', { token_hash12: tok12 });
        window.dispatchEvent(new CustomEvent('pushTokenUpdated', { detail: raw }));
      } catch (e) {
        logger.warn('[Fallback] Error pulling native token', { e });
      }
    })();
  }, 2000);
}

// Devtools helper (does nothing harmful in local mode)
if (typeof window !== 'undefined') {
  window.forceClaim = claimTokenForUser;
}


