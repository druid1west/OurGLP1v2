// src/pages/CelebrationPage.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IonPage, IonContent, IonButton } from '@ionic/react';
import { useHistory, useLocation } from 'react-router-dom';

import type { CelebrationContext } from '../types/celebration';
import { getMetricConfig } from '../celebration/celebrationConfig';
import { markCelebrated } from '../celebration/celebrationLogic';
import { logger } from '../utils/logger';
import styles from './CelebrationPage.module.css';

type CelebrationLocationState = CelebrationContext | null | undefined;

const LAST_CELEBRATION_KEY = 'lastCelebrationCtx';
const log = logger.child('celebration');

// Simple type guard
function isCelebrationContext(value: unknown): value is CelebrationContext {
  if (!value || typeof value !== 'object') return false;

  const v = value as {
    metric?: unknown;
    kind?: unknown;
    dateYmd?: unknown;
  };

  return (
    typeof v.metric === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.dateYmd === 'string'
  );
}

function getCtxFromLocation(
  state: CelebrationLocationState,
): CelebrationContext | undefined {
  if (!state) return undefined;
  if (isCelebrationContext(state)) return state;
  return undefined;
}

function getCtxFromStorage(): CelebrationContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = window.sessionStorage.getItem(LAST_CELEBRATION_KEY);
  if (!raw) return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isCelebrationContext(parsed)) {
      return parsed;
    }
  } catch {
    // corrupt / unparsable, ignore
  }
  return undefined;
}

const CelebrationPage: React.FC = () => {
  const history = useHistory();
  const location = useLocation<CelebrationLocationState>();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Derive context once on mount: prefer location.state, fall back to storage
  const [ctx] = useState<CelebrationContext | undefined>(() => {
    const fromLocation = getCtxFromLocation(location.state);
    if (fromLocation) return fromLocation;

    const fromStorage = getCtxFromStorage();
    return fromStorage;
  });

  // Log state shape and redirect if we truly have no context
  useEffect(() => {
    const rawState = location.state;
    let stateSummary:
      | {
          keys: string[];
          metricType: string;
          kindType: string;
          dateYmdType: string;
        }
      | { kind: string };

    if (rawState && typeof rawState === 'object') {
      const keys = Object.keys(rawState as object);
      const typed = rawState as {
        metric?: unknown;
        kind?: unknown;
        dateYmd?: unknown;
      };

      stateSummary = {
        keys,
        metricType:
          typed.metric === undefined || typed.metric === null
            ? 'missing'
            : typeof typed.metric,
        kindType:
          typed.kind === undefined || typed.kind === null
            ? 'missing'
            : typeof typed.kind,
        dateYmdType:
          typed.dateYmd === undefined || typed.dateYmd === null
            ? 'missing'
            : typeof typed.dateYmd,
      };
    } else {
      stateSummary = { kind: typeof rawState };
    }

    log.info('location.state on mount', {
      stateSummary,
      hasCtx: !!ctx,
    });

    if (!ctx) {
      log.warn('missing or invalid celebration context, redirecting to /healthtracker');
      history.replace('/healthtracker');
    }
  }, [ctx, history, location.state]);

  // Play audio once we know we have a valid context
  useEffect(() => {
    if (!ctx) return;
    markCelebrated(ctx.metric, ctx.kind, ctx.dateYmd);
    try {
      window.sessionStorage.removeItem(LAST_CELEBRATION_KEY);
    } catch {
      // Ignore storage errors; the route state still controls this visit.
    }
    if (audioRef.current) {
      void audioRef.current.play().catch(() => {
        // ignore autoplay errors
      });
    }
  }, [ctx]);

  const randomPhrase = useMemo(() => {
    const phrases: string[] = [
      ...(ctx?.metric === 'weight'
        ? [
            'That is a real win. Keep it steady.',
            'Progress is progress, even when it is small.',
            'You showed up for yourself today.',
          ]
        : []),
      'Your future self says thanks 💙',
      'Consistency beats intensity. Keep going!',
      'Every small win stacks up 📈',
      "You're building a stronger baseline for your health.",
      'Tiny habits, big results. Nice work.',
    ];
    const idx = Math.floor(Math.random() * phrases.length);
    return phrases[idx];
  }, [ctx?.metric]);

  if (!ctx) {
    // While redirecting, render nothing
    return null;
  }

  log.info('rendering celebration with context', { ctx });

  const config = getMetricConfig(ctx.metric);

  const titleText = (() => {
    if (ctx.metric === 'weight') {
      return 'Progress logged!';
    }

    switch (ctx.kind) {
      case 'single_entry':
        return 'Nice Hit!';
      case 'daily_total':
        return 'Goal Achieved!';
      case 'adherence':
        return 'Plan Completed!';
      default:
        return 'Well done!';
    }
  })();

  const detailLine = (() => {
    const unit = config.unitLabel ? ` ${config.unitLabel}` : '';
    const valueStr = ctx.value != null ? `${ctx.value}${unit}` : '';
    const goalStr = ctx.goal != null ? `${ctx.goal}${unit}` : '';

    if (ctx.metric === 'weight' && ctx.value != null && ctx.goal != null) {
      const change = Math.max(0, ctx.goal - ctx.value);
      return `Your weight moved down by ${Number(change.toFixed(1))}${unit}. Small steady changes count.`;
    }

    if (ctx.kind === 'adherence') {
      return `You stuck to your ${config.friendlyName.toLowerCase()} plan for ${ctx.dateYmd}.`;
    }

    if (valueStr && goalStr) {
      return `You hit ${valueStr} (goal: ${goalStr}) for ${ctx.dateYmd}.`;
    }

    if (valueStr) {
      return `You logged ${valueStr} for ${ctx.dateYmd}.`;
    }

    return `You completed your ${config.friendlyName.toLowerCase()} goal for ${ctx.dateYmd}.`;
  })();

  const handleBack = (): void => {
    try {
      window.sessionStorage.removeItem(LAST_CELEBRATION_KEY);
    } catch {
      // Ignore storage errors; navigation is still safe.
    }
    history.replace('/healthtracker');
  };

 return (
    <IonPage>
      <IonContent fullscreen>
        <div className={styles.root}>
          {/* Fireworks */}
          <div className={styles.fireworksLayer} aria-hidden="true">
            {Array.from({ length: 15 }).map((_, i) => (
              <div key={i} className={styles.firework} />
            ))}
          </div>

          {/* Sound */}
          <audio ref={audioRef} src="/sounds/celebration.mp3" />

          {/* Card */}
          <div className={`${styles.card} ${styles.cardAnimated}`}>
            <div className={styles.emojiRow}>🎉</div>
            <h1 className={styles.title}>{titleText}</h1>
            <p className={styles.detailLine}>{detailLine}</p>
            <p className={styles.subLine}>{randomPhrase}</p>

            <IonButton className="custom-button" expand="block" onClick={handleBack}>
              Back to Tracker
            </IonButton>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default CelebrationPage;

