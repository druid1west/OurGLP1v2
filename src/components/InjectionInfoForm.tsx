// components/InjectionPlanForm.tsx
import React, { useEffect, useMemo, useState } from 'react';
import styles from './InjectionModal.module.css';

type WeekdayName =
  | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

type ReminderOption = '24h' | '1h' | '0h';

type PlanPayload = {
  injection_day: WeekdayName | number; // server may accept name or index
  injection_time: string;              // HH:MM or HH:MM:SS
  reminder_option: ReminderOption;
  timezone?: string;                   // client tz hint; server stays UTC
};

function readDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function toHHMMSS(hhmm: string): string {
  return hhmm && hhmm.length >= 5 ? `${hhmm.slice(0, 5)}:00` : hhmm;
}

const dayNameToIndex0 = (name: string): number | undefined => {
  const map: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  };
  return map[name.toLowerCase()];
};
const dayNameToIndex1 = (name: string): number | undefined => {
  const i0 = dayNameToIndex0(name);
  return i0 != null ? ((i0 + 6) % 7) + 1 : undefined; // Mon=1..Sun=7
};

const InjectionPlanForm: React.FC = () => {
  const [injectionDay, setInjectionDay] = useState<WeekdayName>('Monday');
  const [injectionTime, setInjectionTime] = useState<string>('08:00'); // HH:MM
  const [reminder, setReminder] = useState<ReminderOption>('24h');
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');

  // follow device timezone (mirrors Profile behavior by default)
  const [deviceTimezone, setDeviceTimezone] = useState<string>(readDeviceTimezone());
  useEffect(() => {
    const check = () => {
      const tz = readDeviceTimezone();
      if (tz !== deviceTimezone) setDeviceTimezone(tz);
    };
    const onVisible = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(check, 60_000);
    check();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [deviceTimezone]);

  // If you later add a "manual" option, thread it here; for now we just use device tz.
  const effectiveTimezone = useMemo(() => deviceTimezone, [deviceTimezone]);

async function postPlanRobust(base: Omit<PlanPayload, 'injection_day' | 'injection_time'> & {
  injection_day: WeekdayName;
  injection_time: string; // HH:MM
}): Promise<boolean> {
  const hhmm = base.injection_time.slice(0, 5);
  const hhmmss = toHHMMSS(hhmm);
  const d0 = dayNameToIndex0(base.injection_day);
  const d1 = dayNameToIndex1(base.injection_day);

  const candidates: PlanPayload[] = [
    { injection_day: base.injection_day, injection_time: hhmm,   reminder_option: base.reminder_option, timezone: base.timezone },
    { injection_day: base.injection_day, injection_time: hhmmss, reminder_option: base.reminder_option, timezone: base.timezone },
  ];
  if (d0 != null) candidates.push({ injection_day: d0, injection_time: hhmmss, reminder_option: base.reminder_option, timezone: base.timezone });
  if (d1 != null) candidates.push({ injection_day: d1, injection_time: hhmmss, reminder_option: base.reminder_option, timezone: base.timezone });

  let lastErr: unknown;

  for (const payload of candidates) {
    try {
      const res = await fetch('/api/user/plan', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (!data || data.success !== false) return true;
      } else {
        lastErr = await res.text().catch(() => `HTTP ${res.status}`);
      }
    } catch (e) {
      lastErr = e;
    }
  }

  // read lastErr so eslint is happy (and you get diagnostics)
 
  console.warn('[InjectionPlanForm] /plan failed after fallbacks', lastErr);
  return false;
}


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setError('');

    const ok = await postPlanRobust({
      injection_day: injectionDay,
      injection_time: injectionTime,       // HH:MM from input
      reminder_option: reminder,
      timezone: effectiveTimezone,
    });

    if (ok) {
      setMessage('✅ Injection plan saved!');
    } else {
      setError('❌ Failed to save. Please try again.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className={styles.formContainer}>
      <div className={styles.formGroup}>
        <label className={styles.label}>Injection Day:</label>
        <select
          className={styles.select}
          value={injectionDay}
          onChange={(e) => setInjectionDay(e.target.value as WeekdayName)}
        >
          {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
            <option key={day} value={day}>{day}</option>
          ))}
        </select>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>Injection Time:</label>
        <input
          className={styles.input}
          type="time"
          step={900} // 15-min snap like Profile
          value={injectionTime}
          onChange={(e) => setInjectionTime(e.target.value)}
          required
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>Reminder:</label>
        <select
          className={styles.select}
          value={reminder}
          onChange={(e) => setReminder(e.target.value as ReminderOption)}
        >
          <option value="24h">24 hours before</option>
          <option value="1h">1 hour before</option>
          <option value="0h">At time of injection</option>
        </select>
      </div>

      <p className={styles.message} style={{ marginTop: 6 }}>
        Using timezone: <strong>{effectiveTimezone}</strong>
      </p>

      <button type="submit" className={styles.button}>
        Save Injection Plan
      </button>

      {message && <p className={styles.message}>{message}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
};

export default InjectionPlanForm;

