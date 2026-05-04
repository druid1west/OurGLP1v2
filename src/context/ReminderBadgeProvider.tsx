// src/context/ReminderBadgeProvider.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReminderBadgeContext } from './ReminderBadgeContext';
import { useAuth } from './useAuth';
import { setAppBadge } from '../utils/appBadge';
import { emitReminderAbsolute } from '../utils/reminderEvents';
import { listReminders } from '../db/RemindersRepository';

/** Count reminders that still need user acknowledgement. */
function needsAcknowledgement(
  enabled: 0 | 1,
  acknowledgedAt: string | null
): boolean {
  return Boolean(enabled && !acknowledgedAt);
}

const clampNonNegative = (n: number) =>
  Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;

// Background cadence + throttle
const POLL_MS = 60_000; // visible-only heartbeat
const MIN_GAP_MS = 10_000; // don’t re-hit DB more often than this

const ReminderBadgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [count, setCount] = useState(0);
  const { loading } = useAuth();

  // lifecycle/internals
  const mounted = useRef(true);
  const ticking = useRef<number | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);

  // throttle + single-flight guards
  const inflight = useRef<Promise<void> | null>(null);
  const lastHitMs = useRef<number>(0);

  const refreshCount = useCallback(async (): Promise<void> => {
    if (loading || document.hidden) return;

    const now = Date.now();
    if (now - lastHitMs.current < MIN_GAP_MS) return;
    if (inflight.current) return inflight.current;

    inflight.current = (async () => {
      try {
        const rows = await listReminders();

        const next = clampNonNegative(
          rows.reduce<number>((acc, r) => {
            return acc + (needsAcknowledgement(r.enabled, r.acknowledged_at) ? 1 : 0);
          }, 0)
        );

        if (!mounted.current) return;

        // Use `next` so it’s not “assigned but never used”
        setCount((prev) => {
          if (prev !== next) {
            emitReminderAbsolute(next); // let other tabs/pages sync
            return next;
          }
          return prev;
        });

        lastHitMs.current = Date.now();
      } finally {
        inflight.current = null;
      }
    })();

    return inflight.current;
  }, [loading]);

  // mount/unmount
  useEffect(() => {
    mounted.current = true;
    void refreshCount();
    return () => {
      mounted.current = false;
    };
  }, [refreshCount]);

  // visible/focus refresh + lightweight polling (visible only)
  useEffect(() => {
    const queueRefresh = () => {
      if (ticking.current) return;
      ticking.current = window.setTimeout(() => {
        if (ticking.current) {
          clearTimeout(ticking.current);
          ticking.current = null;
        }
        void refreshCount();
      }, 120);
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') queueRefresh();
    };
    const onFocus = () => queueRefresh();

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);

    const iv = window.setInterval(() => {
      if (!document.hidden) void refreshCount();
    }, POLL_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      if (ticking.current) {
        clearTimeout(ticking.current);
        ticking.current = null;
      }
      window.clearInterval(iv);
    };
  }, [refreshCount]);

  // local create/delete events + cross-tab sync (no loops)
  useEffect(() => {
    const onChange = (e: Event) => {
      if (!mounted.current) return;
      const detail = (e as CustomEvent).detail as
        | { delta?: number; absolute?: number }
        | undefined;
      if (!detail) return;

      // Absolute wins (no immediate follow-up refresh to avoid loops)
      if (typeof detail.absolute === 'number') {
        const next = clampNonNegative(detail.absolute);
        setCount((prev) => (prev !== next ? next : prev));
        return;
      }

      // Delta: apply & then do one soft true-up (throttled)
      if (typeof detail.delta === 'number') {
        setCount((prev) => clampNonNegative((prev ?? 0) + detail.delta!));
        setTimeout(() => mounted.current && void refreshCount(), 1500);
      }
    };

    window.addEventListener('reminders:changed', onChange);

    if ('BroadcastChannel' in window) {
      bcRef.current = new BroadcastChannel('reminders');
      bcRef.current.onmessage = (msg) =>
        onChange(new CustomEvent('reminders:changed', { detail: msg.data }));
    }

    return () => {
      window.removeEventListener('reminders:changed', onChange);
      bcRef.current?.close();
      bcRef.current = null;
    };
  }, [refreshCount]);

  // keep OS/app badge in sync
  useEffect(() => {
    setAppBadge(count);
  }, [count]);

  return (
    <ReminderBadgeContext.Provider value={{ count, setCount, refreshCount }}>
      {children}
    </ReminderBadgeContext.Provider>
  );
};

export default ReminderBadgeProvider;



