import React, { useEffect, useState, useRef, useCallback } from 'react';
import { IonPage, IonContent, IonButton, useIonRouter } from '@ionic/react';
import dayjs from 'dayjs';
import html2canvas from 'html2canvas';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';
import { useAuth } from '../context/useAuth';

import {
  insertGlp1ExperienceLog,
  listGlp1ExperienceForGraph,
  type Glp1GraphPoint,
} from '../db/EffectivenessRepository';

import { saveGlp1GraphArchive } from '../db/Glp1GraphRepository';

import styles from './Effectiveness.module.css';
import { logger } from '../utils/logger';

import { computeGlp1Activity, glp1ActivityToPercent } from '../lib/glp1';
import Glp1EffectivenessRing from '../components/Glp1EffectivenessRing';

// IMPORTANT: create child logger OUTSIDE component so it is stable
const log = logger.child('glp1-archive');

/* ────────────────────────────────────────────────────────────────
   Time helpers (local-only)
──────────────────────────────────────────────────────────────── */

function toShortDay(v?: string | null): string | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase();
  if (s.startsWith('mon')) return 'Mon';
  if (s.startsWith('tue')) return 'Tue';
  if (s.startsWith('wed')) return 'Wed';
  if (s.startsWith('thu')) return 'Thu';
  if (s.startsWith('fri')) return 'Fri';
  if (s.startsWith('sat')) return 'Sat';
  if (s.startsWith('sun')) return 'Sun';
  return undefined;
}

function isoFromDatetimeLocalForTz(dtLocal: string, tz: string): string | null {
  const [date, time] = dtLocal.split('T');
  if (!date || !time) return null;

  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);

  const base = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const local = new Date(base.toLocaleString('en-US', { timeZone: tz }));

  return new Date(base.getTime() - (local.getTime() - base.getTime())).toISOString();
}

/* ────────────────────────────────────────────────────────────────
   Safe helpers (NO any)
──────────────────────────────────────────────────────────────── */

function getStringProp(u: unknown, key: string): string | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const r = u as Record<string, unknown>;
  const v = r[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function getUserIdString(u: unknown): string | null {
  if (!u || typeof u !== 'object') return null;
  const r = u as Record<string, unknown>;
  const raw = r.id;
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));

/* ────────────────────────────────────────────────────────────────
   Blob → base64 helper (IMPORTANT for iOS)
──────────────────────────────────────────────────────────────── */

async function blobToBase64(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return await new Promise((resolve, reject) => {
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.onload = () => {
      const res = reader.result;
      if (typeof res !== 'string') return reject(new Error('Invalid base64 result'));
      resolve(res.split(',')[1] ?? '');
    };
    reader.readAsDataURL(blob);
  });
}

/* ────────────────────────────────────────────────────────────────
   Typical pattern (GENERAL, not user data)
──────────────────────────────────────────────────────────────── */

type ShortDay = 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat';

