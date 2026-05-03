// src/utils/reinitPushPermissions.ts
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import type { PermissionStatus } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';

/**
 * Ensures the Android notification channel used by the server exists.
 * Server sends Android pushes with channelId: 'reminders'.
 */
async function ensureAndroidChannel() {
  if (Capacitor.getPlatform() !== 'android') return;

  try {
    await LocalNotifications.createChannel({
      id: 'reminders',
      name: 'Reminders',
      description: 'GLP-1 injection & health reminders',
      importance: 5, // IMPORTANCE_HIGH
      visibility: 1, // VISIBILITY_PUBLIC
      sound: 'default',
      vibration: true,
      lights: true,
    });
  } catch (e) {
    // Non-fatal; channel may already exist
    console.warn('[push] createChannel ignored:', e);
  }
}

/**
 * Re-request push permission (if needed) and re-register for a device token.
 * Safe to call multiple times. On iOS, if the user previously chose "Don’t Allow",
 * this will return 'denied' again — they must enable in Settings.
 *
 * Returns the final permission status.
 */
export async function reinitPushPermissions(): Promise<PermissionStatus> {
  const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
  if (platform === 'web') {
    return { receive: 'denied' } as PermissionStatus; // push not applicable
  }

  // 1) Check current permission
  let perm = await PushNotifications.checkPermissions();

  // 2) Ask if needed (or ask again — iOS will simply return 'denied' if blocked)
  if (perm.receive !== 'granted') {
    try {
      perm = await PushNotifications.requestPermissions();
    } catch (e) {
      console.warn('[push] requestPermissions failed:', e);
      // Continue; we'll still attempt register to trigger plugin flows if possible
    }
  }

  // 3) Android: ensure the channel exists BEFORE register (maps to server channelId)
  await ensureAndroidChannel();

  // 4) Register (fires token events; your pushManager listener will handle posting to backend)
  try {
    await PushNotifications.register();
  } catch (e) {
    console.warn('[push] register failed:', e);
  }

  // 5) Return the latest known permission state
  try {
    return await PushNotifications.checkPermissions();
  } catch {
    return perm;
  }
}

/**
 * Optional helper you can use to nudge users on iOS to open Settings manually.
 * (Call from UI if reinitPushPermissions() returns { receive: 'denied' } on iOS.)
 */
// export async function openAppSettingsHint() {
//   const url = Capacitor.getPlatform() === 'ios' ? 'app-settings:' : 'package:com.ourglp1.app';
//   try { await (await import('@capacitor/app')).App.openUrl({ url }); } catch { /* ignore */ }
// }
