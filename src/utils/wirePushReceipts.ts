// src/utils/wirePushReceipts.ts
import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type PushNotificationSchema,
  type ActionPerformed,
} from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';
import { trackPushReceived, trackPushOpened, hash12 } from '../telemetry/analytics';
import { logger } from '../utils/logger';

type Platform = 'ios' | 'android';

type NotificationData = {
  route?: string;
  deep_link?: string;
  notification_type?: string;
  source?: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asNotificationData(v: unknown): NotificationData | undefined {
  if (!isRecord(v)) return undefined;
  const out: NotificationData = {};
  if (typeof v.route === 'string') out.route = v.route;
  if (typeof v.deep_link === 'string') out.deep_link = v.deep_link;
  if (typeof v.notification_type === 'string') out.notification_type = v.notification_type;
  if (typeof v.source === 'string') out.source = v.source;
  return out;
}

async function getTokenHash12(): Promise<string | null> {
  const { value } = await Preferences.get({ key: 'apn_token' });
  if (!value) return null;
  try {
    return await hash12(value);
  } catch (e) {
    logger.warn('[push] hash12 failed', { e });
    return null;
  }
}

export function wirePushReceipts(): void {
  const platRaw = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
  if (platRaw === 'web') return;
  const platform: Platform = platRaw === 'android' ? 'android' : 'ios';

  // Delivered while app is foreground (background will be inferred when opened)
  PushNotifications.addListener('pushNotificationReceived', async (n: PushNotificationSchema) => {
    const tok12 = await getTokenHash12();
    const data = asNotificationData(n?.data);
    const route = data?.route || data?.deep_link || '';

    trackPushReceived({
      platform,
      token_hash12: tok12 ?? undefined,
      route,
      notification_type: data?.notification_type || data?.source || 'unknown',
      foreground: true,
      at: new Date().toISOString(),
    });

    logger.info('[push] received', { platform, token_hash12: tok12 ?? 'none', route });
  });

  // Opened from system tray
  PushNotifications.addListener('pushNotificationActionPerformed', async (e: ActionPerformed) => {
    const tok12 = await getTokenHash12();
    const data = asNotificationData(e?.notification?.data);
    const route = data?.route || data?.deep_link || '';

    trackPushOpened({
      platform,
      token_hash12: tok12 ?? undefined,
      route,
      action: e.actionId || 'tap',
      at: new Date().toISOString(),
    });

    logger.info('[push] opened', { platform, token_hash12: tok12 ?? 'none', route });
  });
}

