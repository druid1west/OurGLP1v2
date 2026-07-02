// src/pages/WeeklySummaryArchiveDetail.tsx
import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { IonPage, IonContent } from "@ionic/react";
import { useParams, Redirect, Link } from "react-router-dom";

import html2canvas from "html2canvas";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Media } from "@capacitor-community/media";
import { Preferences } from "@capacitor/preferences";

import TopNav from "@/context/TopNav";
import BottomNav from "@/context/BottomNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import styles from "./WeeklySummaryArchive.module.css";

import {
  getArchive,
  getArchiveCharts,
  type ArchiveRow,
  archiveFilename,
  archiveDisplayLabel,
} from "@/db/WeeklySummaryRepository";

// Correct casing matters on case-sensitive FS
import { SummaryPreview } from "./weeklySummaryPage";
import type { Glp1GraphPoint } from "../db/EffectivenessRepository";

// NEW: bring in user (for weight/id), rollups, and target ranges
import { useAuth } from "@/context/useAuth";
import {
  getWeeklyProteinIntake,
  getWeeklyHydrationIntake,
  type WeeklyHydrationRow,
} from "@/db/HealthRepository";
import {
  computeProteinRange,
  computeHydrationRange,
  type ProteinRange,
  type HydrationRange,
} from "@/lib/nutrition";

/** ---------- types mirrored from live page ---------- */
type WeekWindow = { start: string; end: string; tz: string };
type Charts = {
  protein?: string;
  hydration?: string;
  bloodPressure?: string;
  bloodSugar?: string;
  bowel?: string;
  exercise?: string;
  mood?: string;
  fasting?: string;
  sleep?: string;
};
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
type WeeklyGlp1Summary = {
  points: Glp1GraphPoint[];
};
type ArchiveSnapshot = {
  version?: number;
  profile?: {
    weight?: number | null;
    bmi?: number | null;
    weightUnit?: string | null;
    medicationName?: string | null;
    medicationDose?: string | null;
  };
  protein?: {
    buckets?: number[];
    labels?: DayKey[];
    range?: ProteinRange | null;
    total?: number;
  };
  hydration?: {
    buckets?: number[];
    labels?: DayKey[];
    range?: HydrationRange | null;
    total?: number;
  };
  activity?: WeeklyActivitySummary;
  glp1?: WeeklyGlp1Summary;
};

