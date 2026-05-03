// src/utils/appBadge.ts
import { Capacitor } from '@capacitor/core';
import { Badge } from '@capawesome/capacitor-badge';
import { logger } from '../utils/logger';

// Infer the exact string union for the "display" permission from the plugin itself
type DisplayPermission = Awaited<ReturnType<typeof Badge.checkPermissions>>['display'];

let originalTitle: string | null = null;
let badgePermission: DisplayPermission | null = null;

async function ensurePermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    if (!badgePermission) {
      const { display } = await Badge.checkPermissions();
      badgePermission = display;
      if (badgePermission !== 'granted') {
        const res = await Badge.requestPermissions();
        badgePermission = res.display;
      }
    }
    return badgePermission === 'granted';
  } catch (e) {
    logger.warn('[badge] permission check failed', { msg: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

function setWebTitleCount(count: number): void {
  if (typeof document === 'undefined') return;
  if (originalTitle == null) originalTitle = document.title;
  const base = originalTitle;
  document.title = count > 0 ? `(${count}) ${base}` : base;
}

export async function setAppBadge(count: number): Promise<void> {
  const n = Math.max(0, Math.floor(count));
  if (!Capacitor.isNativePlatform()) {
    setWebTitleCount(n);
    return;
  }

  const ok = await ensurePermission();
  if (!ok) {
    setWebTitleCount(n);
    return;
  }

  try {
    await Badge.set({ count: n });
  } catch (e) {
    logger.warn('[badge] set failed', { msg: e instanceof Error ? e.message : String(e) });
    setWebTitleCount(n);
  }
}

