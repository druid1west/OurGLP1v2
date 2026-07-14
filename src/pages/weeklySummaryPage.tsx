// src/pages/WeeklySummaryPage.tsx
import { logger } from '../utils/logger';
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { IonPage, IonContent, useIonRouter } from "@ionic/react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { IonButton } from '@ionic/react';
import { Switch } from "../components/ui/switch";

import { toast } from "sonner";
import { Loader2, Info } from "lucide-react";

import styles from "./weeklySummaryPage.module.css";

import { getAnchoredWeek, zonedLocalToUtcISO } from "../lib/time";
import type { WeekdayFull } from "../lib/time";

import TopNav from "../context/TopNav";
import BottomNav from "../context/BottomNav";
import { useAuth } from "../context/useAuth";

// Local DB (weekly-summary)
import {
  getPrefs,
  findArchiveByWindow,
  insertArchive,
  upsertChart,
  getMoodWeekAmPmSeries,
  savePrefs,
} from "../db/WeeklySummaryRepository";
import { getPrimaryProtocol, type Protocol } from "../db/ProtocolRepository";

// Health repo (local DB)
import {
  getFastingRange,
  listHealthLogs,
  listHealthLogsRange,
  listExercises,
  listHealthDailySummariesRange,
  getWeeklyProteinIntake,
  getWeeklyHydrationIntake,
  type HealthDailySummary,
  type WeeklyHydrationRow,
} from "../db/HealthRepository";
import { listSleepLogsRange } from "@/db/SleepRepository";
import {
  listGlp1ExperienceRange,
  type Glp1GraphPoint,
} from "../db/EffectivenessRepository";

// Chart helpers (offscreen canvas -> base64 PNG)
import {
  makeBarChartPng,
  makeBloodPressureChartPng,
  makeBloodSugarChartPng,
  makeMoodAmPmChartPng,
} from "../lib/chartsPng";

import {
  computeProteinRange, type ProteinRange,
  computeHydrationRange, type HydrationRange,
  getSleepColor, 
} from "../lib/nutrition";
import { nutritionFromLogData } from "../lib/nutritionLog";

import { onHealthChange, offHealthChange, type HealthEventKind } from "../services/healthBus";
import Glp1TrendGraph from "../components/Glp1TrendGraph";
import { getGlp1VisibleWeekPoints } from "../lib/glp1Trend";
import { listStrengthWorkouts, strengthWorkoutSummary } from "../db/StrengthWorkoutRepository";

/* -----------------------------
   Types (local)
----------------------------- */
type Tz = string;

type WeekWindow = {
  start: string;
  end: string;
  tz: Tz;
};

type ProtocolWeekKind = "weekly" | "daily" | "fallback";

type ProtocolWeekContext = {
  window: WeekWindow;
  kind: ProtocolWeekKind;
  startDay: WeekdayFull;
  startTime: string;
  categoryLabel: string;
  adherenceLabel: string;
  windowNote: string;
  protocol: Protocol | null;
};

type Charts = {
  protein?: string;
  hydration?: string;
  bloodPressure?: string;
  bloodSugar?: string;
  bowel?: string;
  exercise?: string;
  mood?: string;
  fasting?: string;
};
type MetricKey = keyof Charts;

type Include = {
  protein: boolean;
  hydration: boolean;
  bloodPressure: boolean;
  bloodSugar: boolean;
  bowel: boolean;
  exercise: boolean;
  mood: boolean;
  fasting: boolean;
  injection: boolean;
};

type FastingStats = {
  targetHours?: number | null;
  avgHours?: number | null;
  daysMetTarget?: number | null;
  days?: Array<{ day: string; met: boolean; hours?: number | null }>;
};

type Anchor = {
  type: "taken" | "scheduled" | "fallback" | "override";
  used: string;
  takenAt: string | null;
  scheduledAt: string | null;
};

type WeeklyPayload = {
  window: WeekWindow;
  charts: Charts;
  includePrefs: Include;
  summaryBullets: string[];
  injectionTakenAt?: string | string[];
  fasting?: FastingStats;
  profile: {
    injectionDay: string;
    injectionTime: string; // HH:MM
    timezone: string;
    fastingSchedule?: string | null;
  };
  anchor?: Anchor;
};

type WinParams = { from: string; to: string; tz: string };

export type FastingRangeRow = {
  day: string;
  first_meal_at: string | null;
  last_meal_at: string | null;
};

/* -----------------------------
   Small chart aggregation utils
----------------------------- */
type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
const DAY_KEYS: DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDaysYmd(ymdStr: string, days: number): string {
  const [y, m, d] = ymdStr.split("-").map((part) => Number(part));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymdStr;
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function localYmdFromIso(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function ymdToDayKey(ymdStr: string): DayKey {
  const d = new Date(`${ymdStr}T12:00:00`);
  const k = d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3);
  const map: Record<string, DayKey> = {
    Mon: "Mon",
    Tue: "Tue",
    Wed: "Wed",
    Thu: "Thu",
    Fri: "Fri",
    Sat: "Sat",
    Sun: "Sun",
  };
  return map[k] ?? "Mon";
}
function zeros(): number[] {
  return [0, 0, 0, 0, 0, 0, 0];
}

function fullToDayKey(d: WeekdayFull | ""): DayKey {
  switch (d) {
    case "Monday": return "Mon";
    case "Tuesday": return "Tue";
    case "Wednesday": return "Wed";
    case "Thursday": return "Thu";
    case "Friday": return "Fri";
    case "Saturday": return "Sat";
    case "Sunday": return "Sun";
    default: return "Mon";
  }
}

function rotateToStart<T>(arr: readonly T[], startIdx: number): T[] {
  if (startIdx <= 0) return arr.slice() as T[];
  return [...arr.slice(startIdx), ...arr.slice(0, startIdx)];
}

// helper (file-level)
function exerciseMinutes(dateYmd: string, start: string, end: string): number | null {
  // "YYYY-MM-DD", "HH:MM[:SS]"
  const s = Date.parse(`${dateYmd}T${start}`);
  const e = Date.parse(`${dateYmd}T${end}`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  let mins = Math.round((e - s) / 60000);
  if (mins < 0) mins += 24 * 60; // cross-midnight safety
  return Math.max(0, mins);
}

/* ---------- Raw health rows -> normalized logs (strict) ---------- */
type RawHealthRow = {
  id: number;
  entry_type: string;
  recorded_at: string;
  data_json?: string | null;
  created_at?: string;
};

type ExerciseRow = {
  id?: number;
  exercise_date: string | null; // "YYYY-MM-DD"
  start_time: string | null; // "HH:MM" or "HH:MM:SS"
  end_time: string | null; // same as above
  duration_minutes?: number | null;
  calories_burned?: number | null;
  exercise_type?: string | null;
};

type Log = {
  type:
    | "protein"
    | "hydration"
    | "exercise"
    | "mood"
    | "bowel"
    | "blood_sugar"
    | "blood_pressure";
  at: string;
  value?: number | null;
  systolic?: number | null;
  diastolic?: number | null;
};

type ArchiveSnapshot = {
  version: 1;
  profile?: {
    weight?: number | null;
    bmi?: number | null;
    weightUnit?: string | null;
    medicationName?: string | null;
    medicationDose?: string | null;
  };
  protocol?: {
    id?: number;
    name?: string;
    cadenceType?: string;
    routeType?: string;
    doseTime?: string | null;
    anchorDay?: string | null;
    weekKind?: ProtocolWeekKind;
  };
  protein?: {
    buckets: number[];
    labels?: DayKey[];
    range?: ProteinRange | null;
    total?: number;
  };
  hydration?: {
    buckets: number[];
    labels?: DayKey[];
    range?: HydrationRange | null;
    total?: number;
  };
  activity?: WeeklyActivitySummary;
  glp1?: WeeklyGlp1Summary;
  strength?: WeeklyStrengthSummary;
};

type WeeklyActivitySummary = {
  labels: DayKey[];
  steps: number[];
  exerciseMinutes: number[];
  activeEnergyKcal: number[];
  manualExerciseMinutes: number[];
  workouts: number[];
  syncedDays: number;
  totals: {
    steps: number;
    exerciseMinutes: number;
    activeEnergyKcal: number;
    manualExerciseMinutes: number;
    workouts: number;
  };
};

type WeeklyEnergyBalanceSummary = {
  labels: DayKey[];
  foodCalories: number[];
  movementCalories: number[];
  netCalories: number[];
  proteinGrams: number[];
  foodLogDays: number;
  movementDays: number;
  totals: {
    foodCalories: number;
    movementCalories: number;
    netCalories: number;
    proteinGrams: number;
    movementMinutes: number;
  };
};

type WeeklyGlp1Summary = {
  points: Glp1GraphPoint[];
};

export type WeeklyStrengthSummary = {
  planned: number;
  completed: number;
  partial: number;
  minutes: number;
  calories: number;
};

function inRangeYmd(dateIso: string, fromYmd: string, toYmd: string): boolean {
  const ymdStr = dateIso.slice(0, 10);
  return ymdStr >= fromYmd && ymdStr <= toYmd; // inclusive
}

/* ---------- JSON parsing helpers ---------- */
type ParsedData = {
  value?: number | null;
  amount?: number | null;
  duration?: number | null;
  mood?: number | null;
  systolic?: number | null;
  diastolic?: number | null;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object";
}

function numOrNull(x: unknown): number | null | undefined {
  const fromMixed = (s: string): number | undefined => {
    let started = false;
    let buf = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const isDigit = ch >= "0" && ch <= "9";
      const isDot = ch === ".";
      const isMinus = ch === "-" && !started;
      if (isDigit || isDot || isMinus) {
        buf += ch;
        started = true;
      } else if (started) {
        break;
      }
    }
    const n = Number(buf);
    return Number.isFinite(n) ? n : undefined;
  };

  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const direct = Number(x);
    if (Number.isFinite(direct)) return direct;
    const mixed = fromMixed(x);
    if (mixed !== undefined) return mixed;
  }
  if (x == null) return null;
  return undefined;
}

function parseDataJson(json: string | null | undefined): ParsedData {
  if (!json) return {};
  try {
    const u: unknown = JSON.parse(json);
    if (!isRecord(u)) return {};
    const firstNum = (...keys: string[]): number | null | undefined => {
      for (const key of keys) {
     
        const got = numOrNull((u as Record<string, unknown>)[key]);
        if (got !== undefined) return got;
      }
      return undefined;
    };
    return {
      value: firstNum("value", "val", "score", "reading"),
      amount: firstNum("amount", "grams", "protein_grams", "protein", "ml", "oz"),
      duration: firstNum("duration", "minutes", "mins"),
      mood: firstNum("mood", "mood_score", "score"),
      systolic: firstNum("systolic", "sys"),
      diastolic: firstNum("diastolic", "dia"),
    };
  } catch {
    return {};
  }
}

function normalizeHealthRows(
  rows: RawHealthRow[],
  fromYmd: string,
  toYmd: string
): Log[] {
  const mapType = (t: string): Log["type"] | null => {
    const k = (t || "").toLowerCase();
    if (k === "protein") return "protein";
    if (k === "hydration") return "hydration";
    if (k === "exercise") return "exercise";
    if (k === "mood") return "mood";
    if (k === "bowel") return "bowel";
    if (k === "blood_sugar" || k === "glucose" || k === "bg") return "blood_sugar";
    if (k === "blood_pressure" || k === "bp") return "blood_pressure";
    if (k === "weight" || k === "injection") return null;
    if (["water", "hydration_ml"].includes(k)) return "hydration";
    if (["workout", "exercise_minutes", "activity"].includes(k)) return "exercise";
    if (["mood_score", "wellbeing"].includes(k)) return "mood";
    if (["bm", "bowel_movement", "stool"].includes(k)) return "bowel";
    return null;
  };

  const out: Log[] = [];
  for (const r of rows) {
    const t = mapType(r.entry_type);
    if (!t) continue;
    if (!r.recorded_at || !inRangeYmd(r.recorded_at, fromYmd, toYmd)) continue;

    const data = parseDataJson(r.data_json);
    const log: Log = {
      type: t,
      at: r.recorded_at,
      value:
        typeof data.value === "number"
          ? data.value
          : typeof data.amount === "number"
          ? data.amount
          : typeof data.duration === "number"
          ? data.duration
          : typeof data.mood === "number"
          ? data.mood
          : null,
      systolic: typeof data.systolic === "number" ? data.systolic : undefined,
      diastolic: typeof data.diastolic === "number" ? data.diastolic : undefined,
    };

    out.push(log);
  }
  return out;
}

/* ---------- Safe loader for listHealthLogs (strict) ---------- */
type ListHealthLogsRange = (
  fromIsoUtc: string,
  toIsoUtc: string
) => Promise<
  Array<{
    id: number;
    entry_type: string;
    recorded_at: string;
    data: unknown;
    created_at?: string;
  }>
>;

async function safeListHealthLogs(
  fromIsoUtc: string,
  toIsoUtc: string
): Promise<RawHealthRow[]> {
  try {
    const rows = await (listHealthLogsRange as unknown as ListHealthLogsRange)(
      fromIsoUtc,
      toIsoUtc
    );
    return rows.map((r) => ({
      id: r.id,
      entry_type: r.entry_type,
      recorded_at: r.recorded_at,
      data_json: r.data == null ? null : JSON.stringify(r.data),
      created_at: r.created_at,
    }));
  } catch {
    const all = await listHealthLogs();
    const fromYmd = fromIsoUtc.slice(0, 10);
    const toYmd = toIsoUtc.slice(0, 10);
    return all
      .filter((r) => inRangeYmd(r.recorded_at, fromYmd, toYmd))
      .map((r) => ({
        id: r.id,
        entry_type: r.entry_type,
        recorded_at: r.recorded_at,
        data_json: r.data_json,
        created_at: r.created_at,
      }));
  }
}

/* -----------------------------
   Safe/typed helpers for exercises
----------------------------- */
function strOrNull(x: unknown): string | null {
  return typeof x === "string" && x.length > 0 ? x : null;
}
function numFiniteOrNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}
function toExerciseRow(u: unknown): ExerciseRow | null {
  if (!isRecord(u)) return null;
  const o = u as Record<string, unknown>;
  return {
    id: numFiniteOrNull(o.id) ?? undefined,
    exercise_date: strOrNull(o.exercise_date),
    start_time: strOrNull(o.start_time),
    end_time: strOrNull(o.end_time),
    duration_minutes: numFiniteOrNull(o.duration_minutes),
    calories_burned: numFiniteOrNull(o.calories_burned),
    exercise_type: strOrNull(o.exercise_type),
  };
}