const SHORT_DAYS: ShortDay[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function rotateWeekFromInjectionDay(injectionDay?: string | null): ShortDay[] {
  const d = toShortDay(injectionDay) as ShortDay | undefined;
  if (!d) return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // fallback
  const idx = SHORT_DAYS.indexOf(d);
  if (idx < 0) return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return [...SHORT_DAYS.slice(idx), ...SHORT_DAYS.slice(0, idx)];
}

type TypicalRow = Readonly<{
  hunger: string;
  nausea: string;
  note: string;
}>;

const TYPICAL_PATTERN: Readonly<Record<ShortDay, TypicalRow>> = {
  Mon: {
    hunger: '2–3',
    nausea: '3–5',
    note: 'Often a noticeable appetite drop within hours. Nausea can show up later in the day.',
  },
  Tue: {
    hunger: '1–2',
    nausea: '4–6',
    note: 'Commonly the lowest hunger. Nausea is often worst 24–48h after the dose.',
  },
  Wed: {
    hunger: '1–3',
    nausea: '2–4',
    note: 'Appetite still low. Nausea often starts improving.',
  },
  Thu: {
    hunger: '2–3',
    nausea: '1–2',
    note: 'Appetite may return slightly. Nausea minimal for many.',
  },
  Fri: {
    hunger: '3–4',
    nausea: '0–1',
    note: 'Hunger slowly rises, usually still below pre-med baseline.',
  },
  Sat: {
    hunger: '4–5',
    nausea: '0',
    note: 'Appetite noticeably returns for many.',
  },
  Sun: {
    hunger: '5–6',
    nausea: '0',
    note: 'Often highest hunger of the week (still may be below baseline).',
  },
};

/* ────────────────────────────────────────────────────────────────
   Graph
──────────────────────────────────────────────────────────────── */

const GraphCard: React.FC<{
  points: Glp1GraphPoint[];
  injectionDay?: string;
  timezone: string;
}> = ({ points, injectionDay, timezone }) => {
  const width = 340;
  const height = 220;
  const paddingLeft = 36;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 50;

  if (points.length === 0) {
    return <div className={styles.muted}>No data yet</div>;
  }

  const getAnchorDate = (): Date => {
    const now = new Date();
    const dayMap: Record<string, number> = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    };

    const targetDay = injectionDay
      ? dayMap[injectionDay.toLowerCase().slice(0, 3)] ?? 1
      : 1;

    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    });

    const dayMap2: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    const currentDay = dayMap2[fmt.format(now) as keyof typeof dayMap2] ?? 0;

    let daysBack = currentDay - targetDay;
    if (daysBack < 0) daysBack += 7;

    const anchor = new Date(now);
    anchor.setDate(anchor.getDate() - daysBack);
    anchor.setHours(0, 0, 0, 0);
    return anchor;
  };

  const anchorDate = getAnchorDate();
  const minTime = anchorDate.getTime();
  const maxTime = minTime + 7 * 24 * 60 * 60 * 1000;

  const scaleX = (timestamp: string): number => {
    const time = new Date(timestamp).getTime();
    const ratio = (time - minTime) / (maxTime - minTime);
    return paddingLeft + ratio * (width - paddingLeft - paddingRight);
  };

  const scaleY = (value: number): number => {
    const ratio = value / 10;
    return height - paddingBottom - ratio * (height - paddingTop - paddingBottom);
  };

  const linePath = (key: 'hunger' | 'nausea'): string => {
    const filtered = points.filter((p) => {
      const t = new Date(p.recordedAt).getTime();
      return t >= minTime && t <= maxTime;
    });
    if (filtered.length === 0) return '';
    return filtered
      .map((p, i) =>
        `${i === 0 ? 'M' : 'L'} ${scaleX(p.recordedAt)} ${scaleY(p[key])}`
      )
      .join(' ');
  };

  const dayLabels: Array<{ x: number; label: string; isAnchor: boolean }> = [];
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  for (let i = 0; i < 8; i++) {
    const date = new Date(anchorDate);
    date.setDate(date.getDate() + i);
    const dayName = fmt.format(date);
    const x = paddingLeft + (i / 7) * (width - paddingLeft - paddingRight);
    dayLabels.push({ x, label: dayName, isAnchor: i === 0 });
  }

  const yLabels = [0, 2, 4, 6, 8, 10];

  const visiblePoints = points.filter((p) => {
    const t = new Date(p.recordedAt).getTime();
    return t >= minTime && t <= maxTime;
  });

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={styles.graphSvg}
        role="img"
        aria-label="Hunger and nausea trend over time"
      >
        {yLabels.map((val) => (
          <line
            key={`grid-${val}`}
            x1={paddingLeft}
            y1={scaleY(val)}
            x2={width - paddingRight}
            y2={scaleY(val)}
            className={styles.graphGrid}
          />
        ))}

        {dayLabels.slice(0, -1).map((day, i) => (
          <line
            key={`vline-${i}`}
            x1={day.x}
            y1={paddingTop}
            x2={day.x}
            y2={height - paddingBottom}
            className={day.isAnchor ? styles.graphAnchorLine : styles.graphDayLine}
          />
        ))}

        <line
          x1={paddingLeft}
          y1={height - paddingBottom}
          x2={width - paddingRight}
          y2={height - paddingBottom}
          className={styles.graphAxis}
        />
        <line
          x1={paddingLeft}
          y1={paddingTop}
          x2={paddingLeft}
          y2={height - paddingBottom}
          className={styles.graphAxis}
        />

        {linePath('hunger') && <path d={linePath('hunger')} className={styles.graphHunger} />}
        {linePath('nausea') && <path d={linePath('nausea')} className={styles.graphNausea} />}

        {visiblePoints.map((p, i) => (
          <g key={`point-${i}`}>
            <circle
              cx={scaleX(p.recordedAt)}
              cy={scaleY(p.hunger)}
              r="4"
              className={styles.graphHungerPoint}
            />
            <circle
              cx={scaleX(p.recordedAt)}
              cy={scaleY(p.nausea)}
              r="4"
              className={styles.graphNauseaPoint}
            />
          </g>
        ))}

        {yLabels.map((val) => (
          <text
            key={`ylabel-${val}`}
            x={paddingLeft - 10}
            y={scaleY(val)}
            className={styles.graphYLabel}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {val}
          </text>
        ))}

        {dayLabels.slice(0, -1).map((day, i) => (
          <text
            key={`xlabel-${i}`}
            x={day.x}
            y={height - paddingBottom + 18}
            className={day.isAnchor ? styles.graphXLabelAnchor : styles.graphXLabel}
            textAnchor="middle"
          >
            {day.label}
          </text>
        ))}

        {injectionDay && (
          <text
            x={paddingLeft}
            y={height - paddingBottom + 35}
            className={styles.graphInjectionLabel}
            textAnchor="middle"
          >
            💉 Injection
          </text>
        )}
      </svg>

      <div className={styles.graphLegend}>
        <span className={styles.legendHunger}>● Hunger</span>
        <span className={styles.legendNausea}>● Nausea</span>
      </div>
    </>
  );
};

