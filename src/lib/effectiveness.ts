import type { User } from '../context/authTypes';
import {
  getLatestProtocolEvent,
  getPrimaryProtocol,
  type Protocol,
  type ProtocolEvent,
} from '../db/ProtocolRepository';
import { computeDailyDoseActivity, computeGlp1Activity, glp1ActivityToPercent } from './glp1';

export type EffectivenessModel = 'daily' | 'weekly';

export type CurrentEffectiveness = {
  percent: number;
  model: EffectivenessModel;
  title: string;
  label: string;
  detail: string;
  protocol: Protocol | null;
  latestEvent: ProtocolEvent | null;
  anchorDay: string;
  doseTime: string;
};

function toShortDay(value?: string | null): string | undefined {
  if (!value) return undefined;
  const s = value.toLowerCase();
  if (s.startsWith('mon')) return 'Mon';
  if (s.startsWith('tue')) return 'Tue';
  if (s.startsWith('wed')) return 'Wed';
  if (s.startsWith('thu')) return 'Thu';
  if (s.startsWith('fri')) return 'Fri';
  if (s.startsWith('sat')) return 'Sat';
  if (s.startsWith('sun')) return 'Sun';
  return undefined;
}

function fallbackTimezone(user: User | null | undefined): string {
  return user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export async function getCurrentEffectiveness(
  user: User,
  now = new Date()
): Promise<CurrentEffectiveness> {
  const timezone = fallbackTimezone(user);
  const protocol = await getPrimaryProtocol(user.id).catch(() => null);
  const latestEvent = protocol
    ? await getLatestProtocolEvent(user.id, protocol.id).catch(() => null)
    : null;

  const isDaily = protocol?.effectiveness_model === 'daily_24h';
  const doseTime = protocol?.dose_time || user.injection_time?.slice(0, 5) || '08:00';
  const anchorDay = isDaily ? 'Monday' : protocol?.anchor_day || user.injection_day || 'Monday';
  const doseLabel = protocol?.dose_label?.trim() || user.medication_dose?.trim() || null;

  if (isDaily) {
    const percent = glp1ActivityToPercent(
      computeDailyDoseActivity({
        doseTime,
        lastTakenAt: latestEvent?.event_at,
        now,
      })
    );

    return {
      percent,
      model: 'daily',
      title: 'Daily Pill Effectiveness',
      label: `Daily pill${doseLabel ? ` - ${doseLabel}` : ''}`,
      detail: latestEvent
        ? 'Estimated 24-hour coverage from your last logged pill'
        : `Estimated 24-hour coverage from your usual ${doseTime} pill time`,
      protocol,
      latestEvent,
      anchorDay,
      doseTime,
    };
  }

  const percent = glp1ActivityToPercent(
    computeGlp1Activity({
      injectionDay: toShortDay(anchorDay),
      injectionTime: doseTime,
      timezone,
      now,
    })
  );

  const name = protocol?.name || user.medication_name || 'Weekly GLP-1';

  return {
    percent,
    model: 'weekly',
    title: 'Weekly Injection Effectiveness',
    label: `${name}${doseLabel ? ` - ${doseLabel}` : ''}`,
    detail: 'Estimated weekly injection effectiveness since the scheduled dose',
    protocol,
    latestEvent,
    anchorDay,
    doseTime,
  };
}