/* ---------- buildWeeklyCharts (robust) ---------- */
async function buildWeeklyCharts(
  fromIsoUtc: string,
  toIsoUtc: string,
  anchorStartIdx: number = 0,  // rotate data arrays to align with anchored start day
  tz: string                   // NEW: bucket by this IANA timezone's local day
): Promise<{
  protein?: string;
  hydration?: string;
  exercise?: string;
  mood?: string;
  bowel?: string;
  bloodSugar?: string;
  bloodPressure?: string;
}> {
  const ymdLocal = (iso: string): string => localYmdFromIso(iso, tz);
  const fromYmd = ymdLocal(fromIsoUtc);
  const toYmd = addDaysYmd(fromYmd, 6);
  const appleActivity = await listHealthDailySummariesRange(fromYmd, toYmd);

  // 1) health_logs
  const raw = await safeListHealthLogs(fromIsoUtc, toIsoUtc);
  const logs = normalizeHealthRows(Array.isArray(raw) ? raw : [], fromYmd, toYmd);

  // 2) exercises
  const exRaw: unknown = await listExercises();
  const exRows: ExerciseRow[] = Array.isArray(exRaw)
    ? exRaw.map(toExerciseRow).filter((r): r is ExerciseRow => r !== null)
    : [];

  const exLogs: Log[] = exRows
    .filter((r) => {
      const d = r.exercise_date;
      return !!d && d >= fromYmd && d <= toYmd;
    })
    .map((r) => {
      const dateYmd = r.exercise_date!;
      const start = r.start_time ?? "00:00";
      const end = r.end_time ?? "00:00";

      const minsA = exerciseMinutes(dateYmd, start, end);
      const minsB = r.duration_minutes ?? null;
      const cal = r.calories_burned ?? null;

      const val =
        (minsA !== null ? minsA : null) ??
        (minsB !== null ? minsB : null) ??
        (cal !== null ? cal : null) ??
        1;

      const hhmm = start.slice(0, 5);
      return {
        type: "exercise",
        at: `${dateYmd}T${hhmm}`,
        value: val,
      };
    });

  const allLogs: Log[] = logs.concat(exLogs);

  // 3) buckets Mon..Sun
  const protein = zeros();
  const hydration = zeros();
  const exercise = zeros();
  const appleExercise = zeros();
  const mood = zeros();
  const bowel = zeros();
  const bloodPressureSys = zeros();
  const bloodPressureDia = zeros();

  const USE_PRESENCE_FALLBACK = true;
  const normNum = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;

  const bpSeenAtMs: number[] = [0, 0, 0, 0, 0, 0, 0];

  for (const row of allLogs) {
    // NEW: bucket by local day in the user's tz (not by UTC slice)
    const ymdStr = ymdLocal(row.at);
    const idx = DAY_KEYS.indexOf(ymdToDayKey(ymdStr));
    if (idx < 0) continue;

    const v = normNum(row.value);
    const presence = USE_PRESENCE_FALLBACK ? 1 : 0;

    switch (row.type) {
      case "protein":
        protein[idx] += v ?? presence;
        break;
      case "hydration":
        hydration[idx] += v ?? presence;
        break;
      case "exercise":
        exercise[idx] += v ?? 1;
        break;
      case "mood":
        mood[idx] += v ?? presence;
        break;
      case "bowel":
        bowel[idx] += 1;
        break;
      case "blood_sugar":
        // counts no longer needed; glucose handled in dedicated time-of-day chart below
        break;
      case "blood_pressure": {
        const t = Date.parse(row.at);
        if (!Number.isFinite(t)) break;
        if (t >= (bpSeenAtMs[idx] || 0)) {
          const sys = normNum(row.systolic);
          const dia = normNum(row.diastolic);
          if (sys !== null) bloodPressureSys[idx] = sys;
          if (dia !== null) bloodPressureDia[idx] = dia;
          bpSeenAtMs[idx] = t;
        }
        break;
      }
    }
  }

  for (const row of appleActivity) {
    const idx = DAY_KEYS.indexOf(ymdToDayKey(row.day));
    if (idx < 0) continue;
    const mins = Number(row.exerciseMinutes ?? 0);
    if (Number.isFinite(mins) && mins > appleExercise[idx]) {
      appleExercise[idx] = mins;
    }
  }

  for (let i = 0; i < 7; i += 1) {
    exercise[i] = Math.max(exercise[i], appleExercise[i]);
  }

  // 4) rotate arrays to the anchored start (e.g., Thu → Wed) so bars align with labels
  const rotateIfNeeded = <T,>(arr: T[]) =>
    anchorStartIdx > 0 ? rotateToStart(arr, anchorStartIdx) : arr;

  const proteinR         = rotateIfNeeded(protein);
  const hydrationR       = rotateIfNeeded(hydration);
  const exerciseR        = rotateIfNeeded(exercise);
  const bowelR           = rotateIfNeeded(bowel);
 
  const bloodPressureSysR= rotateIfNeeded(bloodPressureSys);
  const bloodPressureDiaR= rotateIfNeeded(bloodPressureDia);
  const axisLabels = rotateToStart(DAY_KEYS, Math.max(0, anchorStartIdx));

  /* -------- Blood Sugar: compute 4 time-of-day series (averages) --------
+     Windows (local time in the user's tz):
+       - Fasting AM: 04:00–09:00
+       - Pre-meal:   10:30–12:00 and 17:30–19:00
+       - Post-meal:  08:30–10:30, 12:30–15:00, 19:30–22:00
+       - Bedtime:    21:00–24:00
+     We average multiple readings falling into a window for a day.
+  */
  const avg = (arr: number[]) => (arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : NaN);
  const sevenArrays = () => Array.from({ length: 7 }, () => [] as number[]);
  const bsFastingAMAcc = sevenArrays();
  const bsPreMealAcc   = sevenArrays();
  const bsPostMealAcc  = sevenArrays();
  const bsBedtimeAcc   = sevenArrays();

  // local hour:minute helper
  const localHM = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(iso));
    const hh = Number(parts.find(p=>p.type==="hour")?.value ?? "0");
    const mm = Number(parts.find(p=>p.type==="minute")?.value ?? "0");
    return [hh, mm] as const;
  };
  const minutes = (h: number, m: number) => h*60 + m;
  const inRange = (min: number, a: number, b: number) => min >= a && min < b;

  for (const row of allLogs) {
    if (row.type !== "blood_sugar") continue;
    const dayLocal = ymdLocal(row.at);
    const di = DAY_KEYS.indexOf(ymdToDayKey(dayLocal));
    if (di < 0) continue;
    const v = typeof row.value === "number" && Number.isFinite(row.value) ? row.value : NaN;
    if (!Number.isFinite(v)) continue;
    const [h,m] = localHM(row.at);
    const t = minutes(h,m);
    // Fasting AM: 04:00–09:00
    if (inRange(t, 4*60, 9*60)) bsFastingAMAcc[di].push(v);
    // Pre-meal: 10:30–12:00 or 17:30–19:00
    if (inRange(t, 10*60+30, 12*60) || inRange(t, 17*60+30, 19*60)) bsPreMealAcc[di].push(v);
    // Post-meal: 08:30–10:30, 12:30–15:00, 19:30–22:00
    if (inRange(t, 8*60+30, 10*60+30) || inRange(t, 12*60+30, 15*60) || inRange(t, 19*60+30, 22*60)) {
      bsPostMealAcc[di].push(v);
    }
    // Bedtime: 21:00–24:00
    if (inRange(t, 21*60, 24*60)) bsBedtimeAcc[di].push(v);
  }

  const bsFastingAM = bsFastingAMAcc.map(avg);
  const bsPreMeal   = bsPreMealAcc.map(avg);
  const bsPostMeal  = bsPostMealAcc.map(avg);
  const bsBedtime   = bsBedtimeAcc.map(avg);

 


  // 5) render PNGs from rotated arrays (anchor-day aware)
  const proteinPng = makeBarChartPng({ values: proteinR });
  const hydrationPng = makeBarChartPng({ values: hydrationR });
  const exercisePng = makeBarChartPng({ values: exerciseR });
  const bowelPng = makeBarChartPng({ values: bowelR });
 // New: blood sugar line chart with 4 time-of-day series
 const sugarPng = makeBloodSugarChartPng(
  [
    {
      label: "Fasting AM",
      values: rotateIfNeeded(bsFastingAM),
    },
    {
      label: "Pre-meal",
      values: rotateIfNeeded(bsPreMeal),
    },
    {
      label: "Post-meal",
      values: rotateIfNeeded(bsPostMeal),
    },
    {
      label: "Bedtime",
      values: rotateIfNeeded(bsBedtime),
    },
  ],
  {
    labels: axisLabels,
    unit: "mg/dL", // or "mmol/L"
  }
);



   // 🔁 NEW: blood pressure with clear axes, mmHg scale, and legend
  const bpPng = makeBloodPressureChartPng(
    bloodPressureSysR,
    bloodPressureDiaR,
    {
      labels: axisLabels,
      yMin: 50,
      yMax: 180,
      yAxisLabel: "mmHg",
      yTickStep: 10,
      drawLegend: true,
      legendPosition: "top-right",
    }
  );

  // 🔁 NEW: Mood AM/PM dual-line chart (averages per day)
  // compute AM/PM series via repo (already local-time & anchor aware)
  const moodSeries = await getMoodWeekAmPmSeries(fromIsoUtc, toIsoUtc, tz, Math.max(0, anchorStartIdx));
  const moodPng = makeMoodAmPmChartPng(moodSeries.am as number[], moodSeries.pm as number[], {
    labels: axisLabels,
  });

  return {
    protein: proteinPng,
    hydration: hydrationPng,
    exercise: exercisePng,
    mood: moodPng,
    bowel: bowelPng,
    bloodPressure: bpPng,
    bloodSugar: sugarPng,
  };
}

function buildWeeklyActivitySummary(
  fromIsoUtc: string,
  tz: string,
  anchorStartIdx: number,
  exercises: ExerciseRow[],
  appleRows: HealthDailySummary[]
): WeeklyActivitySummary {
  const startYmd = localYmdFromIso(fromIsoUtc, tz);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDaysYmd(startYmd, index));
  const dayToIndex = new Map(weekDays.map((day, index) => [day, index]));

  const steps = zeros();
  const exerciseMins = zeros();
  const activeEnergy = zeros();
  const manualMins = zeros();
  const workouts = zeros();

  for (const row of exercises) {
    const day = row.exercise_date ?? "";
    const idx = dayToIndex.get(day);
    if (idx == null) continue;
    const minsA = exerciseMinutes(day, row.start_time ?? "00:00", row.end_time ?? "00:00");
    const minsB = row.duration_minutes ?? null;
    const mins = minsA ?? minsB ?? 0;
    manualMins[idx] += Number.isFinite(mins) ? Math.max(0, mins) : 0;
    activeEnergy[idx] += Math.max(0, Math.round(Number(row.calories_burned ?? 0) || 0));
  }

  for (const row of appleRows) {
    const idx = dayToIndex.get(row.day);
    if (idx == null) continue;
    steps[idx] = Math.max(steps[idx], Math.round(Number(row.steps ?? 0) || 0));
    exerciseMins[idx] = Math.max(exerciseMins[idx], Math.round(Number(row.exerciseMinutes ?? 0) || 0));
    activeEnergy[idx] = Math.max(activeEnergy[idx], Math.round(Number(row.activeEnergyKcal ?? 0) || 0));
    workouts[idx] = Math.max(workouts[idx], Math.round(Number(row.workouts ?? 0) || 0));
  }

  for (let i = 0; i < 7; i += 1) {
    exerciseMins[i] = Math.max(exerciseMins[i], manualMins[i]);
  }

  const rotate = <T,>(values: readonly T[]) => rotateToStart(values, Math.max(0, anchorStartIdx));
  const rotatedSteps = rotate(steps);
  const rotatedExercise = rotate(exerciseMins);
  const rotatedEnergy = rotate(activeEnergy);
  const rotatedManual = rotate(manualMins);
  const rotatedWorkouts = rotate(workouts);

  const sum = (values: readonly number[]) => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);

  return {
    labels: rotate(DAY_KEYS) as DayKey[],
    steps: rotatedSteps,
    exerciseMinutes: rotatedExercise,
    activeEnergyKcal: rotatedEnergy,
    manualExerciseMinutes: rotatedManual,
    workouts: rotatedWorkouts,
    syncedDays: appleRows.filter((row) => dayToIndex.has(row.day)).length,
    totals: {
      steps: sum(rotatedSteps),
      exerciseMinutes: sum(rotatedExercise),
      activeEnergyKcal: sum(rotatedEnergy),
      manualExerciseMinutes: sum(rotatedManual),
      workouts: sum(rotatedWorkouts),
    },
  };
}

