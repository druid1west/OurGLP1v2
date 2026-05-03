// src/utils/pushHandlers.ts
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { App } from '@capacitor/app';
import type{
  PushNotificationSchema,
  PushNotificationActionPerformed,
} from '@capacitor/push-notifications';

import { trackPushReceived, trackPushOpened, hash12 } from '../telemetry/analytics';
import { getStoredToken } from '../utils/pushManager';

let wired = false;
let pendingDeepLink: string | null = null;
let isLoggedInRef: () => boolean = () => true;
let navigateRef: (path: string) => void = () => {};

const platformForAnalytics = (): 'ios' | 'android' => {
  const p = Capacitor.getPlatform();
  return p === 'android' ? 'android' : 'ios';
};

async function tokenHash12(): Promise<string | undefined> {
  const t = await getStoredToken();
  return t ? await hash12(t) : undefined;
}

export function initNotificationHandlers(opts: { navigate: (p: string) => void; isLoggedIn: () => boolean }) {
  // always refresh refs so latest user/nav are used
  navigateRef = opts.navigate;
  isLoggedInRef = opts.isLoggedIn;

  if (wired) return;
  wired = true;

  navigateRef = opts.navigate;
  isLoggedInRef = opts.isLoggedIn;

  const go = (raw?: string | null) => {
    if (!raw) return;
    const path = normalizeDeepLink(raw);
    if (!isLoggedInRef()) { pendingDeepLink = path; return; }
    navigateRef(path);
    pendingDeepLink = null;
  };

  // Foreground notifications
  PushNotifications.addListener('pushNotificationReceived', async (n: PushNotificationSchema) => {
    // skip web
    const plat = Capacitor.getPlatform();
    if (plat === 'web') return;

    const tok12 = await tokenHash12();
    const route = (n.data?.route as string) || (n.data?.deep_link as string) || '';

    trackPushReceived({
      platform: platformForAnalytics(),
      token_hash12: tok12,
      route,
      notification_type:
        (n.data?.notification_type as string) || (n.data?.source as string) || 'unknown',
      foreground: true,
      at: new Date().toISOString(),
    });
  });

  // User tapped the notification
  PushNotifications.addListener('pushNotificationActionPerformed', async (a: PushNotificationActionPerformed) => {
    const link = extractDeepLink(a.notification);

    // skip web
    if (Capacitor.getPlatform() !== 'web') {
      const tok12 = await tokenHash12();
      trackPushOpened({
        platform: platformForAnalytics(),
        token_hash12: tok12,
        route: link || '/reminders',
        action: a.actionId || 'tap',
        at: new Date().toISOString(),
      });
    }

    go(link);
  });

  // Cold start deep-link
  App.getLaunchUrl().then((launch) => {
    if (launch?.url) go(launch.url);
  });

  // Runtime app link (ourglp1://… while running)
  App.addListener('appUrlOpen', ({ url }) => go(url));
}

export function flushPendingDeepLink() {
  if (pendingDeepLink && isLoggedInRef()) {
    navigateRef(pendingDeepLink);
    pendingDeepLink = null;
  }
}

function extractDeepLink(n: PushNotificationSchema): string | null {
  const d = n?.data || {};
  return (d.deeplink || d.deepLink || d.url || d.path || d.route || null) as string | null;
}

function normalizeDeepLink(raw: string): string {
  try {
    const u = new URL(raw, 'https://app.ourglp1.com'); // base for bare paths
    return (u.pathname || '/') + (u.search || '') + (u.hash || '');
  } catch {
    return raw.startsWith('/') ? raw : `/${raw}`;
  }
}

