// =============================================================================
// File: src/pages/WeeklyChartPage.tsx
// Desc: Full-page view for a single weekly chart (deep-linked from email/UI)
// Notes:
//  - Accepts route param :metric and optional query ?from=&to=&tz=
//  - If from/to/tz are missing, computes anchored week from user profile
//  - Fetches only the requested chart and renders it large
//  - Matches the WeeklySummaryPage look/feel (reuses CSS + accents)
// =============================================================================
import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Loader2, ChevronLeft } from "lucide-react";
import styles from "./weeklySummaryPage.module.css";
import { getAnchoredWeek } from "../lib/time";
import type { WeekdayFull } from "../lib/time";

// ---------- Types ----------
type Tz = string;
type WeekWindow = { start: string; end: string; tz: Tz; };
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

// ---------- Helpers ----------
const TITLES: Record<MetricKey, string> = {
  protein: "Protein",
  hydration: "Hydration",
  bloodPressure: "Blood pressure",
  bloodSugar: "Blood sugar",
  bowel: "Bowel",
  exercise: "Exercise",
  mood: "Mood",
  fasting: "Fasting",
};

function fmtRange(win: WeekWindow) {
  const fmt = (s: string) =>
    new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${fmt(win.start)} → ${fmt(win.end)} (${win.tz})`;
}

// Normalize 'Mon' → 'Monday'
const FULL_DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"] as const;
const FULL_DAYS_STR: readonly string[] = FULL_DAYS; // for .includes at runtime

function isFullDay(x: string): x is WeekdayFull {
  return FULL_DAYS_STR.includes(x);
}

function toFullDay(s?: string | null): WeekdayFull | "" {
  if (!s) return "";
  const t = String(s).trim();

  // exact match first
  if (isFullDay(t)) return t;

  // fallback: 3-letter prefix
  const map: Record<string, WeekdayFull> = {
    mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
    fri: "Friday", sat: "Saturday", sun: "Sunday",
  };
  return map[t.slice(0, 3).toLowerCase()] ?? "";
}

function toHHMM(s?: string | null): string {
  if (!s) return "08:00";
  if (s.includes("T")) return s.split("T")[1]?.slice(0, 5) || "08:00";
  return s.slice(0, 5);
}

function resolveImgSrc(src?: string): string | undefined {
  if (!src) return undefined;
  const trimmed = src.trim();
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length > 100) {
    return `data:image/png;base64,${trimmed}`;
  }
  return trimmed;
}

// Visual accents to keep pages colorful/consistent
const CHART_ACCENTS: Record<MetricKey, { bg: string; fg: string; border: string }> = {
  protein:       { bg: "#f4f0ff", fg: "#5b21b6", border: "#c4b5fd" },   // purple
  hydration:     { bg: "#eff6ff", fg: "#075985", border: "#93c5fd" },   // blue
  bloodPressure: { bg: "#fef2f2", fg: "#7f1d1d", border: "#fecaca" },   // red
  bloodSugar:    { bg: "#f5f3ff", fg: "#4c1d95", border: "#ddd6fe" },   // violet
  bowel:         { bg: "#fffbeb", fg: "#7c2d12", border: "#fde68a" },   // amber
  exercise:      { bg: "#ecfdf5", fg: "#065f46", border: "#a7f3d0" },   // green
  mood:          { bg: "#fff7ed", fg: "#7c2d12", border: "#fed7aa" },   // orange
  fasting:       { bg: "#f0fdfa", fg: "#115e59", border: "#99f6e4" },   // teal
};

// ---------- Page ----------
export default function WeeklyChartPage() {
  const { metric: rawMetric } = useParams<{ metric: string }>();
  const location = useLocation();

  // Validate/normalize metric
  const metric = useMemo<MetricKey | null>(() => {
    const m = (rawMetric || "").trim() as MetricKey;
    return (["protein","hydration","bloodPressure","bloodSugar","bowel","exercise","mood","fasting"] as MetricKey[])
      .includes(m) ? m : null;
  }, [rawMetric]);

  const [loading, setLoading] = useState(true);
  const [imgSrc, setImgSrc] = useState<string | undefined>(undefined);
  const [win, setWin] = useState<WeekWindow | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Parse query (from, to, tz)
  const qs = new URLSearchParams(location.search);
  const fromQ = qs.get("from") || "";
  const toQ   = qs.get("to")   || "";
  const tzQ   = qs.get("tz")   || "";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!metric) {
        setError("Unknown chart.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      // Compute window if not given
      let from = fromQ, to = toQ, tz = tzQ;
      if (!from || !to || !tz) {
        try {
          const p = await fetch("/api/user/profile", { credentials: "include" });
          if (p.ok) {
            const prof = await p.json();
            const injDay = (toFullDay(prof?.injection_day as string) || "Monday") as WeekdayFull;
            const injHHMM = toHHMM(prof?.injection_time as string | undefined);
            const tzStr =
              (prof?.timezone as string) ||
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "UTC";
            const { startUtc, endUtc } = getAnchoredWeek(new Date(), injDay, injHHMM, tzStr);
            from = startUtc; to = endUtc; tz = tzStr;
          }
        } catch {
          // ignore, fall back to server-computed default by skipping params
        }
      }

      // Build query string for fetching just this metric
      const include = `include=${encodeURIComponent(metric)}`;
      const base = "/api/weekly-summary/charts";
      const hasWin = from && to && tz;
      const url = hasWin
        ? `${base}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=${encodeURIComponent(tz)}&${include}`
        : `${base}?${include}`;

      try {
        const r = await fetch(url, { credentials: "include" });
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();

        // Expect j.charts[metric] and maybe j.window
        const src = j?.charts?.[metric] as string | undefined;
        const windowObj = j?.window as WeekWindow | undefined;

        // Fallback: if charts endpoint didn’t return, try the full payload
        if (!src) {
          const r2 = await fetch(
            hasWin
              ? `/api/weekly-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=${encodeURIComponent(tz)}&${include}`
              : `/api/weekly-summary?${include}`,
            { credentials: "include" }
          );
          if (!r2.ok) throw new Error(await r2.text());
          const j2 = await r2.json();
          const src2 = j2?.charts?.[metric] as string | undefined;
          if (!src2) throw new Error("Chart not available.");
          if (!cancelled) {
            setImgSrc(resolveImgSrc(src2));
            setWin(windowObj ?? (j2?.window as WeekWindow | null) ?? null);
          }
        } else {
          if (!cancelled) {
            setImgSrc(resolveImgSrc(src));
            setWin(windowObj ?? (hasWin ? { start: from, end: to, tz } : null));
          }
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, location.search]);

  // Accent for header
  const accent = metric ? CHART_ACCENTS[metric] : undefined;
  const title = metric ? TITLES[metric] : "Chart";

  return (
    <div className={styles.page}>
      <div className={styles.backRow}>
        <Link to="/weekly-summary" className={styles.buttonSecondary} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <ChevronLeft className="h-4 w-4" /> Back to Weekly Summary
        </Link>
      </div>

      <Card className={styles.card} style={{ borderTop: accent ? `3px solid ${accent.border}` : undefined }}>
        <CardHeader
          className={styles.cardHeader}
          style={accent ? { background: accent.bg, color: accent.fg, borderColor: accent.border } : undefined}
        >
          <CardTitle className={styles.cardTitle} style={{ fontSize: "1.1rem" }}>
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className={styles.cardContent}>
          {loading && (
  <div className={`${styles.loader} ${styles.loaderPad}`}>
    <Loader2 className={styles.spinner} />
    Loading chart…
  </div>
)}

{error && (
  <div className={`${styles.small} ${styles.errorText}`}>
    {String(error || "Failed to load chart.")}
  </div>
)}

{!loading && !error && imgSrc && (
  <>
    {win && (
      <div className={`${styles.small} ${styles.muted} ${styles.rangeRow}`}>
        {fmtRange(win)}
      </div>
    )}

    <img
      src={imgSrc}
      alt={title}
      className={styles.bigChartImg}
    />

    <div className={styles.actionRow}>
      <a
        href={imgSrc}
        download={`${title.replace(/\s+/g, "_")}.png`}
        className={styles.buttonSecondary}
      >
        Download PNG
      </a>
      <Button
        onClick={() => window.print()}
        className={styles.buttonSecondary}
      >
        Print
      </Button>
    </div>
  </>
)}

        </CardContent>
      </Card>
    </div>
  );
}