function parseJsonRecord(json?: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildWeeklyEnergyBalanceSummary(
  fromIsoUtc: string,
  tz: string,
  anchorStartIdx: number,
  healthRows: RawHealthRow[],
  exercises: ExerciseRow[]
): WeeklyEnergyBalanceSummary {
  const startYmd = localYmdFromIso(fromIsoUtc, tz);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDaysYmd(startYmd, index));
  const dayToIndex = new Map(weekDays.map((day, index) => [day, index]));
  const foodCalories = zeros();
  const proteinGrams = zeros();
  const movementCalories = zeros();
  const movementMinutes = zeros();
  const foodDays = new Set<string>();
  const movementDays = new Set<string>();

  for (const row of healthRows) {
    if (row.entry_type !== "protein") continue;
    const ymd = localYmdFromIso(row.recorded_at, tz);
    const idx = dayToIndex.get(ymd);
    if (idx == null) continue;
    const nutrition = nutritionFromLogData(parseJsonRecord(row.data_json));
    const calories = Math.max(0, Math.round(Number(nutrition.calories) || 0));
    const protein = Math.max(0, Math.round(Number(nutrition.protein) || 0));
    foodCalories[idx] += calories;
    proteinGrams[idx] += protein;
    if (calories > 0 || protein > 0) foodDays.add(ymd);
  }

  for (const row of exercises) {
    const ymd = row.exercise_date ?? "";
    const idx = dayToIndex.get(ymd);
    if (idx == null) continue;
    const calories = Math.max(0, Math.round(Number(row.calories_burned ?? 0) || 0));
    const minsA = exerciseMinutes(ymd, row.start_time ?? "00:00", row.end_time ?? "00:00");
    const minsB = row.duration_minutes ?? null;
    const mins = Math.max(0, Math.round(Number(minsA ?? minsB ?? 0) || 0));
    movementCalories[idx] += calories;
    movementMinutes[idx] += mins;
    if (calories > 0 || mins > 0) movementDays.add(ymd);
  }

  const netCalories = foodCalories.map((value, index) => Math.max(0, value - movementCalories[index]));
  const rotate = <T,>(values: readonly T[]) => rotateToStart(values, Math.max(0, anchorStartIdx));
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  const rotatedFood = rotate(foodCalories);
  const rotatedMovement = rotate(movementCalories);
  const rotatedNet = rotate(netCalories);
  const rotatedProtein = rotate(proteinGrams);

  return {
    labels: rotate(DAY_KEYS) as DayKey[],
    foodCalories: rotatedFood,
    movementCalories: rotatedMovement,
    netCalories: rotatedNet,
    proteinGrams: rotatedProtein,
    foodLogDays: foodDays.size,
    movementDays: movementDays.size,
    totals: {
      foodCalories: sum(rotatedFood),
      movementCalories: sum(rotatedMovement),
      netCalories: sum(rotatedNet),
      proteinGrams: sum(rotatedProtein),
      movementMinutes: sum(movementMinutes),
    },
  };
}