/** ---------- utils ---------- */
function normalizeDateString(input: string): string {
  let s = String(input).trim();
  if (/^\d{13}$/.test(s)) return new Date(Number(s)).toISOString();
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00Z`;
  if (s.includes(" ")) s = s.replace(" ", "T");
  s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  if (/\+[0-9]{2}$/.test(s)) s += ":00";
  s = s.replace(/\+00:00$/, "Z");
  return s;
}
function parseISO(input?: string | null): Date | null {
  if (!input) return null;
  const t = Date.parse(normalizeDateString(input));
  return Number.isNaN(t) ? null : new Date(t);
}

function isGlp1Snapshot(value: unknown): value is WeeklyGlp1Summary {
  if (!value || typeof value !== "object") return false;
  const points = (value as { points?: unknown }).points;
  return Array.isArray(points);
}
function fmtDateTime(iso?: string | null): string {
  const d = parseISO(iso);
  return d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

// NEW: helpers to bucket & rotate Mon..Sun like the live page
type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
const DAY_KEYS: DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function ymdToDayKey(ymdStr: string): DayKey {
  const d = new Date(`${ymdStr}T12:00:00`);
  const k = d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3);
  if (DAY_KEYS.includes(k as DayKey)) return k as DayKey;
  return "Mon";
}
function rotateToStart<T>(arr: readonly T[], startIdx: number): T[] {
  if (startIdx <= 0) return arr.slice() as T[];
  return [...arr.slice(startIdx), ...arr.slice(0, startIdx)];
}
function fullToDayKey(d?: string): DayKey {
  const m: Record<string, DayKey> = {
    Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu",
    Friday: "Fri", Saturday: "Sat", Sunday: "Sun",
  };
  const key = d && m[d] ? m[d] : "Mon";
  return key;
}
function isSevenNumbers(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 7 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}
function isDayKeyArray(value: unknown): value is DayKey[] {
  return Array.isArray(value) && value.length === 7 && value.every((d) => DAY_KEYS.includes(d as DayKey));
}
function isActivitySnapshot(value: unknown): value is WeeklyActivitySummary {
  if (!value || typeof value !== "object") return false;
  const rec = value as Partial<WeeklyActivitySummary>;
  return isDayKeyArray(rec.labels) &&
    isSevenNumbers(rec.steps) &&
    isSevenNumbers(rec.exerciseMinutes) &&
    isSevenNumbers(rec.activeEnergyKcal) &&
    isSevenNumbers(rec.manualExerciseMinutes) &&
    isSevenNumbers(rec.workouts) &&
    !!rec.totals &&
    typeof rec.totals === "object";
}

// ------- Android Gallery helpers -------
let ANDROID_ALBUM_ID: string | null = null;
const ANDROID_ALBUM_PREF_KEY = "ourglp1_media_album_id_v1";
const ANDROID_ALBUM_NAME = "OurGLP1";

async function getOrCreateAndroidAlbumIdentifier(): Promise<string> {
  if (ANDROID_ALBUM_ID) return ANDROID_ALBUM_ID;

  try {
    const saved = await Preferences.get({ key: ANDROID_ALBUM_PREF_KEY });
    if (saved.value) {
      ANDROID_ALBUM_ID = saved.value;
      return ANDROID_ALBUM_ID;
    }
  } catch {
    // ignore preference read errors
  }

  // Ensure album exists, then resolve its identifier
  await Media.createAlbum({ name: ANDROID_ALBUM_NAME });
  const { albums } = await Media.getAlbums();
  const match = albums.find((a) => a.name === ANDROID_ALBUM_NAME);
  if (!match?.identifier) throw new Error("Album identifier not found");
  ANDROID_ALBUM_ID = match.identifier;
  await Preferences.set({ key: ANDROID_ALBUM_PREF_KEY, value: ANDROID_ALBUM_ID });
  return ANDROID_ALBUM_ID;
}

// Guarded canShare() call with strict typing
type CanShareResult = { value: boolean };
type ShareWithOptionalCanShare = {
  canShare?: () => Promise<CanShareResult>;
};

async function canShareNative(): Promise<boolean> {
  try {
    const s = Share as unknown as ShareWithOptionalCanShare;
    if (typeof s.canShare === "function") {
      const res = await s.canShare();
      return !!res.value;
    }
    // Older platforms: treat as share-capable
    return true;
  } catch {
    return true;
  }
}

/** ---------- page ---------- */
export default function WeeklySummaryArchiveDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const archiveId = Number(id);
  const isValidId = Number.isFinite(archiveId) && archiveId > 0;

  // Hooks must run unconditionally
  const [loading, setLoading] = useState(true);
  const [rec, setRec] = useState<ArchiveRow | null>(null);
  const [chartMap, setChartMap] = useState<Record<string, string>>({});

  const { user } = useAuth();

  // NEW: state for the "new view" inline bars in archive
  const [proteinBuckets, setProteinBuckets] = useState<number[] | undefined>(undefined);
  const [hydrationBuckets, setHydrationBuckets] = useState<number[] | undefined>(undefined);
  const [proteinLabels, setProteinLabels] = useState<DayKey[] | undefined>(undefined);
  const [hydrationLabels, setHydrationLabels] = useState<DayKey[] | undefined>(undefined);
  const [proteinRange, setProteinRange] = useState<ProteinRange | undefined>(undefined);
  const [hydrationRange, setHydrationRange] = useState<HydrationRange | undefined>(undefined);
  const [capturing, setCapturing] = useState<boolean>(false);

  // The element we will snapshot (the Preview card content)
  const previewRef = useRef<HTMLDivElement | null>(null);

  const dataUrlToBase64 = (dataUrl: string): string => {
    const comma = dataUrl.indexOf(",");
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  };

  const downloadOnWeb = (dataUrl: string, filename: string): void => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const captureAndSave = useCallback(async (): Promise<void> => {
    if (capturing) return;
    const root = previewRef.current;
    if (!root) {
      console.warn("[ArchiveDetail] capture aborted: previewRef is null");
      alert("Could not find the preview content to capture.");
      return;
    }
    setCapturing(true);
    try {
      // Ensure we capture full scrollable height of the preview section
      const w = root.scrollWidth || root.clientWidth;
      const h = root.scrollHeight || root.clientHeight;
      const scale = Math.min(2, window.devicePixelRatio || 1);

      const canvas = await html2canvas(root, {
        backgroundColor: "#ffffff",
        windowWidth: w,
        windowHeight: h,
        scale,
        useCORS: true,
        logging: false,
      });
      const dataUrl = canvas.toDataURL("image/png", 1.0);
      const fname = rec ? `${archiveFilename(rec.from_utc, rec.to_utc)}.png` : "weekly-summary.png";

      // Android: save directly to Photos (Gallery) using a real file path
if (Capacitor.getPlatform() === "android") {
  try {
    const albumIdentifier = await getOrCreateAndroidAlbumIdentifier();

    // 1) Write a real PNG file to cache (base64 from dataUrl)
    const base64 = dataUrlToBase64(dataUrl);
    const fileBase = `weekly-summary-${Date.now()}`;
    const relPath = `weekly-summary/${fileBase}.png`;

    await Filesystem.writeFile({
      path: relPath,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });

    // 2) Resolve native URI for the saved file
    const { uri } = await Filesystem.getUri({
      path: relPath,
      directory: Directory.Cache,
    });
    if (!uri) throw new Error("No native URI after write");

    // 3) Hand the native file path to Media.savePhoto (this triggers MediaStore scan)
    await Media.savePhoto({
      path: uri,                  // native file URI (content:// or file://)
      albumIdentifier,            // OurGLP1 album (created once)
      fileName: `${fileBase}.png` // keep explicit .png
    });

    // 4) (Optional) Clean up the temp cache file
    try {
      await Filesystem.deleteFile({ path: relPath, directory: Directory.Cache });
    } catch {
      /* ignore */
    }

    alert("Saved to Photos ✅ (Album: OurGLP1)");
    setCapturing(false);
    return;
  } catch (err) {
    console.warn("[ArchiveDetail] Android savePhoto failed, falling back to Share", err);
    // Fall through to native share fallback below
  }
}

      // iOS (and Android fallback): write to cache & open Share sheet
      if (Capacitor.isNativePlatform() && (await canShareNative())) {
        const base64 = dataUrlToBase64(dataUrl);
        const relPath = `weekly-summary/${Date.now()}-${fname}`;
        const writeRes = await Filesystem.writeFile({
          path: relPath,
          data: base64,
          directory: Directory.Cache,
          recursive: true,
        });
        const native = await Filesystem.getUri({ path: relPath, directory: Directory.Cache });
        const url = native.uri || writeRes.uri || "";
        if (!url) throw new Error("Could not resolve native file URL after write");
        await Share.share({
          title: "Weekly Summary",
          text: "Your archived weekly summary",
          url,
          dialogTitle: "Save or share image",
        });
      } else {
        // Web: direct download
        downloadOnWeb(dataUrl, fname);
      }
    } catch (e) {
      console.warn("[ArchiveDetail] capture failed", e);
      alert("Could not save the image. Please try again.");
    } finally {
      setCapturing(false);
    }
  }, [capturing, rec]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!isValidId) {
        if (mounted) setLoading(false);
        return;
      }
      try {
        const row = await getArchive(archiveId);
        const charts = await getArchiveCharts(archiveId);
        if (!mounted) return;
        setRec(row);
        setChartMap(charts || {});
      } catch (e) {
        console.warn("[ArchiveDetail] failed to load", e);
        alert("Failed to load archived summary.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [archiveId, isValidId]);

  // All memos also run unconditionally
  const win: WeekWindow | null = useMemo(() => {
    if (!rec) return null;
    return { start: rec.from_utc, end: rec.to_utc, tz: rec.tz };
  }, [rec]);

  const charts: Charts = useMemo(() => {
    const toData = (b64?: string) => (b64 ? `data:image/png;base64,${b64}` : undefined);
    return {
      protein: toData(chartMap.protein),
      hydration: toData(chartMap.hydration),
      exercise: toData(chartMap.exercise),
      mood: toData(chartMap.mood),
      bowel: toData(chartMap.bowel),
      bloodSugar: toData(chartMap.bloodSugar),
      bloodPressure: toData(chartMap.bloodPressure),
      fasting: toData(chartMap.fasting),
      sleep: toData(chartMap.sleep),
    };
  }, [chartMap]);

  const include = useMemo<Include | null>(() => {
    if (!rec) return null;
    const hasChart = (k: keyof Charts) => Boolean(charts[k]);
    return {
      protein: hasChart("protein"),
      hydration: hasChart("hydration"),
      bloodPressure: hasChart("bloodPressure"),
      bloodSugar: hasChart("bloodSugar"),
      bowel: hasChart("bowel"),
      exercise: hasChart("exercise"),
      mood: hasChart("mood"),
      fasting: !!rec.fasting_json,
      injection: Boolean(rec.anchor_type || rec.anchor_used || rec.injection_taken_at),
    };
  }, [rec, charts]);

  const bullets = useMemo<string[]>(() => {
    if (!rec?.summary_bullets_json) return [];
    try {
      const arr = JSON.parse(rec.summary_bullets_json);
      return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }, [rec?.summary_bullets_json]);

  const fasting = useMemo<FastingStats | undefined>(() => {
    if (!rec?.fasting_json) return undefined;
    try {
      const obj = JSON.parse(rec.fasting_json) as FastingStats | null;
      return obj || undefined;
    } catch {
      return undefined;
    }
  }, [rec?.fasting_json]);

  const snapshot = useMemo<ArchiveSnapshot | null>(() => {
    if (!rec?.snapshot_json) return null;
    try {
      const parsed = JSON.parse(rec.snapshot_json) as ArchiveSnapshot;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }, [rec?.snapshot_json]);

  const activitySummary = useMemo<WeeklyActivitySummary | undefined>(() => {
    return isActivitySnapshot(snapshot?.activity) ? snapshot.activity : undefined;
  }, [snapshot]);

  const glp1Summary = useMemo<WeeklyGlp1Summary | undefined>(() => {
    return isGlp1Snapshot(snapshot?.glp1) ? snapshot.glp1 : undefined;
  }, [snapshot]);

  const injectionTakenAt: string | undefined = rec?.injection_taken_at || undefined;

  const scheduledDayTime = useMemo(() => {
    const raw = rec?.anchor_scheduled_at || ""; // "MondayT08:00"
    const [day, time] = String(raw).split("T");
    return { day: day || undefined, time: time || undefined };
  }, [rec?.anchor_scheduled_at]);

  // NEW: compute weekStartLocal in the archive's tz, rollups, buckets, labels, ranges
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!rec) return;
      try {
        const snapshotProtein = snapshot?.protein;
        const snapshotHydration = snapshot?.hydration;
        const hasSnapshotProtein = isSevenNumbers(snapshotProtein?.buckets);
        const hasSnapshotHydration = isSevenNumbers(snapshotHydration?.buckets);
        const snapshotProteinLabels = isDayKeyArray(snapshotProtein?.labels) ? snapshotProtein.labels : undefined;
        const snapshotHydrationLabels = isDayKeyArray(snapshotHydration?.labels) ? snapshotHydration.labels : undefined;

        if (hasSnapshotProtein && !cancelled) {
          setProteinBuckets(snapshotProtein.buckets);
          setProteinLabels(snapshotProteinLabels);
          setProteinRange(snapshotProtein.range ?? undefined);
        }
        if (hasSnapshotHydration && !cancelled) {
          setHydrationBuckets(snapshotHydration.buckets);
          setHydrationLabels(snapshotHydrationLabels);
          setHydrationRange(snapshotHydration.range ?? undefined);
        }
        if (hasSnapshotProtein && hasSnapshotHydration) return;

        const tz = rec.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        // local week start (YYYY-MM-DD in tz) based on from_utc
        const weekStartLocal = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(rec.from_utc));

        // Compute ranges from current user's weight (fallback 0).
        const weightNum = Number(user?.weight ?? 0);
        const pr = computeProteinRange(weightNum) ?? undefined;
        const hr = computeHydrationRange(weightNum) ?? undefined;
        if (!hasSnapshotProtein) setProteinRange(pr);
        if (!hasSnapshotHydration) setHydrationRange(hr);

        // Fetch rollups for this archived window
        const userIdStr =
          typeof user?.id === "string" ? user.id : user?.id != null ? String(user.id) : "";
        const prot = await getWeeklyProteinIntake(userIdStr, weekStartLocal);
        const hydr: WeeklyHydrationRow[] = await getWeeklyHydrationIntake(userIdStr, weekStartLocal);

        // Bucket into Mon..Sun
        const pBuckets = Array(7).fill(0) as number[];
        for (const r of prot) {
          const dateStr = String((r as { date?: unknown }).date ?? "");
          if (!dateStr) continue;
          const idx = DAY_KEYS.indexOf(ymdToDayKey(dateStr));
          if (idx >= 0) {
            const gramsVal = (r as { protein_grams?: unknown }).protein_grams;
            const grams = typeof gramsVal === "number" ? gramsVal : Number(gramsVal ?? 0);
            pBuckets[idx] += Number.isFinite(grams) ? grams : 0;
          }
        }
        const hBuckets = Array(7).fill(0) as number[];
        for (const r of hydr) {
          const dateStr = String(r.date ?? "");
          if (!dateStr) continue;
          const idx = DAY_KEYS.indexOf(ymdToDayKey(dateStr));
          if (idx >= 0) {
            const mlVal = r.hydration_ml;
            const ml = typeof mlVal === "number" ? mlVal : Number(mlVal ?? 0);
            hBuckets[idx] += Number.isFinite(ml) ? ml : 0;
          }
        }

        // Rotate to the archived anchor day if available
        const anchorDayFull = scheduledDayTime.day; // "Monday" etc.
        const startIdx = DAY_KEYS.indexOf(fullToDayKey(anchorDayFull));
        const idxSafe = Math.max(0, startIdx);
        const labelsRot = rotateToStart(DAY_KEYS, idxSafe) as DayKey[];
        const pRot = rotateToStart(pBuckets, idxSafe);
        const hRot = rotateToStart(hBuckets, idxSafe);

        if (!cancelled) {
          if (!hasSnapshotProtein) {
            setProteinBuckets(pRot);
            setProteinLabels(labelsRot);
          }
          if (!hasSnapshotHydration) {
            setHydrationBuckets(hRot);
            setHydrationLabels(labelsRot);
          }
        }
      } catch (e) {
        console.warn("[ArchiveDetail] rollups failed", e);
        if (!cancelled) {
          setProteinBuckets(undefined);
          setHydrationBuckets(undefined);
          setProteinLabels(undefined);
          setHydrationLabels(undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rec, user?.id, user?.weight, scheduledDayTime.day, snapshot]);

  const filename = useMemo(
    () => (rec ? archiveFilename(rec.from_utc, rec.to_utc) : "—"),
    [rec]
  );
  const displayLabel = useMemo(
    () => (rec ? archiveDisplayLabel(rec.from_utc, rec.to_utc) : "—"),
    [rec]
  );
  const archivedOn = useMemo(
    () => (rec ? fmtDateTime(rec.archived_at || rec.sent_at || rec.created_at) : "—"),
    [rec]
  );

  // ✅ Redirect AFTER hooks & memos have run
  if (!isValidId) {
    return <Redirect to="/weekly-summary/archive" />;
  }

  if (loading || !rec || !win || !include) {
    return (
      <IonPage>
        <TopNav showWhenAnon />
        <IonContent fullscreen className={styles.contentPad}>
          <div className={styles.page}>
            <div className={styles.loader}>
              <span>Loading archive…</span>
            </div>
          </div>
        </IonContent>
        <BottomNav />
      </IonPage>
    );
  }

  return (
  <IonPage>
    <TopNav showWhenAnon />

    <IonContent fullscreen className={styles.contentPad}>
      <div className={styles.container}>
        <div className={styles.page}>
          <div className={styles.leftCol}>
            <Card className={styles.card}>
              <CardHeader className={styles.cardHeader}>
                <CardTitle className={styles.cardTitle}>
                  Viewing archive: {displayLabel}
                </CardTitle>
              </CardHeader>

              <CardContent className={styles.cardContent}>
                <div className={styles.small}>
                  Archived on: <strong>{archivedOn}</strong>
                </div>
                <div className={styles.small}>
                  Export filename: <code>{filename}.png</code>
                </div>

                <div className={styles.small}>
                  Week:{" "}
                  <strong>
                    {displayLabel} ({rec.tz})
                  </strong>
                </div>
                {snapshot?.profile && (
                  <div className={styles.small}>
                    Snapshot:{" "}
                    <strong>
                      {snapshot.profile.medicationName ?? "Medication not set"}
                      {snapshot.profile.medicationDose ? ` ${snapshot.profile.medicationDose}` : ""}
                    </strong>
                    {snapshot.profile.weight != null ? ` · ${snapshot.profile.weight} ${snapshot.profile.weightUnit ?? "kg"}` : ""}
                    {snapshot.profile.bmi != null ? ` · BMI ${snapshot.profile.bmi}` : ""}
                  </div>
                )}

                <div className={styles.backRow}>
                  <Link to="/weekly-summary/archive">
                    <Button className={styles.buttonSecondary}>
                      ← Back to archive
                    </Button>
                  </Link>
                </div>

                <div className={styles.actionRow}>
                  <Button
                    className={styles.buttonPrimary}
                    onClick={captureAndSave}
                    disabled={capturing}
                    aria-busy={capturing ? "true" : "false"}
                    type="button"
                  >
                    <span className={styles.buttonInner}>
                      {capturing && <span className={styles.spinner} aria-hidden />}
                      <span>
                        {capturing ? "Saving…" : "Save as image to library"}
                      </span>
                    </span>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className={styles.card}>
              <CardHeader className={styles.cardHeader}>
                <CardTitle className={styles.cardTitle}>
                  Preview (archived)
                </CardTitle>
              </CardHeader>

              <CardContent className={styles.cardContent}>
                {/* html2canvas target */}
                <div
                  ref={previewRef}
                  id="archive-capture-root"
                  className={styles.previewRoot}
                >
                  <SummaryPreview
                    charts={charts}
                    include={include}
                    bullets={bullets}
                    win={win}
                    injectionTakenAt={injectionTakenAt}
                    injectionScheduledDay={scheduledDayTime.day}
                    injectionScheduledTime={scheduledDayTime.time}
                    fasting={fasting}
                    fastingRows={undefined}
                    proteinBuckets={proteinBuckets}
                    proteinLabels={proteinLabels}
                    proteinRange={proteinRange}
                    hydrationBuckets={hydrationBuckets}
                    hydrationLabels={hydrationLabels}
                    hydrationRange={hydrationRange}
                    activitySummary={activitySummary}
                    glp1Summary={glp1Summary}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </IonContent>

    <BottomNav />
  </IonPage>
);


}
