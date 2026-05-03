// src/celebration/celebrationLogic.ts
import type {
  CelebrationMetric,
  CelebrationKind,
  CelebrationContext,
} from '../types/celebration';
import { getMetricConfig, getDailyGoal, getSingleEntryThreshold } from './celebrationConfig';
import { logger } from '../utils/logger';

const STORAGE_PREFIX = 'celebration:';

// Build a stable localStorage key: e.g. "celebration:protein:daily_total:2025-11-19"
function celebrationKey(metric: CelebrationMetric, kind: CelebrationKind, dateYmd: string): string {
  return `${STORAGE_PREFIX}${metric}:${kind}:${dateYmd}`;
}

export function hasCelebrated(
  metric: CelebrationMetric,
  kind: CelebrationKind,
  dateYmd: string,
): boolean {
  if (typeof window === 'undefined') return false;
  const key = celebrationKey(metric, kind, dateYmd);
  const val = window.localStorage.getItem(key);
  const result = val === 'shown';

  logger.debug('[celebration] hasCelebrated', {
    metric,
    kind,
    dateYmd,
    key,
    val,
    result,
  });

  return result;
}

export function markCelebrated(
  metric: CelebrationMetric,
  kind: CelebrationKind,
  dateYmd: string,
): void {
  if (typeof window === 'undefined') return;
  const key = celebrationKey(metric, kind, dateYmd);
  window.localStorage.setItem(key, 'shown');

  logger.debug('[celebration] markCelebrated', {
    metric,
    kind,
    dateYmd,
    key,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-entry celebration (e.g. 35g protein in one go, 500ml water in one go)
// ─────────────────────────────────────────────────────────────────────────────
export function buildSingleEntryCelebration(
  metric: CelebrationMetric,
  dateYmd: string,
  entryValue: number,
): CelebrationContext | null {
  const cfg = getMetricConfig(metric);
  if (!cfg || !cfg.enableSingleEntry) {
    logger.debug('[celebration] single_entry: disabled or no config', { metric });
    return null;
  }

  if (!Number.isFinite(entryValue)) {
    logger.warn('[celebration] single_entry: invalid entryValue (NaN)', {
      metric,
      dateYmd,
      entryValue,
    });
    return null;
  }

  if (hasCelebrated(metric, 'single_entry', dateYmd)) {
    logger.debug('[celebration] single_entry: already celebrated', { metric, dateYmd });
    return null;
  }

  const threshold = getSingleEntryThreshold(metric);
  if (threshold == null) {
    logger.warn('[celebration] single_entry: no threshold configured', { metric });
    return null;
  }

  if (entryValue < threshold) {
    logger.debug('[celebration] single_entry: below threshold', {
      metric,
      dateYmd,
      entryValue,
      threshold,
    });
    return null;
  }

  const ctx: CelebrationContext = {
    metric,
    kind: 'single_entry',
    dateYmd,
    value: entryValue,
    goal: threshold,
  };

  logger.debug('[celebration] single_entry: built context', ctx);
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily-total celebration (e.g. 70g protein / 2000ml water in a day)
// ─────────────────────────────────────────────────────────────────────────────
export function buildDailyTotalCelebration(
  metric: CelebrationMetric,
  dateYmd: string,
  totalValue: number,
): CelebrationContext | null {
  const cfg = getMetricConfig(metric);
  if (!cfg || !cfg.enableDailyTotal) {
    logger.debug('[celebration] daily_total: disabled or no config', { metric });
    return null;
  }

  if (hasCelebrated(metric, 'daily_total', dateYmd)) {
    logger.debug('[celebration] daily_total: already celebrated', { metric, dateYmd });
    return null;
  }

  const goal = getDailyGoal(metric);
  if (goal == null) {
    logger.warn('[celebration] daily_total: no daily goal configured', { metric });
    return null;
  }

  if (totalValue < goal) {
    logger.debug('[celebration] daily_total: below goal', {
      metric,
      dateYmd,
      totalValue,
      goal,
    });
    return null;
  }

  const ctx: CelebrationContext = {
    metric,
    kind: 'daily_total',
    dateYmd,
    value: totalValue,
    goal,
  };

  logger.debug('[celebration] daily_total: built context', ctx);

  // Again, do NOT mark here; let CelebrationPage do that.
  return ctx;
}