/* -----------------------------
   Helpers
----------------------------- */
function fmtRange(win: WeekWindow) {
  const fmt = (s: string) =>
    new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${fmt(win.start)} → ${fmt(win.end)} (${win.tz})`;
}
function toHHMM(s?: string | null): string {
  if (!s) return "08:00";
  if (s.includes("T")) return s.split("T")[1]?.slice(0, 5) || "08:00";
  return s.slice(0, 5);
}
function toFullDay(s?: string | null): WeekdayFull | "" {
  if (!s) return "";
  const t = String(s).trim();
  const fulls = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ] as const;
  if ((fulls as readonly string[]).includes(t)) return t as WeekdayFull;
  const map: Record<string, WeekdayFull> = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  };
  return map[t.slice(0, 3).toLowerCase()] || "";
}

function localDatePartsForTz(ref: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ref);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function getMondayReviewWeek(ref: Date, tz: string): { startUtc: string; endUtc: string } {
  const localYmdRef = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ref);
  const localNoon = new Date(`${localYmdRef}T12:00:00`);
  const daysBack = (localNoon.getDay() + 6) % 7;
  const mondayNoon = new Date(localNoon.getTime() - daysBack * 86_400_000);
  const { y, m, d } = localDatePartsForTz(mondayNoon, tz);
  const startUtc = zonedLocalToUtcISO(y, m, d, 0, 0, tz);
  const endUtc = new Date(Date.parse(startUtc) + 7 * 86_400_000).toISOString();
  return { startUtc, endUtc };
}

function getProtocolWeekContext(
  ref: Date,
  user: { injection_day?: string | null; injection_time?: string | null; timezone?: string | null } | null,
  protocol: Protocol | null
): ProtocolWeekContext {
  const tz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const doseTime = toHHMM(protocol?.dose_time ?? user?.injection_time);
  const isDaily = protocol?.cadence_type === "daily";
  const isWeekly = protocol?.cadence_type === "weekly";

  if (isDaily) {
    const { startUtc, endUtc } = getMondayReviewWeek(ref, tz);
    return {
      window: { start: startUtc, end: endUtc, tz },
      kind: "daily",
      startDay: "Monday",
      startTime: "00:00",
      categoryLabel: "Dose adherence",
      adherenceLabel: "Dose",
      windowNote: `Daily dose week. Reviews run Monday-Sunday${doseTime ? `; usual dose time ${doseTime}.` : "."}`,
      protocol,
    };
  }

  const anchorDay = (toFullDay(protocol?.anchor_day ?? user?.injection_day) || "Monday") as WeekdayFull;
  const { startUtc, endUtc } = getAnchoredWeek(ref, anchorDay, doseTime, tz);

  return {
    window: { start: startUtc, end: endUtc, tz },
    kind: isWeekly ? "weekly" : "fallback",
    startDay: anchorDay,
    startTime: doseTime,
    categoryLabel: isWeekly ? "Injection adherence" : "Protocol adherence",
    adherenceLabel: isWeekly ? "Injection" : "Protocol",
    windowNote: isWeekly
      ? "Anchored to your injection day & time."
      : "Using your saved protocol review week.",
    protocol,
  };
}

function getPreviousProtocolWeekContext(
  user: { injection_day?: string | null; injection_time?: string | null; timezone?: string | null } | null,
  current: ProtocolWeekContext
): ProtocolWeekContext {
  const ref = new Date(Date.parse(current.window.start) - 1_000);
  return getProtocolWeekContext(ref, user, current.protocol);
}
function resolveImgSrc(src?: string): string | undefined {
  if (!src) return undefined;
  const s = src.trim();
  if (s.startsWith("data:image/")) return s;
  if (s.startsWith("http") || s.startsWith("/")) return s;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(s)) return `data:image/png;base64,${s.replace(/\s+/g, "")}`;
  return s;
}
// Return today's local YYYY-MM-DD for a given IANA timezone
function localYmd(tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

// Fasting math (client-side)
function hhmmToMinutes(t?: string | null): number | null {
  if (!t) return null;
  const s = t.trim().slice(0, 8);
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mi = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return h * 60 + mi;
}
function fastingHoursBetween(first?: string | null, last?: string | null): number | null {
  const a = hhmmToMinutes(first);
  const b = hhmmToMinutes(last);
  if (a == null || b == null) return null;
  let fed = b - a;
  if (fed < 0) fed += 24 * 60; // cross-midnight eating window
  const fastMin = 24 * 60 - fed;
  return fastMin / 60;
}
function parseTargetFrom(f?: FastingStats, schedule?: string | null): number {
  if (typeof f?.targetHours === "number" && !Number.isNaN(f.targetHours)) return f.targetHours;
  if (schedule && /(\d{1,2})/.test(schedule)) {
    const m = schedule.match(/^(\d{1,2})/);
    if (m) return Math.max(0, Math.min(24, parseInt(m[1], 10)));
  }
  return 16;
}

// Visual accents
const CHART_ACCENTS: Record<MetricKey, { bg: string; fg: string; border: string }> = {
  protein: { bg: "#f4f0ff", fg: "#5b21b6", border: "#c4b5fd" },
  hydration: { bg: "#eff6ff", fg: "#075985", border: "#93c5fd" },
  bloodPressure: { bg: "#fef2f2", fg: "#7f1d1d", border: "#fecaca" },
  bloodSugar: { bg: "#f5f3ff", fg: "#4c1d95", border: "#ddd6fe" },
  bowel: { bg: "#fffbeb", fg: "#7c2d12", border: "#fde68a" },
  exercise: { bg: "#ecfdf5", fg: "#065f46", border: "#a7f3d0" },
  mood: { bg: "#fff7ed", fg: "#7c2d12", border: "#fed7aa" },
  fasting: { bg: "#f0fdfa", fg: "#115e59", border: "#99f6e4" },
};
function cardAccent(metric?: MetricKey): React.CSSProperties | undefined {
  if (!metric) return undefined;
  const a = CHART_ACCENTS[metric];
  return { borderTop: `3px solid ${a?.border}` };
}

/* -----------------------------
   Compact weekday axis (inline styles)
----------------------------- */
const WeekAxis: React.FC<{ labels: readonly string[] }> = ({ labels }) => {
  return (
    <div className={styles.weekAxis}>
      {labels.map((label, i) => (
        <span key={`${label}-${i}`} className={styles.weekAxisLabel}>
          {label.length > 3 ? label.slice(0, 3) : label}
        </span>
      ))}
    </div>
  );
};



/* -----------------------------
   Sleep chart card (anchored + rotated, offset bar 0–24h)
----------------------------- */
const SleepChartCard: React.FC<{
  startUtc: string;
  tz: string;
  injectionDay: WeekdayFull;
}> = ({ startUtc, tz, injectionDay }) => {
  type SleepCol = Readonly<{ day: string; startHour: number | null; durationHours: number | null }>;

  const [cols, setCols] = React.useState<SleepCol[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [avgHours, setAvgHours] = React.useState<number>(0);

  // convert ISO -> local minutes since midnight in a given IANA tz
  const isoToLocalMinutes = React.useCallback((iso: string, zone: string): number | null => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(d);
    const hh = Number(parts.find(p => p.type === "hour")?.value ?? "0");
    const mm = Number(parts.find(p => p.type === "minute")?.value ?? "0");
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return Math.max(0, Math.min(23 * 60 + 59, hh * 60 + mm));
  }, []);

  // UTC ISO -> local YYYY-MM-DD in given tz
  const toLocalYmd = React.useCallback((isoUtc: string): string => {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(isoUtc));
  }, [tz]);

  // Build the 7 local dates that belong to the anchored window (start + 0..6 days)
  const weekLocalDays = React.useMemo(() => {
    const startYmd = toLocalYmd(startUtc);
    const base = new Date(`${startYmd}T00:00:00Z`);
    const out: string[] = [];
    for (let i = 0; i < 7; i++) out.push(ymd(new Date(base.getTime() + i * 86400000)));
    return out;
  }, [startUtc, toLocalYmd]);

  const load = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    setErr(null);
    try {
      // Helper: local YYYY-MM-DD -> previous day
      const prevYmd = (ymdStr: string): string => {
        const d = new Date(`${ymdStr}T00:00:00`);
        d.setDate(d.getDate() - 1);
        return ymd(d);
      };

      const fromYmdLocal = weekLocalDays[0];
      const toYmdLocal = weekLocalDays[6];

      // Include the night *before* the anchored week so that
      // 3→4 gets counted for Thursday (4th) if 4th is week start.
      const extendedFromYmdLocal = prevYmd(fromYmdLocal);

      const rows = await listSleepLogsRange(extendedFromYmdLocal, toYmdLocal);

      // Group by anchor day (sleep_date)
      const perDay: Record<string, { startMin: number | null; endMin: number | null }> = {};
      for (const d of weekLocalDays) perDay[d] = { startMin: null, endMin: null };

      // Helper: get local YYYY-MM-DD from an ISO timestamp in tz
      const isoToLocalYmd = (iso: string, zone: string): string => {
        return new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(iso));
      };

      for (const r of rows) {
        if (!r.sleep_at || !r.wake_at) continue;

        const sMin = isoToLocalMinutes(r.sleep_at, tz);
        const wMin = isoToLocalMinutes(r.wake_at, tz);
        if (sMin == null || wMin == null) continue;

        // Local wake day (what we want to count against)
        const wakeYmd = isoToLocalYmd(r.wake_at, tz);
        if (!perDay[wakeYmd]) {
          // wake outside of the anchored week → ignore
          continue;
        }

        // handle cross-midnight (wake <= sleep)
        const start = sMin;
        const end = wMin <= sMin ? wMin + 24 * 60 : wMin;

        const cur = perDay[wakeYmd];
        perDay[wakeYmd] = {
          startMin: cur.startMin == null ? start : Math.min(cur.startMin, start),
          endMin:   cur.endMin   == null ? end   : Math.max(cur.endMin,   end),
        };
      }

      // Build columns, rotate to injection day
      const colsUnrotated: SleepCol[] = weekLocalDays.map((d) => {
        const span = perDay[d];
        if (!span || span.startMin == null || span.endMin == null) {
          return { day: d, startHour: null, durationHours: null };
        }
        const durMin = Math.max(0, Math.min(20 * 60, span.endMin - span.startMin)); // cap 20h
        return { day: d, startHour: span.startMin / 60, durationHours: durMin / 60 };
      });

      // We already built weekLocalDays starting on the anchor day,
      // so we DO NOT rotate the data again.
      // We only derive pretty weekday labels from DAY_KEYS.
      const startIdx = DAY_KEYS.indexOf(fullToDayKey(injectionDay));
      const rotatedLabels = rotateToStart(DAY_KEYS, Math.max(0, startIdx));

      const labeledCols: SleepCol[] = colsUnrotated.map((c, i) => ({
        day: rotatedLabels[i],        // e.g. Thu, Fri, Sat, ...
        startHour: c.startHour,
        durationHours: c.durationHours,
      }));

      setCols(labeledCols);

      // Average across days that have data
      const hrs = labeledCols.map(c => c.durationHours ?? 0).filter(v => v > 0);
      const avg = hrs.length ? Number((hrs.reduce((s, v) => s + v, 0) / hrs.length).toFixed(1)) : 0;
      setAvgHours(avg);
    } catch (e) {
      logger.warn("[WeeklySummary] sleep load failed", e);
      setErr("Failed to load sleep logs.");
      setCols([]);
      setAvgHours(0);
    } finally {
      setLoading(false);
    }
  }, [weekLocalDays, tz, isoToLocalMinutes, injectionDay]);

  React.useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener("sleep:changed", onChanged);
    return () => window.removeEventListener("sleep:changed", onChanged);
  }, [load]);

  

  return (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.25 }}
  >
    <Card className={`${styles.card} ${styles.sleepCard}`}>
      <CardHeader className={`${styles.cardHeader} ${styles.sleepHeader}`}>
        <CardTitle className={`${styles.cardTitle} ${styles.sleepTitle}`}>
          Sleep — hours per day (anchored week)
        </CardTitle>
      </CardHeader>

      <CardContent className={styles.cardContent}>
        {loading ? (
          <p className={`${styles.muted} ${styles.noMargin}`}>Loading…</p>
        ) : err ? (
          <p className={`${styles.errorBox} ${styles.noMargin}`}>{err}</p>
        ) : cols.every((c) => !c.durationHours) ? (
          <div className={styles.muted}>No complete sleep sessions in this anchored week.</div>
        ) : (
          <>
            <div className={styles.sleepBarsRow}>
              {/* Y-Axis */}
              <div className={styles.sleepYAxis}>
                {[0, 6, 12, 18, 24].map((h) => {
                  const pos = Math.round((h / 24) * 100);
                  return (
                    <div key={h} className={`${styles.sleepYTick} ${styles[`sleepYTick${pos}`]}`}>
                      {h}h
                    </div>
                  );
                })}
              </div>

              {/* 7 Columns */}
              <div className={styles.sleepCols}>
                {cols.map((c) => {
                  const h = c.durationHours ?? 0;
                  const color = getSleepColor(h);
                  
                  // Calculate height percentage (0-100)
                  const heightPct = Math.round(Math.max(0, Math.min(100, (h / 24) * 100)));
                  
                  // Get the class name for this specific height
                  const heightClass = styles[`height${heightPct}`];
                  const colorClass = styles[`sleepBar_${color}`];

                  return (
                    <div key={String(c.day)} className={styles.sleepCol}>
                      <div className={styles.sleepColInner}>
                        {h > 0 && (
                          <>
                            <div 
                              className={`${styles.sleepBar} ${colorClass} ${heightClass}`} 
                              title={`${c.day}: ${h.toFixed(1)}h`}
                            />
                            {heightPct >= 15 && (
                              <div className={styles.sleepOverlay}>
                                <span className={`${styles.sleepOverlayText} ${styles[`sleepText_${color}`]}`}>
                                  {h.toFixed(1)}h
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.weekAxisWrapper}>
              <div className={styles.weekAxisSpacer} />
              <div className={styles.weekAxisContainer}>
                <WeekAxis labels={cols.map((c) => c.day)} />
              </div>
            </div>

            <div className={styles.sleepFooter}>
              <strong>Average:</strong> {avgHours} h/night •{" "}
              <strong>Logged days:</strong> {cols.filter((c) => (c.durationHours ?? 0) > 0).length}/7
            </div>
          </>
        )}
      </CardContent>
    </Card>
  </motion.div>
);
};

/* -----------------------------
   Page (Local-DB, Local-Auth)
----------------------------- */
class WeeklySummaryErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logger.error("[weekly-summary] render failed", {
      msg: error.message,
      stack: typeof error.stack === "string" ? error.stack.split("\n").slice(0, 2).join(" | ") : undefined,
      where: info.componentStack?.split("\n").filter(Boolean)[0],
    });
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <IonPage>
          <TopNav showWhenAnon />
          <IonContent fullscreen className={styles.contentPad}>
            <div className={styles.errorBox}>
              Weekly Summary could not load safely. Please try Apple Health sync again or come back after adding a new log.
            </div>
          </IonContent>
          <BottomNav />
        </IonPage>
      );
    }

    return this.props.children;
  }
}

const WeeklySummaryPageContent: React.FC = () => {
  const { user, refreshUser, isPro } = useAuth();
  const router = useIonRouter();
  const userRecord = user as unknown as Record<string, unknown> | null;
  const currentWeightUnit =
    typeof userRecord?.weight_unit === "string" ? userRecord.weight_unit : null;

  // state
  const [loading, setLoading] = useState(true);

  const [include, setInclude] = useState<Include | null>(null);
  const [winParams, setWinParams] = useState<WinParams | null>(null);
  const [primaryProtocol, setPrimaryProtocol] = useState<Protocol | null>(null);
  const [weekContext, setWeekContext] = useState<ProtocolWeekContext | null>(null);
  const [fastingRows, setFastingRows] = useState<FastingRangeRow[] | null>(null);
  const [chartImgs, setChartImgs] = useState<Charts>({}); // live chart PNGs for preview

  // numeric per-day protein buckets Mon..Sun (grams)
  const [proteinBuckets, setProteinBuckets] = useState<number[] | undefined>(undefined);
  // day labels rotated to start on injection day
  const [proteinLabels, setProteinLabels] = useState<DayKey[] | undefined>(undefined);
  // hydration per-day buckets Mon..Sun (mL)
  const [hydrationBuckets, setHydrationBuckets] = useState<number[] | undefined>(undefined);
  const [hydrationLabels, setHydrationLabels] = useState<DayKey[] | undefined>(undefined);
  const [activitySummary, setActivitySummary] = useState<WeeklyActivitySummary | undefined>(undefined);
  const [energyBalanceSummary, setEnergyBalanceSummary] = useState<WeeklyEnergyBalanceSummary | undefined>(undefined);
  const [glp1Summary, setGlp1Summary] = useState<WeeklyGlp1Summary | undefined>(undefined);
  const [strengthSummary, setStrengthSummary] = useState<WeeklyStrengthSummary | undefined>(undefined);

  // User timezone (memoized) for day-change watcher
  const tz = React.useMemo(
    () => user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [user?.timezone]
  );
  // Track today's local date so we can detect midnight rollover
  const [todayLocal, setTodayLocal] = useState<string>(() => localYmd(tz));

  // If tz changes (e.g., user updated profile), re-evaluate today's local date
  useEffect(() => {
    setTodayLocal(localYmd(tz));
  }, [tz]);

  // Day-change watcher: when local date flips, nudge charts to refresh
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const now = localYmd(tz);
      if (now !== todayLocal) {
        setTodayLocal(now);
        window.dispatchEvent(new Event("protein:changed"));
        window.dispatchEvent(new Event("hydration:changed"));
       // Trigger all charts; sleep included
        window.dispatchEvent(new Event("sleep:changed"));
      }
    };

    const id = window.setInterval(tick, 30_000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);
    tick();
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tz, todayLocal]);

  // Health bus subscription: refresh the moment data is written to the DB
  useEffect(() => {
    const bump = (k: HealthEventKind): void => {
      switch (k) {
        case "protein": setProteinRefreshKey(v => v + 1); break;
        case "hydration": setHydrationRefreshKey(v => v + 1); break;
        case "exercise": setExerciseRefreshKey(v => v + 1); break;
        case "mood": setMoodRefreshKey(v => v + 1); break;
        case "bowel": setBowelRefreshKey(v => v + 1); break;
        case "blood_pressure": setBpRefreshKey(v => v + 1); break;
        case "blood_sugar": setBgRefreshKey(v => v + 1); break;
        case "sleep": setSleepRefreshKey(v => v + 1); break;
        case "fasting": setFastingRefreshKey(v => v + 1); break;
        case "bulk":
        case "unknown":
        default:
          // Conservative: refresh everything
          setProteinRefreshKey(v => v + 1);
          setHydrationRefreshKey(v => v + 1);
          setExerciseRefreshKey(v => v + 1);
          setMoodRefreshKey(v => v + 1);
          setBowelRefreshKey(v => v + 1);
          setBpRefreshKey(v => v + 1);
          setBgRefreshKey(v => v + 1);
          setSleepRefreshKey(v => v + 1);
          setFastingRefreshKey(v => v + 1);
      }
    };
    const handler = (e: { kind: HealthEventKind }): void => bump(e.kind);
    onHealthChange(handler);
    return () => offHealthChange(handler);
  }, []);

  // Fallback: also listen for a generic DOM CustomEvent so any
  // writer can dispatch `window.dispatchEvent(new CustomEvent("health:changed", { detail: { kind: "protein" }}))`
  useEffect(() => {
    const bump = (kind?: HealthEventKind): void => {
      switch (kind) {
        case "protein": setProteinRefreshKey(v => v + 1); break;
        case "hydration": setHydrationRefreshKey(v => v + 1); break;
        case "exercise": setExerciseRefreshKey(v => v + 1); break;
        case "mood": setMoodRefreshKey(v => v + 1); break;
        case "bowel": setBowelRefreshKey(v => v + 1); break;
        case "blood_pressure": setBpRefreshKey(v => v + 1); break;
        case "blood_sugar": setBgRefreshKey(v => v + 1); break;
        case "sleep": setSleepRefreshKey(v => v + 1); break;
        case "fasting": setFastingRefreshKey(v => v + 1); break;
        default:
          setProteinRefreshKey(v => v + 1);
          setHydrationRefreshKey(v => v + 1);
          setExerciseRefreshKey(v => v + 1);
          setMoodRefreshKey(v => v + 1);
          setBowelRefreshKey(v => v + 1);
          setBpRefreshKey(v => v + 1);
          setBgRefreshKey(v => v + 1);
          setSleepRefreshKey(v => v + 1);
          setFastingRefreshKey(v => v + 1);
      }
    };
    const onDomHealthChanged = (e: Event) => bump((e as CustomEvent)?.detail?.kind);
    window.addEventListener("health:changed", onDomHealthChanged as EventListener);
    return () => window.removeEventListener("health:changed", onDomHealthChanged as EventListener);
  }, []);

  // Trigger for refetching protein/hydration when logs change
  const [proteinRefreshKey, setProteinRefreshKey] = useState<number>(0);
  const [hydrationRefreshKey, setHydrationRefreshKey] = useState<number>(0);
  // Other charts
  const [exerciseRefreshKey, setExerciseRefreshKey] = useState<number>(0);
  const [moodRefreshKey, setMoodRefreshKey] = useState<number>(0);
  const [bowelRefreshKey, setBowelRefreshKey] = useState<number>(0);
  const [bpRefreshKey, setBpRefreshKey] = useState<number>(0);
  const [bgRefreshKey, setBgRefreshKey] = useState<number>(0);
  const [sleepRefreshKey, setSleepRefreshKey] = useState<number>(0);
  const [fastingRefreshKey, setFastingRefreshKey] = useState<number>(0);
  const [glp1RefreshKey, setGlp1RefreshKey] = useState<number>(0);
  const [profileRefreshKey, setProfileRefreshKey] = useState<number>(0);
  const [protocolRefreshKey, setProtocolRefreshKey] = useState<number>(0);

  useEffect(() => {
    const onProfileSaved = (): void => {
      void refreshUser();
      setProfileRefreshKey((n) => n + 1);
      setProteinRefreshKey((n) => n + 1);
      setHydrationRefreshKey((n) => n + 1);
      setExerciseRefreshKey((n) => n + 1);
      setMoodRefreshKey((n) => n + 1);
      setBowelRefreshKey((n) => n + 1);
      setBpRefreshKey((n) => n + 1);
      setBgRefreshKey((n) => n + 1);
      setSleepRefreshKey((n) => n + 1);
      setGlp1RefreshKey((n) => n + 1);
    };
    const onFastingChanged = (): void => {
      setFastingRefreshKey((n) => n + 1);
    };
    const onGlp1Changed = (): void => {
      setGlp1RefreshKey((n) => n + 1);
    };
    const onProtocolsChanged = (): void => {
      setProtocolRefreshKey((n) => n + 1);
      setGlp1RefreshKey((n) => n + 1);
    };
    window.addEventListener("profile:saved", onProfileSaved);
    window.addEventListener("fasting:changed", onFastingChanged);
    window.addEventListener("glp1:changed", onGlp1Changed);
    window.addEventListener("protocols:changed", onProtocolsChanged);
    return () => {
      window.removeEventListener("profile:saved", onProfileSaved);
      window.removeEventListener("fasting:changed", onFastingChanged);
      window.removeEventListener("glp1:changed", onGlp1Changed);
      window.removeEventListener("protocols:changed", onProtocolsChanged);
    };
  }, [refreshUser]);

  // minimal preview payload (uses chartImgs)
  const payload: WeeklyPayload | null = useMemo(() => {
    if (!include || !winParams || !weekContext) return null;
    const tzLocal = weekContext.window.tz;
    return {
      window: { start: weekContext.window.start, end: weekContext.window.end, tz: tzLocal },
      charts: chartImgs,
      includePrefs: include,
      summaryBullets: [],
      profile: {
        injectionDay: weekContext.startDay,
        injectionTime: weekContext.startTime,
        timezone: tzLocal,
        fastingSchedule: user?.fasting_schedule ?? null,
      },
      anchor: {
        type: "scheduled",
        used: weekContext.window.start,
        takenAt: null,
        scheduledAt: `${weekContext.startDay}T${weekContext.startTime}`,
      },
    };
  }, [include, winParams, weekContext, user?.fasting_schedule, chartImgs]);

  useEffect(() => {
    const onProteinChanged: () => void = () => {
      setProteinRefreshKey((n) => n + 1);
    };
    window.addEventListener("protein:changed", onProteinChanged);
    const onHydrationChanged: () => void = () => {
      setHydrationRefreshKey((n) => n + 1);
    };
    window.addEventListener("hydration:changed", onHydrationChanged);
    const onExerciseChanged: () => void = () => {
      setExerciseRefreshKey((n) => n + 1);
    };
    window.addEventListener("exercise:changed", onExerciseChanged);
    window.addEventListener("strength-workout:changed", onExerciseChanged);
    return () => {
      window.removeEventListener("protein:changed", onProteinChanged);
      window.removeEventListener("hydration:changed", onHydrationChanged);
      window.removeEventListener("exercise:changed", onExerciseChanged);
      window.removeEventListener("strength-workout:changed", onExerciseChanged);
    };
  }, []);

  // compute week window (anchored) + load prefs
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const protocol = user?.id ? await getPrimaryProtocol(user.id).catch(() => null) : null;
        const context = getProtocolWeekContext(new Date(), user ?? null, protocol);
        if (mounted) {
          setPrimaryProtocol(protocol);
          setWeekContext(context);
          setWinParams({ from: context.window.start, to: context.window.end, tz: context.window.tz });
        }

        // prefs
        const p = await getPrefs();
        if (mounted) {
         
          const inc: Include = {
            protein: p.protein,
            hydration: p.hydration,
            bloodPressure: p.bloodPressure,
            bloodSugar: p.bloodSugar,
            bowel: p.bowel,
            exercise: p.exercise,
            mood: p.mood,
            fasting: p.fasting,
            injection: p.injection,
          };
          setInclude(inc);
        }
      } catch (e) {
        logger.warn("[weekly-summary] init failed", e);
        toast.error("Couldn’t initialize Weekly Summary");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user, profileRefreshKey, protocolRefreshKey]);

  // load fasting rows for this window (local DB)
  useEffect(() => {
    if (!winParams || !include?.fasting) return;
    const fromDate = localYmdFromIso(winParams.from, winParams.tz);
    const toDate = addDaysYmd(fromDate, 6);
    (async () => {

      try {
        const rows = await getFastingRange(fromDate, toDate);
        const normalized: FastingRangeRow[] = Array.isArray(rows)
          ? rows.map((r) => ({
              day: r.day,
              first_meal_at: r.first_meal_at ?? null,
              last_meal_at: r.last_meal_at ?? null,
            }))
          : [];
        setFastingRows(normalized);
      } catch {
        setFastingRows([]);
      }
    })();
  }, [winParams, include?.fasting, fastingRefreshKey]);

  // build live chart PNGs for preview when week window changes
  useEffect(() => {
    if (!winParams) return;
    let cancelled = false;

    (async () => {
      try {
        const startIdx = DAY_KEYS.indexOf(fullToDayKey(weekContext?.startDay ?? "Monday"));

        // Build charts with anchor-aware rotation so the bars match the weekday axis
        const imgs = await buildWeeklyCharts(
          winParams.from,
          winParams.to,
         Math.max(0, startIdx),
          winParams.tz            
        );
        if (cancelled) return;
        setChartImgs({
          protein: imgs.protein,
          hydration: imgs.hydration,
          exercise: imgs.exercise,
          mood: imgs.mood,
          bowel: imgs.bowel,
          bloodSugar: imgs.bloodSugar,
          bloodPressure: imgs.bloodPressure,
          fasting: undefined, // fasting has its own summary card
        });
      } catch (e) {
        logger.warn("[weekly-summary] chart build failed", e);
        if (!cancelled) setChartImgs({});
      }
    })();

    return () => {
      cancelled = true;
    };
   }, [
    winParams,
    proteinRefreshKey,
    hydrationRefreshKey,
    exerciseRefreshKey,
    moodRefreshKey,
    bowelRefreshKey,
    bpRefreshKey,
    bgRefreshKey,
    sleepRefreshKey,
    weekContext?.startDay
  ]);

  useEffect(() => {
    if (!winParams) {
      setActivitySummary(undefined);
      setEnergyBalanceSummary(undefined);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const startIdx = DAY_KEYS.indexOf(fullToDayKey(weekContext?.startDay ?? "Monday"));
        const fromYmd = localYmdFromIso(winParams.from, winParams.tz);
        const toYmd = addDaysYmd(fromYmd, 6);
        const [exRaw, appleRows, healthRows, strengthRows] = await Promise.all([
          listExercises(),
          listHealthDailySummariesRange(fromYmd, toYmd),
          safeListHealthLogs(winParams.from, winParams.to),
          user?.id ? listStrengthWorkouts(user.id, fromYmd, toYmd) : Promise.resolve([]),
        ]);
        const exRows = Array.isArray(exRaw)
          ? exRaw.map(toExerciseRow).filter((row): row is ExerciseRow => row !== null)
          : [];
        const summary = buildWeeklyActivitySummary(
          winParams.from,
          winParams.tz,
          Math.max(0, startIdx),
          exRows,
          appleRows
        );
        const balance = buildWeeklyEnergyBalanceSummary(
          winParams.from,
          winParams.tz,
          Math.max(0, startIdx),
          healthRows,
          exRows
        );
        if (!cancelled) {
          setActivitySummary(summary);
          setEnergyBalanceSummary(balance);
          setStrengthSummary(strengthWorkoutSummary(strengthRows));
        }
      } catch (e) {
        logger.warn("[weekly-summary] activity summary failed", e);
        if (!cancelled) {
          setActivitySummary(undefined);
          setEnergyBalanceSummary(undefined);
          setStrengthSummary(undefined);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [winParams, exerciseRefreshKey, proteinRefreshKey, weekContext?.startDay, user?.id]);

  useEffect(() => {
    if (!winParams || !user?.id) {
      setGlp1Summary(undefined);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const fromYmd = localYmdFromIso(winParams.from, winParams.tz);
        const toYmd = addDaysYmd(fromYmd, 6);
        const userId = typeof user.id === "string" ? user.id : String(user.id);
        const rows = await listGlp1ExperienceRange(userId, fromYmd, toYmd);
        const points = rows
          .map((row) => ({
            recordedAt: row.recorded_at,
            hunger: row.hunger,
            nausea: row.nausea,
          }))
          .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

        if (!cancelled) setGlp1Summary({ points });
      } catch (e) {
        logger.warn("[weekly-summary] GLP-1 graph failed", e);
        if (!cancelled) setGlp1Summary(undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [winParams, user?.id, glp1RefreshKey]);

  
  // DEV: side-by-side sanity check (only when ?debug=1)
useEffect(() => {
  if (!winParams || !user?.id) return;
  const debug = new URLSearchParams(window.location.search).get('debug') === '1';
  if (!debug) return;

  const log = logger.child('weekly-summary');

  (async () => {
    try {
      const weekStartLocal = new Intl.DateTimeFormat('en-CA', {
        timeZone: winParams.tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(winParams.from));

      // was: logger.log("weekStartLocal", weekStartLocal);
      log.debug('weekStartLocal', { weekStartLocal, tz: winParams.tz, from: winParams.from });

      const userId = typeof user.id === 'string' ? user.id : String(user.id);
      const [protRows, hydrRows] = await Promise.all([
        getWeeklyProteinIntake(userId, weekStartLocal),
        getWeeklyHydrationIntake(userId, weekStartLocal),
      ]);

      // was: console.log / console.table / groupCollapsed
      log.debug('[repo rows]', {
        protCount: protRows?.length ?? 0,
        hydrCount: hydrRows?.length ?? 0,
        protRows,
        hydrRows,
      });

      const p = (proteinBuckets ?? []).map((v, i) => ({
        day: (proteinLabels ?? DAY_KEYS)[i],
        val: v,
      }));
      const h = (hydrationBuckets ?? []).map((v, i) => ({
        day: (hydrationLabels ?? DAY_KEYS)[i],
        val: v,
      }));

      log.debug('[UI buckets] (rotated to injection day)', { protein: p, hydration: h });
    } catch (e: unknown) {
      if (e instanceof Error) {
        log.warn('[debug] weekly-summary block failed', { message: e.message, stack: e.stack });
      } else {
        log.warn('[debug] weekly-summary block failed', { error: e });
      }
    }
  })();
}, [winParams, user?.id, proteinBuckets, hydrationBuckets, proteinLabels, hydrationLabels]);


  // fetch canonical daily protein totals and rotate to injection-day start
  useEffect(() => {
    if (!winParams || !user?.id) {
      setProteinBuckets(undefined);
      setProteinLabels(undefined);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const weekStartLocal = new Intl.DateTimeFormat("en-CA", {
          timeZone: winParams.tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(winParams.from));

        const rows = await getWeeklyProteinIntake(
          typeof user.id === "string" ? user.id : String(user.id),
          weekStartLocal
        );

        const buckets = zeros();
        for (const r of rows) {
          const dateStr = typeof (r as { date?: unknown }).date === "string" ? (r as { date: string }).date : String((r as { date?: unknown }).date ?? "");
          if (!dateStr) continue;
          const idx = DAY_KEYS.indexOf(ymdToDayKey(dateStr));
          if (idx >= 0) {
            const gramsVal = (r as { protein_grams?: unknown }).protein_grams;
            const grams =
              typeof gramsVal === "number"
                ? gramsVal
                : Number(gramsVal ?? 0);
            buckets[idx] += Number.isFinite(grams) ? grams : 0;
          }
        }
        // Fallback: if rollups are sparse, supplement from health_logs (protein)
  {
    const nonZeroCount = buckets.filter(v => v > 0).length;
    const sumAll = buckets.reduce((s, v) => s + v, 0);
    const needsFallback = sumAll > 0 ? nonZeroCount <= 1 : true;
if (needsFallback) {
  // NEW helper: UTC ISO -> local YYYY-MM-DD using current window tz
  const toLocalYmd = (iso: string): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: winParams.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));

  const fromYmd = localYmdFromIso(winParams.from, winParams.tz);
  const toYmd = addDaysYmd(fromYmd, 6);

  const raw = await safeListHealthLogs(winParams.from, winParams.to);

  // was: logger.log("RAW health logs:", raw);
  logger.debug('[weekly-summary] RAW health logs', { count: Array.isArray(raw) ? raw.length : 0, raw });

  const logs = normalizeHealthRows(Array.isArray(raw) ? raw : [], fromYmd, toYmd);

  for (const l of logs) {
    if (l.type !== 'protein') continue;
    // NEW: bucket fallback rows by local day, not UTC slice
    const dateStr = toLocalYmd(l.at);
    const idx = DAY_KEYS.indexOf(ymdToDayKey(dateStr));
    if (idx < 0) continue;
    const v = typeof l.value === 'number' && Number.isFinite(l.value) ? l.value : 0;
    buckets[idx] += v;
  }
}

  }



        const startIdx = DAY_KEYS.indexOf(fullToDayKey(weekContext?.startDay ?? "Monday"));
        const rotatedBuckets = rotateToStart(buckets, Math.max(0, startIdx));
        const rotatedLabels = rotateToStart(DAY_KEYS, Math.max(0, startIdx));
        if (!cancelled) {
          setProteinBuckets(rotatedBuckets);
          setProteinLabels(rotatedLabels);
        }
      } catch (e) {
        logger.warn("[weekly-summary] failed to load weekly protein", e);
        if (!cancelled) {
          setProteinBuckets(undefined);
          setProteinLabels(undefined);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
 }, [winParams, user?.id, weekContext?.startDay, proteinRefreshKey]);

  // hydration weekly buckets
  useEffect(() => {
    if (!winParams || !user?.id) {
      setHydrationBuckets(undefined);
      setHydrationLabels(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const weekStartLocal = new Intl.DateTimeFormat("en-CA", {
          timeZone: winParams.tz, year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date(winParams.from));

        const rows: WeeklyHydrationRow[] = await getWeeklyHydrationIntake(
          typeof user.id === "string" ? user.id : String(user.id),
          weekStartLocal
        );

        const buckets = zeros();
        for (const r of rows) {
          const dateStr = typeof r.date === "string" ? r.date : String(r.date ?? "");
          if (!dateStr) continue;
          const idx = DAY_KEYS.indexOf(ymdToDayKey(dateStr));
          if (idx >= 0) {
            const mlVal = r.hydration_ml;
            const ml = typeof mlVal === "number" ? mlVal : Number(mlVal ?? 0);
            buckets[idx] += Number.isFinite(ml) ? ml : 0;
          }
        }

        // fallback from health_logs if needed
        const nonZeroCount = buckets.filter(v => v > 0).length;
        const sumAll = buckets.reduce((s, v) => s + v, 0);
        const needsFallback = sumAll > 0 ? nonZeroCount <= 1 : true;
        if (needsFallback) {
          // NEW helper: UTC ISO -> local YYYY-MM-DD using current window tz
          const toLocalYmd = (iso: string): string =>
            new Intl.DateTimeFormat("en-CA", {
              timeZone: winParams.tz,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date(iso));
          const fromYmd = localYmdFromIso(winParams.from, winParams.tz);
          const toYmd = addDaysYmd(fromYmd, 6);
          const raw = await safeListHealthLogs(winParams.from, winParams.to);
          const logs = normalizeHealthRows(Array.isArray(raw) ? raw : [], fromYmd, toYmd);
          for (const l of logs) {
            if (l.type !== "hydration") continue;
            // NEW: bucket fallback rows by local day, not UTC slice
            const dateStr = toLocalYmd(l.at);
            const idx = DAY_KEYS.indexOf(ymdToDayKey(dateStr));
            if (idx < 0) continue;
            const v = typeof l.value === "number" && Number.isFinite(l.value) ? l.value : 0;
            buckets[idx] += v;
          }
        }

        const startIdx = DAY_KEYS.indexOf(fullToDayKey(weekContext?.startDay ?? "Monday"));
        const rotatedBuckets = rotateToStart(buckets, Math.max(0, startIdx));
        const rotatedLabels = rotateToStart(DAY_KEYS, Math.max(0, startIdx));
        if (!cancelled) {
          setHydrationBuckets(rotatedBuckets);
          setHydrationLabels(rotatedLabels);
        }
      } catch (e) {
        logger.warn("[weekly-summary] failed to load weekly hydration", e);
        if (!cancelled) {
          setHydrationBuckets(undefined);
          setHydrationLabels(undefined);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [winParams, user?.id, weekContext?.startDay, hydrationRefreshKey]);

  const rangeLabel = useMemo(
    () =>
      winParams ? fmtRange({ start: winParams.from, end: winParams.to, tz: winParams.tz }) : "",
    [winParams]
  );

  // ⬇ Persist each toggle and update local state
  const toggle = (key: keyof Include) => async (checked: boolean) => {
  if (!include) return;
  const next: Include = { ...include, [key]: checked };
  setInclude(next);
  try {
    await savePrefs(next);
  } catch (e: unknown) {
    logger.warn('[weekly-summary] savePrefs failed', {
      key,
      error: e instanceof Error ? { message: e.message, stack: e.stack } : e,
    });
  }
};
  const allOn = useMemo(
    () => (include ? Object.values(include).every(Boolean) : true),
    [include]
  );
 const setAll = async (val: boolean) => {
    if (!include) return;
    const next: Include = Object.fromEntries(
      Object.keys(include).map((k) => [k, val])
    ) as Include;
    setInclude(next);
    try {
      await savePrefs(next);
    } catch (e) {
      logger.warn("[weekly-summary] savePrefs failed (setAll)", e);
    }
  };

  const proteinRange: ProteinRange | null = useMemo(
    () => computeProteinRange(Number(user?.weight ?? 0)),
    [user?.weight]
  );
  const hydrationRange: HydrationRange | null = useMemo(
    () => computeHydrationRange(Number(user?.weight ?? 0)),
    [user?.weight]
  );

  // UI state: archive button busy + result dialog
  const [archiving, setArchiving] = useState<boolean>(false);
  const archivingRef = React.useRef<boolean>(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState<boolean>(false);
  const [archiveDialogMsg, setArchiveDialogMsg] = useState<string>("");
  const openArchiveDialog = React.useCallback((msg: string): void => {
    setArchiveDialogMsg(msg);
    setArchiveDialogOpen(true);
  }, []);
  const closeArchiveDialog = React.useCallback((): void => {
    setArchiveDialogOpen(false);
  }, []);
 

 const handleArchive = useCallback(async (): Promise<void> => {
    if (!payload || !winParams) return;
    // single-flight guard (ref is synchronous)
    if (archivingRef.current) return;
    archivingRef.current = true;
    setArchiving(true);
try {
    const chartEntries = (Object.entries(payload.charts) as [keyof Charts, string | undefined][])
      .flatMap(([metric, png]): [keyof Charts, string][] => {
        if (!png || !payload.includePrefs[metric as keyof Include]) return [];
        return [[metric, png]];
      });

    if (chartEntries.length === 0) {
      const msg = "Charts are still updating. Wait a moment, then save the summary again.";
      openArchiveDialog(msg);
      return;
    }

    // Compute basic fasting stats locally
    const target = parseTargetFrom(payload.fasting, user?.fasting_schedule ?? null);
    const computedDays: FastingStats["days"] | undefined =
      Array.isArray(fastingRows) && fastingRows.length > 0
        ? fastingRows.map((r) => {
            const hrs = fastingHoursBetween(r.first_meal_at, r.last_meal_at);
            const met = typeof hrs === "number" ? hrs >= target : false;
            return { day: r.day, met, hours: hrs ?? undefined };
          })
        : undefined;

    const daysMet = computedDays ? computedDays.filter((d) => d.met).length : undefined;
    const avg =
      computedDays && computedDays.length
        ? computedDays.reduce((acc, d) => acc + (d.hours ?? 0), 0) / computedDays.length
        : undefined;

    const fastingJson = JSON.stringify({
      targetHours: target,
      avgHours: typeof avg === "number" ? Number(avg.toFixed(2)) : null,
      daysMetTarget: daysMet ?? null,
      days: computedDays ?? null,
    });

    const snapshot: ArchiveSnapshot = {
      version: 1,
      profile: {
        weight: typeof user?.weight === "number" ? user.weight : user?.weight != null ? Number(user.weight) : null,
        bmi: typeof user?.bmi === "number" ? user.bmi : user?.bmi != null ? Number(user.bmi) : null,
        weightUnit: currentWeightUnit,
        medicationName: user?.medication_name ?? null,
        medicationDose: user?.medication_dose ?? null,
      },
    };
    if (primaryProtocol || weekContext) {
      snapshot.protocol = {
        id: primaryProtocol?.id,
        name: primaryProtocol?.name,
        cadenceType: primaryProtocol?.cadence_type,
        routeType: primaryProtocol?.route_type,
        doseTime: primaryProtocol?.dose_time ?? null,
        anchorDay: primaryProtocol?.anchor_day ?? null,
        weekKind: weekContext?.kind,
      };
    }
    if (Array.isArray(proteinBuckets) && proteinBuckets.length === 7) {
      snapshot.protein = {
        buckets: proteinBuckets,
        labels: proteinLabels && proteinLabels.length === 7 ? proteinLabels : undefined,
        range: proteinRange,
        total: proteinBuckets.reduce((sum, value) => sum + value, 0),
      };
    }
    if (Array.isArray(hydrationBuckets) && hydrationBuckets.length === 7) {
      snapshot.hydration = {
        buckets: hydrationBuckets,
        labels: hydrationLabels && hydrationLabels.length === 7 ? hydrationLabels : undefined,
        range: hydrationRange,
        total: hydrationBuckets.reduce((sum, value) => sum + value, 0),
      };
    }
    if (activitySummary) {
      snapshot.activity = activitySummary;
    }
    if (glp1Summary) {
      snapshot.glp1 = glp1Summary;
    }
    if (strengthSummary) {
      snapshot.strength = strengthSummary;
    }

    // Insert archive row
    const archiveId = await insertArchive({
      userId: user?.id ?? null,
      fromUtc: winParams.from,
      toUtc: winParams.to,
      tz: winParams.tz,
      anchor: payload.anchor
        ? {
            type: payload.anchor.type,
            used: payload.anchor.used,
            takenAt: payload.anchor.takenAt,
            scheduledAt: payload.anchor.scheduledAt,
          }
        : null,
      bullets: payload.summaryBullets,
      
      injectionTakenAt: Array.isArray(payload.injectionTakenAt)
        ? payload.injectionTakenAt[0]
        : payload.injectionTakenAt ?? null,
      fastingJson,
      snapshotJson: JSON.stringify(snapshot),
    });

    // Persist chart PNGs to weekly_summary_charts
    for (const [metric, png] of chartEntries) {
      const base64 = png.startsWith("data:image") ? png.split(",")[1] ?? "" : png;
      if (base64) {
        await upsertChart(archiveId, String(metric), base64);
      }
    }

    const msg = `Saved to archive (#${archiveId}). You can find it in the Weekly Summary → Archive.`;
    toast.success("Summary saved to local archive");
    openArchiveDialog(msg);
  } catch (e) {
    logger.warn("[archive] failed", e);
    toast.error("Save failed. Please try again.");
    openArchiveDialog("Save failed. Please try again.");
  } finally {
    setArchiving(false);
    archivingRef.current = false;
  }
  }, [
    payload,
    winParams,
    fastingRows,
    user?.fasting_schedule,
    proteinBuckets,
    proteinLabels,
    proteinRange,
    hydrationBuckets,
    hydrationLabels,
    hydrationRange,
    activitySummary,
    strengthSummary,
    glp1Summary,
    primaryProtocol,
    weekContext,
    user?.id,
    user?.weight,
    user?.bmi,
    currentWeightUnit,
    user?.medication_name,
    user?.medication_dose,
    openArchiveDialog
  ]);

  const buildArchiveSnapshotForContext = useCallback(
    async (context: ProtocolWeekContext): Promise<{ snapshot: ArchiveSnapshot; fastingJson: string | null }> => {
      const weightValue = typeof user?.weight === "number" ? user.weight : user?.weight != null ? Number(user.weight) : null;
      const userId = typeof user?.id === "string" ? user.id : user?.id != null ? String(user.id) : "";
      const fromYmd = localYmdFromIso(context.window.start, context.window.tz);
      const toYmd = addDaysYmd(fromYmd, 6);
      const startIdx = DAY_KEYS.indexOf(fullToDayKey(context.startDay));
      const rotate = <T,>(values: readonly T[]) => rotateToStart(values, Math.max(0, startIdx));

      const snapshot: ArchiveSnapshot = {
        version: 1,
        profile: {
          weight: weightValue,
          bmi: typeof user?.bmi === "number" ? user.bmi : user?.bmi != null ? Number(user.bmi) : null,
          weightUnit: currentWeightUnit,
          medicationName: user?.medication_name ?? null,
          medicationDose: user?.medication_dose ?? null,
        },
        protocol: {
          id: context.protocol?.id,
          name: context.protocol?.name,
          cadenceType: context.protocol?.cadence_type,
          routeType: context.protocol?.route_type,
          doseTime: context.protocol?.dose_time ?? null,
          anchorDay: context.protocol?.anchor_day ?? null,
          weekKind: context.kind,
        },
      };

      const proteinRows = userId ? await getWeeklyProteinIntake(userId, fromYmd) : [];
      const proteinRaw = zeros();
      for (const row of proteinRows) {
        const dateStr = String((row as { date?: unknown }).date ?? "");
        const idx = DAY_KEYS.indexOf(ymdToDayKey(dateStr));
        if (idx >= 0) {
          const gramsVal = (row as { protein_grams?: unknown }).protein_grams;
          const grams = typeof gramsVal === "number" ? gramsVal : Number(gramsVal ?? 0);
          proteinRaw[idx] += Number.isFinite(grams) ? grams : 0;
        }
      }
      const proteinSnapshotBuckets = rotate(proteinRaw);
      snapshot.protein = {
        buckets: proteinSnapshotBuckets,
        labels: rotate(DAY_KEYS) as DayKey[],
        range: weightValue ? computeProteinRange(weightValue) : null,
        total: proteinSnapshotBuckets.reduce((sum, value) => sum + value, 0),
      };

      const hydrationRows = userId ? await getWeeklyHydrationIntake(userId, fromYmd) : [];
      const hydrationRaw = zeros();
      for (const row of hydrationRows) {
        const dateStr = String(row.date ?? "");
        const idx = DAY_KEYS.indexOf(ymdToDayKey(dateStr));
        if (idx >= 0) {
          const mlVal = row.hydration_ml;
          const ml = typeof mlVal === "number" ? mlVal : Number(mlVal ?? 0);
          hydrationRaw[idx] += Number.isFinite(ml) ? ml : 0;
        }
      }
      const hydrationSnapshotBuckets = rotate(hydrationRaw);
      snapshot.hydration = {
        buckets: hydrationSnapshotBuckets,
        labels: rotate(DAY_KEYS) as DayKey[],
        range: weightValue ? computeHydrationRange(weightValue) : null,
        total: hydrationSnapshotBuckets.reduce((sum, value) => sum + value, 0),
      };

      const [exerciseRowsRaw, appleRows] = await Promise.all([
        listExercises(),
        listHealthDailySummariesRange(fromYmd, toYmd),
      ]);
      const exerciseRows = Array.isArray(exerciseRowsRaw)
        ? exerciseRowsRaw.map(toExerciseRow).filter((row): row is ExerciseRow => row !== null)
        : [];
      snapshot.activity = buildWeeklyActivitySummary(
        context.window.start,
        context.window.tz,
        Math.max(0, startIdx),
        exerciseRows,
        appleRows
      );

      if (userId) {
        const rows = await listGlp1ExperienceRange(userId, fromYmd, toYmd);
        snapshot.glp1 = {
          points: rows
            .map((row) => ({
              recordedAt: row.recorded_at,
              hunger: row.hunger,
              nausea: row.nausea,
            }))
            .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()),
        };
      }

      const target = parseTargetFrom(undefined, user?.fasting_schedule ?? null);
      const rows = await getFastingRange(fromYmd, toYmd).catch(() => []);
      const fastingDays = Array.isArray(rows)
        ? rows.map((row) => {
            const hrs = fastingHoursBetween(row.first_meal_at, row.last_meal_at);
            const met = typeof hrs === "number" ? hrs >= target : false;
            return { day: row.day, met, hours: hrs ?? undefined };
          })
        : [];
      const avg = fastingDays.length
        ? fastingDays.reduce((sum, day) => sum + (day.hours ?? 0), 0) / fastingDays.length
        : undefined;
      const fastingJson = JSON.stringify({
        targetHours: target,
        avgHours: typeof avg === "number" ? Number(avg.toFixed(2)) : null,
        daysMetTarget: fastingDays.filter((day) => day.met).length,
        days: fastingDays,
      });

      return { snapshot, fastingJson };
    },
    [
      currentWeightUnit,
      user?.bmi,
      user?.fasting_schedule,
      user?.id,
      user?.medication_dose,
      user?.medication_name,
      user?.weight,
    ]
  );

  const autoArchiveKeyRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !include || !weekContext) return;
    const previous = getPreviousProtocolWeekContext(user, weekContext);
    const key = `${user.id}:${previous.window.start}:${previous.window.end}`;
    if (autoArchiveKeyRef.current === key) return;
    autoArchiveKeyRef.current = key;

    let cancelled = false;
    (async () => {
      try {
        const existing = await findArchiveByWindow(
          previous.window.start,
          previous.window.end,
          user.id
        );
        if (existing || cancelled) return;

        const startIdx = DAY_KEYS.indexOf(fullToDayKey(previous.startDay));
        const imgs = await buildWeeklyCharts(
          previous.window.start,
          previous.window.end,
          Math.max(0, startIdx),
          previous.window.tz
        );
        if (cancelled) return;

        const chartEntries = (Object.entries(imgs) as [keyof Charts, string | undefined][])
          .flatMap(([metric, png]): [keyof Charts, string][] => {
            if (!png || !include[metric as keyof Include]) return [];
            return [[metric, png]];
          });

        const { snapshot, fastingJson } = await buildArchiveSnapshotForContext(previous);

        const archiveId = await insertArchive({
          userId: user.id,
          fromUtc: previous.window.start,
          toUtc: previous.window.end,
          tz: previous.window.tz,
          anchor: {
            type: "scheduled",
            used: previous.window.start,
            takenAt: null,
            scheduledAt: `${previous.startDay}T${previous.startTime}`,
          },
          bullets: [],
          injectionTakenAt: null,
          fastingJson,
          snapshotJson: JSON.stringify(snapshot),
        });

        for (const [metric, png] of chartEntries) {
          const base64 = png.startsWith("data:image") ? png.split(",")[1] ?? "" : png;
          if (base64) {
            await upsertChart(archiveId, String(metric), base64);
          }
        }

        toast.success("Last week was saved to Archive");
      } catch (error) {
        logger.warn("[weekly-summary] auto archive failed", {
          msg: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [buildArchiveSnapshotForContext, include, primaryProtocol, user, weekContext]);

  

  if (loading || !include || !winParams) {
    return (
      <IonPage>
        <TopNav showWhenAnon />
        <IonContent fullscreen className={styles.contentPad}>
          <div className={styles.loader}>
            <Loader2 className={styles.spinner} />
            Loading weekly summary…
          </div>
        </IonContent>
        <BottomNav />
      </IonPage>
    );
  }

  return (
    <IonPage>
      <TopNav showWhenAnon />
      <IonContent fullscreen style={{ ['--padding-top' as never]: '96px', ['--padding-bottom' as never]: '120px' }}>
        <div className={styles.container}>
          <div className={styles.page}>
            <div className={styles.grid}>
              {/* Left column */}
              <div className={styles.leftCol}>
                <Card className={styles.card}>
                  <CardHeader className={styles.cardHeader}>
                    <CardTitle className={styles.cardTitle}>Weekly window</CardTitle>
                  </CardHeader>
                  <CardContent className={`${styles.cardContent} ${styles.stackSm}`}>
                    <div className={`${styles.small} ${styles.muted}`}>
                      {weekContext?.windowNote ?? "Using your saved protocol review week."}
                    </div>
                    <div className={styles.small}>{rangeLabel}</div>
                  </CardContent>
                </Card>

                <Card className={styles.card}>
                  <CardHeader className={styles.cardHeader}>
                    <CardTitle className={styles.cardTitle}>Summary settings</CardTitle>
                  </CardHeader>
                  <CardContent className={`${styles.cardContent} ${styles.stackLg}`}>
                   

                    <div className={styles.includeAllRow}>  
                   <div className={styles.includeAllLabel}>Include all categories</div>

                      <Switch
                       checked={allOn}
                       onCheckedChange={setAll}
                       className={`${styles.switchRoot} ${styles.switchMini}`}
                           />
                       </div>

                    <div className={styles.card}>
                      <div className={`${styles.cardContent} ${styles.stackSm}`}>
                        <div className={`${styles.tiny} ${styles.muted}`}>Categories</div>

                        <CategoryRow label={weekContext?.categoryLabel ?? "Protocol adherence"} checked={include.injection} onChange={toggle("injection")} />
<CategoryRow label="Fasting window" checked={include.fasting} onChange={toggle("fasting")} />
<CategoryRow label="Protein" checked={include.protein} onChange={toggle("protein")} />
<CategoryRow label="Hydration" checked={include.hydration} onChange={toggle("hydration")} />
<CategoryRow label="Exercise" checked={include.exercise} onChange={toggle("exercise")} />
<CategoryRow label="Mood" checked={include.mood} onChange={toggle("mood")} />
<CategoryRow label="Blood pressure" checked={include.bloodPressure} onChange={toggle("bloodPressure")} sensitive />
<CategoryRow label="Blood sugar" checked={include.bloodSugar} onChange={toggle("bloodSugar")} sensitive />
<CategoryRow label="Bowel" checked={include.bowel} onChange={toggle("bowel")} sensitive />

                      </div>
                    </div>

                  
                 <div className={styles.buttonRow}>
                    
                      
                   <IonButton
                      type="button"
                        onClick={handleArchive}
                        className="custom-button"
                        data-busy={archiving ? "true" : "false"}
                        aria-busy={archiving ? "true" : "false"}
                        disabled={archiving}
                      >
                        <span className={styles.buttonInner}>
                          {archiving && (
                            <span className={styles.spinner} aria-hidden />
                          )}
                          <span>
                            {archiving ? "Saving…" : "Save summary to Archive"}
                          </span>
                        </span>
                      </IonButton>
                      
                      <IonButton
                      type="button"
                        className="custom-button"
                        onClick={() => router.push("/weekly-summary/archive", "forward")}
                      >
                        Open Archive
                      </IonButton>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right column */}
              <div className={styles.rightCol}>
                <Card className={styles.card}>
                  <CardHeader className={styles.cardHeader}>
                    <CardTitle className={styles.cardTitle}>Preview</CardTitle>
                  </CardHeader>
                  <CardContent className={styles.cardContent}>
                    {payload && (
                      <EmailPreview
                        charts={payload.charts}
                        include={payload.includePrefs}
                        bullets={payload.summaryBullets}
                        win={payload.window}
                        injectionTakenAt={payload.injectionTakenAt}
                        injectionScheduledDay={payload.profile?.injectionDay}
                        injectionScheduledTime={payload.profile?.injectionTime}
                        fasting={{
                          targetHours: parseTargetFrom(payload.fasting, user?.fasting_schedule ?? null),
                          avgHours: undefined,
                          daysMetTarget: undefined,
                        }}
                        fastingSchedule={user?.fasting_schedule ?? null}
                        fastingRows={fastingRows ?? undefined}
                        proteinBuckets={proteinBuckets}
                        proteinLabels={proteinLabels}
                        proteinRange={proteinRange ?? undefined}
                        hydrationBuckets={hydrationBuckets}
                        hydrationLabels={hydrationLabels}
                        hydrationRange={hydrationRange ?? undefined}
                        activitySummary={activitySummary}
                        energyBalanceSummary={energyBalanceSummary}
                        isPro={isPro}
                        glp1Summary={glp1Summary}
                        strengthSummary={strengthSummary}
                        adherenceLabel={weekContext?.adherenceLabel ?? "Protocol"}
                        onOpenEffectiveness={() => router.push("/effectiveness", "forward")}
                      />
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          <div aria-hidden className={styles.bottomSpacer} />

        </div>
      </IonContent>
      <BottomNav />
       {/* Lightweight result dialog */}
      {archiveDialogOpen && (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.dialog}>
            <div className={styles.dialogHeader}>Archive</div>
            <div className={styles.dialogBody}>
              {archiveDialogMsg || "Done."}
            </div>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.dialogOk}
                onClick={closeArchiveDialog}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </IonPage>
  );
};

const WeeklySummaryPage: React.FC = () => (
  <WeeklySummaryErrorBoundary>
    <WeeklySummaryPageContent />
  </WeeklySummaryErrorBoundary>
);

export default WeeklySummaryPage;
export { EmailPreview as SummaryPreview }

/* -----------------------------
   Subcomponents
----------------------------- */
function CategoryRow({
  label,
  checked,
  onChange,
  sensitive = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  sensitive?: boolean;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>
        {sensitive && (
          <span className={styles.sensitiveBadge}>
            <Info /> sensitive
          </span>
        )}
        <span>{label}</span>
      </div>

      <Switch
        checked={checked}
        onCheckedChange={onChange}
        className={`${styles.switchRoot} ${styles.switchMini}`}
      />
    </div>
  );
}

function EmailPreview({
  charts,
  include,
  bullets,
  win,
  injectionTakenAt,
  injectionScheduledDay,
  injectionScheduledTime,
  fasting,
  fastingSchedule,
  fastingRows,
  proteinBuckets,
  proteinLabels,
  proteinRange,
  hydrationBuckets,
  hydrationLabels,
  hydrationRange,
  activitySummary,
  energyBalanceSummary,
  isPro,
  glp1Summary,
  strengthSummary,
  adherenceLabel,
  onOpenEffectiveness,
}: {
  charts: Charts;
  include: Include;
  bullets: string[];
  win: WeekWindow;
  injectionTakenAt?: string | string[];
  injectionScheduledDay?: string;
  injectionScheduledTime?: string;
  fasting?: FastingStats;
  fastingSchedule?: string | null;
  fastingRows?: FastingRangeRow[];
  proteinBuckets?: number[];
  proteinLabels?: readonly DayKey[];
  proteinRange?: ProteinRange;
  hydrationBuckets?: number[];
  hydrationLabels?: readonly DayKey[];
  hydrationRange?: HydrationRange;
  activitySummary?: WeeklyActivitySummary;
  energyBalanceSummary?: WeeklyEnergyBalanceSummary;
  isPro: boolean;
  glp1Summary?: WeeklyGlp1Summary;
  strengthSummary?: WeeklyStrengthSummary;
  adherenceLabel?: string;
  onOpenEffectiveness?: () => void;
}) {
  const target = parseTargetFrom(fasting, fastingSchedule);
  const computedDays: FastingStats["days"] | undefined = Array.isArray(fastingRows) && fastingRows.length > 0
    ? fastingRows.map((r) => {
        const hrs = fastingHoursBetween(r.first_meal_at, r.last_meal_at);
        const met = typeof hrs === "number" ? hrs >= target : false;
        return { day: r.day, met, hours: hrs ?? undefined };
      })
    : fasting?.days;

  const success = Array.isArray(computedDays)
    ? computedDays.filter((d) => d.met).length
    : typeof fasting?.daysMetTarget === "number"
    ? fasting.daysMetTarget
    : undefined;

  // Compute a safe WeekdayFull for the sleep card anchor
  const injFull = (toFullDay(injectionScheduledDay) || "Monday") as WeekdayFull;

  // Rotated weekday labels to match the anchored week order
  const axisStartIdx = DAY_KEYS.indexOf(fullToDayKey(injFull));
  const axisLabels: readonly DayKey[] = rotateToStart(
    DAY_KEYS,
    Math.max(0, axisStartIdx)
  ) as readonly DayKey[];

  return (
    <div className={styles.stackLg}>
      <div className={styles.card}>
        <div className={styles.cardContent}>
          <div className={`${styles.small} ${styles.muted}`}>Week window</div>
          <div className={styles.small}>{fmtRange(win)}</div>
        </div>
      </div>

      <div className={styles.stackSm}>
        {include.injection && (
          <InjectionSummary
            takenAt={injectionTakenAt}
            scheduledDay={injectionScheduledDay}
            scheduledTime={injectionScheduledTime}
            label={adherenceLabel ?? "Injection"}
          />
        )}
        {include.fasting && (
          <FastingSummary
            targetHours={target}
            avgHours={fasting?.avgHours ?? undefined}
            daysMetTarget={success ?? undefined}
            fastingSchedule={fastingSchedule ?? null}
            days={computedDays}
          />
        )}
      </div>

      {(glp1Summary || onOpenEffectiveness) && (
        <Glp1WeeklyCard
          summary={glp1Summary}
          injectionDay={injectionScheduledDay}
          timezone={win.tz}
          onOpenEffectiveness={onOpenEffectiveness}
        />
      )}

      {/* Highlights & insights (uses `bullets`) */}
     {Array.isArray(bullets) && bullets.length > 0 && (
       <Card className={styles.card}>
         <CardHeader className={styles.cardHeader}>
           <CardTitle className={styles.cardTitle} style={{ fontSize: "1rem" }}>
             Highlights &amp; insights
           </CardTitle>
         </CardHeader>
       <CardContent className={styles.cardContent}>
  <ul className={`${styles.small} ${styles.bulletList}`}>
    {bullets.map((b, i) => (
      <li key={i} className={styles.bulletItem}>
        {b}
      </li>
    ))}
  </ul>
</CardContent>
       </Card>
     )}

      {/* Sleep chart follows the active weekly/daily review start day. */}
      <SleepChartCard
        startUtc={win.start}
        tz={win.tz}
        injectionDay={injFull}
      />

      {include.exercise && (
        <EnergyBalanceSummaryCard summary={energyBalanceSummary} isPro={isPro} />
      )}

      {include.exercise && strengthSummary && strengthSummary.planned > 0 && (
        <StrengthSummaryCard summary={strengthSummary} />
      )}

      {/* Grid of PNG charts */}
      <div className={`${styles.grid} ${styles.chartGrid}`}>
  {include.protein && (
    <ChartCard
      metric="protein"
      title="Protein"
      src={charts.protein}
      proteinBuckets={proteinBuckets}
      dayLabels={proteinLabels}
      proteinRange={proteinRange}
    />
  )}
  {include.hydration && (
    <ChartCard
      metric="hydration"
      title="Hydration"
      src={charts.hydration}
      hydrationBuckets={hydrationBuckets}
      dayLabels={hydrationLabels}
      hydrationRange={hydrationRange}
    />
  )}
  {include.exercise && (
    activitySummary ? (
      <ActivitySummaryCard summary={activitySummary} />
    ) : (
      <ChartCard metric="exercise" title="Exercise" src={charts.exercise} axisLabels={axisLabels} />
    )
  )}
  {include.mood && (
    <ChartCard metric="mood" title="Mood" src={charts.mood} axisLabels={axisLabels} />
  )}
  {include.bloodPressure && (
    <ChartCard metric="bloodPressure" title="Blood pressure" src={charts.bloodPressure} />
  )}
  {include.bloodSugar && (
    <ChartCard metric="bloodSugar" title="Blood sugar" src={charts.bloodSugar} />
  )}
  {include.bowel && (
    <ChartCard metric="bowel" title="Bowel" src={charts.bowel} axisLabels={axisLabels} />
  )}
</div>

<div className={`${styles.small} ${styles.muted} ${styles.previewNote}`}>
  <Info className={styles.previewNoteIcon} />
  <span>
    Local preview uses generated PNGs.<br />
    Saving to Archive stores them for later viewing.
  </span>
</div>
    </div>
  );
}

function Glp1WeeklyCard({
  summary,
  injectionDay,
  timezone,
  onOpenEffectiveness,
}: {
  summary?: WeeklyGlp1Summary;
  injectionDay?: string;
  timezone: string;
  onOpenEffectiveness?: () => void;
}) {
  const points = summary?.points ?? [];
  const visiblePoints = getGlp1VisibleWeekPoints(points, injectionDay, timezone);
  const avg = (key: "hunger" | "nausea"): string => {
    if (visiblePoints.length === 0) return "—";
    const total = visiblePoints.reduce((sum, point) => sum + point[key], 0);
    return (total / visiblePoints.length).toFixed(1);
  };

  return (
    <Card className={styles.card} style={cardAccent("mood")} data-metric="glp1">
      <CardHeader
        className={styles.cardHeader}
        style={{
          background: "rgba(23, 75, 75, 0.08)",
          color: "#174b4b",
          borderColor: "rgba(23, 75, 75, 0.18)",
        }}
      >
        <CardTitle className={styles.cardTitle} style={{ fontSize: "1rem" }}>
          Medication effectiveness
        </CardTitle>
      </CardHeader>
      <CardContent className={`${styles.cardContent} ${styles.stackSm}`}>
        <div className={styles.metricSummaryRow}>
          <div>
            <span>Avg hunger</span>
            <strong>{avg("hunger")}</strong>
          </div>
          <div>
            <span>Avg nausea</span>
            <strong>{avg("nausea")}</strong>
          </div>
          <div>
            <span>Logs</span>
            <strong>{visiblePoints.length}</strong>
          </div>
        </div>

        <Glp1TrendGraph
          points={points}
          injectionDay={injectionDay}
          timezone={timezone}
          compact
        />

        {onOpenEffectiveness && (
          <div className={styles.inlineActionRow}>
            <button
              type="button"
              className={styles.inlineAction}
              onClick={onOpenEffectiveness}
            >
              Open full effectiveness graph
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  src,
  metric,
  proteinBuckets,
  dayLabels,
  proteinRange,
  hydrationBuckets,
  hydrationRange,
  axisLabels,
}: {
  title: string;
  src?: string;
  metric?: MetricKey;
  proteinBuckets?: number[] | undefined;
  dayLabels?: readonly DayKey[] | undefined;
  proteinRange?: ProteinRange | undefined;
  hydrationBuckets?: number[] | undefined;
  hydrationRange?: HydrationRange | undefined;
  axisLabels?: readonly DayKey[] | undefined;
}) {
  const resolved = resolveImgSrc(src);
  const accent = metric ? CHART_ACCENTS[metric] : undefined;

  // Protein thresholds (grams/day)
  const low: number = proteinRange?.min ?? 0;
  const high: number = proteinRange?.max ?? 0;
  const tol: number = 0.05;

  if (metric === "protein" && Array.isArray(proteinBuckets) && proteinBuckets.length === 7) {
    const buckets: number[] = proteinBuckets;
    const maxVal: number = Math.max(1, ...buckets);
    const labels: readonly string[] = (dayLabels && dayLabels.length === 7 ? dayLabels : DAY_KEYS) as readonly string[];

    return (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.25 }}
  >
    <Card
      className={styles.card}
      style={metric ? cardAccent(metric) : undefined}
      data-metric={metric || ""}
    >
      <CardHeader className={`${styles.cardHeader} ${styles.metricHeader}`}>
        <CardTitle className={styles.cardTitle} style={{ fontSize: "1rem" }}>
          {title}
        </CardTitle>
      </CardHeader>

      <CardContent className={styles.cardContent}>
        <div className={styles.miniBarGrid}>
          {buckets.map((val: number, idx: number) => {
            const denom = Math.max(1, maxVal, high, low);
            const rawPct = (val / denom) * 100;
            const heightPct = Math.max(
              2,
              Math.min(100, Number.isFinite(rawPct) ? rawPct : 0)
            );

            let level: "low" | "ok" | "high" = "low";
            if (low > 0 && high > 0) {
              const lowAdj = low * (1 - tol);
              const highAdj = high * (1 + tol);
              if (val >= lowAdj && val <= highAdj) level = "ok";
              else if (val > highAdj) level = "high";
            }

            return (
              <div key={labels[idx]} className={styles.miniBarCol}>
	                <div
	                  title={`${labels[idx]}: ${val} g`}
	                  className={`${styles.miniBar} ${styles[`miniBar_${level}`]}`}
	                  style={{ height: `${heightPct}%` }}
	                />
                <div
                  className={`${styles.miniBarLabel} ${styles[`miniBarLabel_${level}`]}`}
                >
                  {labels[idx]}
                </div>
                <div className={styles.miniBarValue}>{val} g</div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  </motion.div>
);
  }

// Hydration thresholds (mL per day)
if (metric === "hydration" && Array.isArray(hydrationBuckets) && hydrationBuckets.length === 7) {
  const buckets: number[] = hydrationBuckets as number[];
  const maxVal: number = Math.max(1, ...buckets);
  const labels: readonly string[] = (dayLabels && dayLabels.length === 7
    ? (dayLabels as readonly string[])
    : DAY_KEYS) as readonly string[];
  const lowH = hydrationRange?.min ?? 0;
  const highH = hydrationRange?.max ?? 0;
  const tolH = 0.05;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Card className={styles.card} style={metric ? cardAccent(metric) : undefined}>
        <CardHeader
          className={styles.cardHeader}
          style={accent ? { background: accent.bg, color: accent.fg, borderColor: accent.border } : undefined}
        >
          <CardTitle className={styles.cardTitle} style={{ fontSize: "1rem" }}>
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className={styles.cardContent}>
  <div className={styles.miniBarsRow}>
    {buckets.map((val: number, idx: number) => {
      const denom: number = Math.max(1, maxVal, highH, lowH);
      const rawPct = (val / denom) * 100;
      const heightPct = Math.max(2, Math.min(100, Number.isFinite(rawPct) ? rawPct : 0));

      // Level: below / within / above target
      let level: "low" | "ok" | "high" = "low";
      if (lowH > 0 && highH > 0) {
        const lowAdj = lowH * (1 - tolH);
        const highAdj = highH * (1 + tolH);
        if (val < lowAdj) level = "low";
        else if (val <= highAdj) level = "ok";
        else level = "high";
      }

      return (
        <div key={labels[idx]} className={styles.miniBarCol}>
          <div
  title={`${labels[idx]}: ${val} mL`}
  className={`${styles.miniBar} ${styles[`miniBar_${level}`]}`}
  style={{ height: `${heightPct}%` }}
/>
          <div className={`${styles.miniBarLabel} ${styles[`miniBarLabel_${level}`]}`}>
            {labels[idx]}
          </div>
          <div className={styles.miniBarValue}>{val} mL</div>
        </div>
      );
    })}
  </div>
</CardContent>

      </Card>
    </motion.div>
  );
}

// Fallback: original behavior (image-based)
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Card className={styles.card} style={metric ? cardAccent(metric) : undefined}>
        <CardHeader
          className={styles.cardHeader}
          style={accent ? { background: accent.bg, color: accent.fg, borderColor: accent.border } : undefined}
        >
          <CardTitle className={styles.cardTitle} style={{ fontSize: "1rem" }}>
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className={styles.cardContent}>
        {resolved ? (
          <div className={styles.chartViewport}>
            <img src={resolved} alt={title} className={styles.chartImg} />
          </div>
        ) : (
          <div className={styles.chartPlaceholder}>Chart will render here</div>
        )}

        {/* Extra legend for blood sugar time windows */}
        {metric === "bloodSugar" && (
        <div className={`${styles.tiny} ${styles.bloodSugarNote}`}>
            <div><strong>Fasting AM</strong> · 04:00–09:00</div>
            <div><strong>Pre-meal</strong> · 10:30–12:00, 17:30–19:00</div>
            <div>
              <strong>Post-meal</strong> · 08:30–10:30, 12:30–15:00, 19:30–22:00
            </div>
            <div><strong>Bedtime</strong> · 21:00–24:00</div>
          </div>
        )}

        {/* Weekday axis for smaller image-based charts (Exercise, Mood, Bowel) */}
        {(metric === "exercise" || metric === "mood" || metric === "bowel") &&
          Array.isArray(axisLabels) &&
          axisLabels.length === 7 && (
            <WeekAxis labels={axisLabels as readonly string[]} />
        )}
      </CardContent>

      </Card>
    </motion.div>
  );
}

function ActivitySummaryCard({ summary }: { summary: WeeklyActivitySummary }) {
  const maxSteps = Math.max(1, 10000, ...summary.steps);
  const format = (value: number) => Math.round(value).toLocaleString();

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Card className={styles.card} style={cardAccent("exercise")} data-metric="exercise">
        <CardHeader
          className={styles.cardHeader}
          style={{
            background: CHART_ACCENTS.exercise.bg,
            color: CHART_ACCENTS.exercise.fg,
            borderColor: CHART_ACCENTS.exercise.border,
          }}
        >
          <CardTitle className={styles.cardTitle} style={{ fontSize: "1rem" }}>
            Activity
          </CardTitle>
        </CardHeader>
        <CardContent className={styles.cardContent}>
          <div className={styles.activityTotals}>
            <div>
              <span>Steps</span>
              <strong>{format(summary.totals.steps)}</strong>
            </div>
            <div>
              <span>Exercise</span>
              <strong>{format(summary.totals.exerciseMinutes)} min</strong>
            </div>
            <div>
              <span>Move</span>
              <strong>{format(summary.totals.activeEnergyKcal)} kcal</strong>
            </div>
            <div>
              <span>Workouts</span>
              <strong>{format(summary.totals.workouts)}</strong>
            </div>
          </div>

          <div className={styles.miniBarGrid}>
            {summary.steps.map((val, idx) => {
              const heightPct = Math.max(2, Math.min(100, (val / maxSteps) * 100));
              const level: "low" | "ok" | "high" = val >= 7000 ? "ok" : val > 0 ? "high" : "low";
              return (
                <div key={`${summary.labels[idx]}-${idx}`} className={styles.miniBarCol}>
                  <div
                    title={`${summary.labels[idx]}: ${format(val)} steps`}
                    className={`${styles.miniBar} ${styles[`miniBar_${level}`]}`}
                    style={{ height: `${heightPct}%` }}
                  />
                  <div className={`${styles.miniBarLabel} ${styles[`miniBarLabel_${level}`]}`}>
                    {summary.labels[idx]}
                  </div>
                  <div className={styles.miniBarValue}>{format(val)}</div>
                </div>
              );
            })}
          </div>

          <div className={`${styles.tiny} ${styles.activityMeta}`}>
            Apple Health days {summary.syncedDays}/7 · Manual exercise {format(summary.totals.manualExerciseMinutes)} min
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function StrengthSummaryCard({ summary }: { summary: WeeklyStrengthSummary }) {
  return (
    <Card className={styles.card} style={cardAccent("exercise")} data-metric="exercise">
      <CardHeader className={styles.cardHeader} style={{ background: CHART_ACCENTS.exercise.bg, color: CHART_ACCENTS.exercise.fg, borderColor: CHART_ACCENTS.exercise.border }}>
        <CardTitle className={styles.cardTitle} style={{ fontSize: "1rem" }}>Coach Strength Workouts</CardTitle>
      </CardHeader>
      <CardContent className={styles.cardContent}>
        <div className={styles.activityTotals}>
          <div><span>Planned</span><strong>{summary.planned}</strong></div>
          <div><span>Completed</span><strong>{summary.completed}</strong></div>
          <div><span>Partial</span><strong>{summary.partial}</strong></div>
          <div><span>Strength time</span><strong>{summary.minutes} min</strong></div>
        </div>
        <p className={`${styles.small} ${styles.muted}`}>Approximately {summary.calories} kcal from completed Coach workouts. Wearable values replace estimates when matched.</p>
      </CardContent>
    </Card>
  );
}

function EnergyBalanceSummaryCard({
  summary,
  isPro,
}: {
  summary?: WeeklyEnergyBalanceSummary;
  isPro: boolean;
}) {
  const format = (value: number) => Math.round(value).toLocaleString();

  if (!isPro) {
    return (
      <Card className={styles.card} style={cardAccent("exercise")} data-metric="exercise">
        <CardHeader
          className={styles.cardHeader}
          style={{
            background: CHART_ACCENTS.exercise.bg,
            color: CHART_ACCENTS.exercise.fg,
            borderColor: CHART_ACCENTS.exercise.border,
          }}
        >
          <CardTitle className={styles.cardTitle} style={{ fontSize: "1rem" }}>
            Weekly Energy Balance
          </CardTitle>
        </CardHeader>
        <CardContent className={styles.cardContent}>
          <p className={`${styles.small} ${styles.muted}`}>
            Today shows daily calories in and movement calories. Pro adds the weekly pattern:
            food calories, movement calories, protein, and consistency across the review week.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!summary) return null;

  return (
    <Card className={styles.card} style={cardAccent("exercise")} data-metric="exercise">
      <CardHeader
        className={styles.cardHeader}
        style={{
          background: CHART_ACCENTS.exercise.bg,
          color: CHART_ACCENTS.exercise.fg,
          borderColor: CHART_ACCENTS.exercise.border,
        }}
      >
        <CardTitle className={styles.cardTitle} style={{ fontSize: "1rem" }}>
          Weekly Energy Balance
        </CardTitle>
      </CardHeader>
      <CardContent className={styles.cardContent}>
        <div className={styles.activityTotals}>
          <div>
            <span>Food logged</span>
            <strong>{format(summary.totals.foodCalories)} kcal</strong>
          </div>
          <div>
            <span>Movement</span>
            <strong>{format(summary.totals.movementCalories)} kcal</strong>
          </div>
          <div>
            <span>Net estimate</span>
            <strong>{format(summary.totals.netCalories)} kcal</strong>
          </div>
          <div>
            <span>Protein</span>
            <strong>{format(summary.totals.proteinGrams)}g</strong>
          </div>
        </div>
        <div className={`${styles.tiny} ${styles.activityMeta}`}>
          Food logged {summary.foodLogDays}/7 days · Movement logged {summary.movementDays}/7 days ·
          Movement {format(summary.totals.movementMinutes)} min
        </div>
        <p className={`${styles.small} ${styles.muted}`}>
          Calories are estimates for spotting patterns, not guaranteed weight-loss maths.
          If weight is stuck, use this with sleep, stress, bowel habits, and clinician guidance.
        </p>
      </CardContent>
    </Card>
  );
}

function InjectionSummary({
  takenAt,
  scheduledDay,
  scheduledTime,
  label,
}: {
  takenAt?: string | string[];
  scheduledDay?: string;
  scheduledTime?: string;
  label: string;
}) {
  const taken = Array.isArray(takenAt) ? takenAt[0] : takenAt;
  const takenLabel = taken
    ? new Date(taken).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <div className={styles.card}>
      <div className={styles.cardContent}>
        <div className={`${styles.small} ${styles.muted}`}>{label}</div>
        <div className={styles.small}>
          {takenLabel ? (
            <>
              Taken: <strong>{takenLabel}</strong>
            </>
          ) : (
            <>
              Scheduled: <strong>{scheduledDay || "—"}</strong> at{" "}
              <strong>{scheduledTime || "—"}</strong>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FastingSummary({
  targetHours,
  avgHours,
  daysMetTarget,
  fastingSchedule,
  days,
}: {
  targetHours?: number | null;
  avgHours?: number | null;
  daysMetTarget?: number | null;
  fastingSchedule?: string | null;
  days?: Array<{ day: string; met: boolean; hours?: number | null }>;
}) {
  const parsedTarget =
    typeof targetHours === "number" && !Number.isNaN(targetHours)
      ? targetHours
      : parseTargetFrom(undefined, fastingSchedule);

  const success = Array.isArray(days)
    ? days.filter((d) => d?.met).length
    : typeof daysMetTarget === "number"
    ? daysMetTarget
    : undefined;

  return (
    <div className={styles.card}>
      <div className={styles.cardContent}>
        <div className={`${styles.small} ${styles.muted}`}>Fasting</div>
        <div className={styles.small}>
          Target: <strong>{parsedTarget}h</strong>
          {typeof avgHours === "number" && (
            <>
              {" "}
              · Avg: <strong>{avgHours.toFixed(1)}h</strong>
            </>
          )}
          {typeof success === "number" && (
            <>
              {" "}
              · Success: <strong>{success}</strong>/7 days
            </>
          )}
        </div>

        {Array.isArray(days) && days.length > 0 && (
  <div className={styles.dayPills}>
    {days.map((d, i) => {
      const date = new Date(d.day);
      const label = Number.isNaN(date.getTime())
        ? d.day
        : date.toLocaleDateString(undefined, { weekday: "short" });

      const pillClass = d.met
        ? styles.dayPillMet
        : styles.dayPillMissed;

      return (
        <span
          key={`${d.day}-${i}`}
          className={`${styles.dayPill} ${pillClass}`}
          title={
            typeof d.hours === "number"
              ? `${d.hours.toFixed(1)}h fasting`
              : undefined
          }
        >
          {label}
        </span>
      );
    })}
  </div>
)}

      </div>
    </div>
  );
}
