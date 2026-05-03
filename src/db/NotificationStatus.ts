import { getDb } from '../db/sqlite';
import { LocalNotifications } from '@capacitor/local-notifications';

export type NotificationsPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export type NotificationStatus = Readonly<{
  permission: NotificationsPermission;
  enabled: 0 | 1;
  last_permission_check: string | null;
  last_prompt_at: string | null;
}>;

type StatusRow = Readonly<{
  notifications_permission: NotificationsPermission | null;
  notifications_enabled: number | null;
  last_permission_check: string | null;
  last_prompt_at: string | null;
}>;

type QueryResult<T> = Readonly<{ values?: readonly T[] }>;

export async function getNotificationStatus(): Promise<NotificationStatus> {
  const db = await getDb();
  const res = (await db.query(
    `SELECT notifications_permission, notifications_enabled, last_permission_check, last_prompt_at
     FROM settings WHERE id = 1 LIMIT 1`
  )) as QueryResult<StatusRow>;

  const row = res.values?.[0];
  return {
    permission: (row?.notifications_permission ?? 'unknown') as NotificationsPermission,
    enabled: (row?.notifications_enabled ?? 1) ? 1 : 0,
    last_permission_check: row?.last_permission_check ?? null,
    last_prompt_at: row?.last_prompt_at ?? null,
  };
}

export async function setNotificationStatus(partial: Partial<NotificationStatus>): Promise<void> {
  const db = await getDb();
  // read current
  const current = await getNotificationStatus();
  const merged: NotificationStatus = {
    permission: partial.permission ?? current.permission,
    enabled: partial.enabled ?? current.enabled,
    last_permission_check: partial.last_permission_check ?? current.last_permission_check,
    last_prompt_at: partial.last_prompt_at ?? current.last_prompt_at,
  };
  await db.run(
    `UPDATE settings
       SET notifications_permission = ?,
           notifications_enabled    = ?,
           last_permission_check    = ?,
           last_prompt_at           = ?
     WHERE id = 1`,
    [
      merged.permission,
      merged.enabled,
      merged.last_permission_check,
      merged.last_prompt_at,
    ]
  );
}

/** Check device permission via LocalNotifications and persist the result. */
export async function checkAndPersistPermission(): Promise<NotificationsPermission> {
  const perm = await LocalNotifications.checkPermissions();
  const permission: NotificationsPermission =
    perm.display === 'granted' ? 'granted' :
    perm.display === 'denied'  ? 'denied'  :
    'prompt';

  await setNotificationStatus({
    permission,
    last_permission_check: new Date().toISOString(),
  });
  return permission;
}

/** Request permission (will show OS prompt) and persist. */
export async function requestAndPersistPermission(): Promise<NotificationsPermission> {
  const result = await LocalNotifications.requestPermissions();
  const permission: NotificationsPermission =
    result.display === 'granted' ? 'granted' :
    result.display === 'denied'  ? 'denied'  :
    'prompt';

  await setNotificationStatus({
    permission,
    last_permission_check: new Date().toISOString(),
    last_prompt_at: new Date().toISOString(),
  });
  return permission;
}