/* ────────────────────────────────────────────────────────────────
   Page
──────────────────────────────────────────────────────────────── */

const Effectiveness: React.FC = () => {
  const { user } = useAuth();
  const router = useIonRouter();
  const graphRef = useRef<HTMLDivElement>(null);

  const userId = getUserIdString(user);
  const timezone =
    getStringProp(user, 'timezone') ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    'UTC';

  const [hunger, setHunger] = useState(5);
  const [nausea, setNausea] = useState(0);
  const [note, setNote] = useState('');
  const [time, setTime] = useState(dayjs().format('YYYY-MM-DDTHH:mm'));
  const [graphPoints, setGraphPoints] = useState<Glp1GraphPoint[]>([]);
  const [archiving, setArchiving] = useState(false);

  const archivingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!userId) {
      setGraphPoints([]);
      return;
    }

    const load = async (): Promise<void> => {
      const rows = await listGlp1ExperienceForGraph(userId, 14);
      setGraphPoints(rows);
    };

    void load();
  }, [userId]);

  const injectionDay = getStringProp(user, 'injection_day');
  const injectionTime = getStringProp(user, 'injection_time')?.slice(0, 5);
  const medicationName = getStringProp(user, 'medication_name') ?? 'Weekly GLP-1';

  const glp1Pct = glp1ActivityToPercent(
    computeGlp1Activity({
      injectionDay: toShortDay(injectionDay),
      injectionTime,
      timezone,
    })
  );

  async function submit(): Promise<void> {
    if (!userId) return;

    const iso = isoFromDatetimeLocalForTz(time, timezone);
    if (!iso) return alert('Invalid time');

    await insertGlp1ExperienceLog({
      userId,
      recordedAt: iso,
      localDay: iso.slice(0, 10),
      hunger,
      nausea,
      note: note.trim() || undefined,
    });

    setNote('');
    const rows = await listGlp1ExperienceForGraph(userId, 14);
    setGraphPoints(rows);
    alert('Experience logged');
  }

  const handleArchiveGraph = useCallback(async (): Promise<void> => {
  if (!graphRef.current || !userId) {
    alert('Unable to archive graph');
    return;
  }

  if (graphPoints.length === 0) {
    alert('No data to archive');
    return;
  }

  if (archivingRef.current) return;
  archivingRef.current = true;
  setArchiving(true);

  try {
    log.debug('start', {
      platform: Capacitor.getPlatform(),
      native: Capacitor.isNativePlatform(),
    });

    // 1. Let the UI settle (remove any active focus/keyboard)
    await new Promise(requestAnimationFrame);
    await new Promise(resolve => setTimeout(resolve, 200));

    const isiOS = Capacitor.getPlatform() === 'ios';

    // 2. SINGLE capture call with lower scale for iOS
    const canvas = await html2canvas(graphRef.current, {
      backgroundColor: '#ffffff',
      scale: isiOS ? 0.8 : 1.5,
      useCORS: true,
      logging: false,
      removeContainer: true,
    });

    log.debug('captured canvas');

    // 3. Convert to blob (more memory efficient than toDataURL)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png', 0.9)
    );
    if (!blob) throw new Error('Failed to create PNG blob');

    const base64 = await blobToBase64(blob);

    log.debug('encoded png', { base64Len: base64.length });

    // 4. Cleanup Canvas Memory immediately
    canvas.width = 0;
    canvas.height = 0;

    log.debug('cleared canvas');

    // 5. Breathe before Native Bridge calls
    await new Promise(resolve => setTimeout(resolve, 100));

    // ----------------------------
    // Compute date range (from your original code)
    // ----------------------------
    const currentDate = new Date();
    const dayMap: Record<string, number> = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    };

    const targetDay = injectionDay
      ? dayMap[injectionDay.toLowerCase().slice(0, 3)] ?? 1
      : 1;

    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    });

    const dayMap2: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    const currentDay = dayMap2[fmt.format(currentDate) as keyof typeof dayMap2] ?? 0;

    let daysBack = currentDay - targetDay;
    if (daysBack < 0) daysBack += 7;

    const anchorDate = new Date(currentDate);
    anchorDate.setDate(anchorDate.getDate() - daysBack);
    anchorDate.setHours(0, 0, 0, 0);

    const fromDate = anchorDate.toISOString();
    const toDate = new Date(anchorDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    log.debug('computed range', { fromDate, toDate });

    const dataJson = JSON.stringify({
      timezone,
      injectionDay,
      points: graphPoints,
    });

    log.debug('prepared dataJson', { dataJsonLen: dataJson.length });

    // ----------------------------
    // SAVE IMAGE AS REAL FILE
    // ----------------------------
    const fileBase = `glp1-graph-${Date.now()}`;
    const relPath = `glp1-graph/${fileBase}.png`;

    const directory = Capacitor.isNativePlatform() ? Directory.Data : Directory.Cache;

    log.debug('writing file', { relPath, directory });

    await Filesystem.writeFile({
      path: relPath,
      data: base64,
      directory,
      recursive: true,
    });

    log.debug('wrote file');

    const { uri } = await Filesystem.getUri({ path: relPath, directory });

    log.debug('got uri', { uri });

    if (!uri) throw new Error('Could not resolve file URI');

    log.debug('saving db row');

    await saveGlp1GraphArchive(
      userId,
      timezone,
      injectionDay || 'Monday',
      fromDate,
      toDate,
      uri, // chart_uri
      dataJson
    );

    log.debug('saved db row');

    await new Promise((resolve) => setTimeout(resolve, 1000));
log.debug('1 second pause complete, bridge should be clear now');

// THEN dispatch and navigate
window.dispatchEvent(new Event('glp1-archive:changed'));

await new Promise((resolve) => setTimeout(resolve, 500));
log.debug('cooldown finished, navigating...');

requestAnimationFrame(() => {
  setTimeout(() => {
    router.push(`/glp1-graph/archive?ts=${Date.now()}`, 'root', 'replace');
  }, 100);
});
  } catch (error) {
    log.error('FAILED', error);
    alert('Failed to archive graph.');
  } finally {
    setArchiving(false);
    archivingRef.current = false;
  }
}, [userId, graphPoints, injectionDay, timezone, router]);

  const handleOpenArchive = useCallback((): void => {
    router.push('/glp1-graph/archive', 'forward');
  }, [router]);

  if (!userId) {
    return (
      <IonPage>
        <TopNav />
        <IonContent fullscreen className={styles.contentPad}>
          <p>Please sign in to log medication experience.</p>
        </IonContent>
        <BottomNav />
      </IonPage>
    );
  }

  const rotatedDays = rotateWeekFromInjectionDay(injectionDay);

  return (
    <IonPage>
      <TopNav />
      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.container}>
          <div aria-hidden className={styles.endSpacer} />

          <div className={styles.page}>
            <h1 className={styles.pageTitle}>Medication Experience</h1>
            <h2 className={styles.pageSubTitle}>Hunger &amp; Nausea rating</h2>

            {/* ===================== TRACKER CARD ===================== */}
            <div className={styles.card}>
              <div className={styles.cardTitle}>📝 Log how you feel</div>

              <div className={styles.formGroup}>
                <label htmlFor="hungerRange" className={styles.label}>
                  Hunger
                </label>
                <input
                  id="hungerRange"
                  type="range"
                  min={1}
                  max={10}
                  value={hunger}
                  onChange={(e) => setHunger(clamp(Number(e.target.value), 1, 10))}
                />
                <div className={styles.value}>{hunger} / 10</div>
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="nauseaRange" className={styles.label}>
                  Nausea
                </label>
                <input
                  id="nauseaRange"
                  type="range"
                  min={0}
                  max={10}
                  value={nausea}
                  onChange={(e) => setNausea(clamp(Number(e.target.value), 0, 10))}
                />
                <div className={styles.value}>{nausea} / 10</div>
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="experienceTime" className={styles.label}>
                  When
                </label>
                <input
                  id="experienceTime"
                  type="datetime-local"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={styles.inputField}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="experienceNote" className={styles.label}>
                  Note (optional)
                </label>
                <textarea
                  id="experienceNote"
                  value={note}
                  placeholder="Optional note about how you felt"
                  onChange={(e) => setNote(e.target.value)}
                  className={styles.inputField}
                />
              </div>

              <IonButton expand="block" onClick={submit}>
                Log experience
              </IonButton>
            </div>

            {/* ===================== EFFECTIVENESS CARD ===================== */}
            <div className={styles.card}>
              <div className={styles.cardTitle}>💉 Medication Effectiveness</div>

              <div className={styles.glp1Row}>
                <Glp1EffectivenessRing
                  percent={glp1Pct}
                  ariaLabel={`Estimated medication effectiveness ${glp1Pct} percent`}
                />
                <div className={styles.glp1Text}>
                  <strong>{medicationName}</strong>
                  <div className={styles.muted}>
                    Estimated effectiveness in your body since last dose
                  </div>
                </div>
              </div>
            </div>

            {/* ===================== GRAPH CARD ===================== */}
            <div className={styles.card}>
              <div className={styles.cardTitle}>📈 Hunger &amp; Nausea Trend</div>

              <div ref={graphRef}>
                <GraphCard points={graphPoints} injectionDay={injectionDay} timezone={timezone} />
              </div>

              <div className={styles.buttonRow}>
                <IonButton
                  expand="block"
                  onClick={handleArchiveGraph}
                  disabled={archiving || graphPoints.length === 0}
                >
                  {archiving ? 'Saving...' : 'Save summary to Archive'}
                </IonButton>

                <IonButton expand="block" fill="outline" onClick={handleOpenArchive}>
                  Open Archive
                </IonButton>
              </div>
            </div>

            {/* ===================== TYPICAL PATTERN CARD (GENERAL) ===================== */}
            <div className={styles.card}>
              <div className={styles.cardTitle}>🧭 Typical weekly pattern (general)</div>

              <p className={styles.helperText}>
                This is a <strong>general</strong> pattern many people report on weekly GLP-1s.
                It's not your data. Your experience may differ based on dose, titration, food choices, and sensitivity.
              </p>

              <div className={styles.patternList}>
                {rotatedDays.map((d, i) => {
                  const row = TYPICAL_PATTERN[d];
                  const label = i === 0 ? `${d} (injection day)` : d;

                  return (
                    <div key={d} className={styles.patternRow}>
                      <div className={styles.patternDay}>{label}</div>

                      <div className={styles.patternMeta}>
                        <div>
                          <strong>Hunger:</strong> {row.hunger}
                        </div>
                        <div>
                          <strong>Nausea:</strong> {row.nausea}
                        </div>
                      </div>

                      <div className={styles.patternNote}>{row.note}</div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.patternSummary}>
                <strong>Curve summary:</strong> hunger often drops after the dose → stays low mid-week → rises toward the weekend.
                Nausea often peaks 24–48 hours after the dose → fades by late week.
              </div>
            </div>
          </div>

          <div aria-hidden className={styles.endSpacer} />
        </div>
      </IonContent>
      <BottomNav />
    </IonPage>
  );
};

export default Effectiveness;

