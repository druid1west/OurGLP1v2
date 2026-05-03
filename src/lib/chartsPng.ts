// src/lib/chartsPng.ts
export type Series = { label?: string; values: number[] };

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/* -------------------------
   Existing: Bar chart (unchanged)
------------------------- */
export function makeBarChartPng(
  series: Series,
  opts?: { width?: number; height?: number; padding?: number; max?: number }
): string {
  const width = opts?.width ?? 600;
  const height = opts?.height ?? 280;
  const padding = opts?.padding ?? 24;
  const max = opts?.max ?? Math.max(1, ...series.values);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // bg
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const chartW = width - padding * 2;
  const chartH = height - padding * 2;

  // axis
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  // bars
  const n = series.values.length;
  const gap = 8;
  const barW = Math.max(2, (chartW - gap * (n - 1)) / Math.max(1, n));
  for (let i = 0; i < n; i++) {
    const v = clamp(series.values[i], 0, max);
    const h = (v / max) * chartH;
    const x = padding + i * (barW + gap);
    const y = height - padding - h;
    ctx.fillStyle = '#0f766e'; // teal-ish
    ctx.fillRect(x, y, barW, h);
  }

  return canvas.toDataURL('image/png'); // data:image/png;base64,...
}

/* -------------------------
   Existing: Simple line chart (unchanged)
------------------------- */
export function makeLineChartPng(
  series: Series[],
  opts?: { width?: number; height?: number; padding?: number; max?: number }
): string {
  const width = opts?.width ?? 600;
  const height = opts?.height ?? 280;
  const padding = opts?.padding ?? 24;
  const max = opts?.max ?? Math.max(1, ...series.flatMap(s => s.values));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // bg
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const chartW = width - padding * 2;
  const chartH = height - padding * 2;

  // baseline
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  // lines
  const colors = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7'];
  series.forEach((s, idx) => {
    const n = s.values.length;
    const step = n <= 1 ? chartW : chartW / (n - 1);
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors[idx % colors.length];

    for (let i = 0; i < n; i++) {
      const v = clamp(s.values[i], 0, max);
      const x = padding + i * step;
      const y = height - padding - (v / max) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });

  return canvas.toDataURL('image/png');
}

/* =========================================================
   NEW: Axis-labeled line charts (non-breaking add-ons)
   - Generic: makeLineChartWithAxesPng
   - Specialized wrapper: makeBloodPressureChartPng
========================================================= */

type AxisLineChartOpts = {
  width?: number;
  height?: number;
  /** Overall padding scale that influences internal margins */
  padding?: number;

  /** X-axis labels (e.g., Mon..Sun). If omitted, no x labels are drawn. */
  labels?: readonly string[];

  /** Y-axis controls. If omitted, yMin=0 and yMax is derived from data. */
  yMin?: number;
  yMax?: number;
  yTickStep?: number;      // default 10
  yAxisLabel?: string;     // e.g., "mmHg"

  /** Legend */
  drawLegend?: boolean;
  legendPosition?: 'top-right' | 'top-left';
};

function roundToStep(n: number, step: number, dir: 'up' | 'down'): number {
  return dir === 'up' ? Math.ceil(n / step) * step : Math.floor(n / step) * step;
}

/**
 * Generic axis-labeled line chart.
 * SAFE: this is a new function; existing charts remain unchanged.
 */
export function makeLineChartWithAxesPng(series: Series[], opts?: AxisLineChartOpts): string {
  const width  = opts?.width  ?? 600;
  const height = opts?.height ?? 280;
  const pad    = opts?.padding ?? 24;

  // derive margins from padding (so callers can tune spacing)
  const leftPad   = Math.max(52, pad * 2);              // room for y labels
  const rightPad  = Math.max(12, Math.floor(pad / 2));
  const topPad    = Math.max(16, Math.floor(pad * 0.66));
  const bottomPad = Math.max(34, pad + 10);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const chartX = leftPad;
  const chartY = topPad;
  const chartW = width - leftPad - rightPad;
  const chartH = height - topPad - bottomPad;

  // data bounds
  const flat = series.flatMap(s => s.values ?? []);
  const valid = flat.filter(v => typeof v === 'number' && Number.isFinite(v));
  const rawMax = valid.length ? Math.max(...valid) : 1;

  const yTickStep = opts?.yTickStep ?? 10;
  const yMin = typeof opts?.yMin === 'number' ? opts.yMin : 0; // default keeps old “0..max” feel unless overridden
  const autoYMax = roundToStep(rawMax + yTickStep * 1.5, yTickStep, 'up');
  const yMax = typeof opts?.yMax === 'number' ? opts.yMax : Math.max(yMin + yTickStep, autoYMax);
  const ySpan = Math.max(1, yMax - yMin);

  // y gridlines + ticks
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#475569';
  ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

  for (let y = roundToStep(yMin, yTickStep, 'up'); y <= yMax; y += yTickStep) {
    const yPos = chartY + chartH - ((y - yMin) / ySpan) * chartH;
    ctx.beginPath();
    ctx.moveTo(chartX, yPos);
    ctx.lineTo(chartX + chartW, yPos);
    ctx.stroke();

    const label = String(y);
    ctx.fillText(label, chartX - 8 - ctx.measureText(label).width, yPos + 4);
  }

  // x-axis line
  ctx.strokeStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(chartX, chartY + chartH);
  ctx.lineTo(chartX + chartW, chartY + chartH);
  ctx.stroke();

  // x labels (optional)
  if (opts?.labels?.length) {
    const labels = opts.labels;
    ctx.fillStyle = '#475569';
    const n = Math.max(1, labels.length);
    for (let i = 0; i < n; i++) {
      const x = chartX + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
      const txt = labels[i] ?? '';
      const tw = ctx.measureText(txt).width;
      ctx.fillText(txt, x - tw / 2, chartY + chartH + 18);
    }
  }

  // lines + points
  const palette = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7'] as const;
  series.forEach((s, idx) => {
    const vals = s.values ?? [];
    const n = vals.length;
    const stepX = n <= 1 ? chartW : chartW / (n - 1);

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      const x = chartX + i * stepX;
      const y = chartY + chartH - (((typeof v === 'number' ? v : NaN) - yMin) / ySpan) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = palette[idx % palette.length];
    ctx.stroke();

    // points
    ctx.fillStyle = palette[idx % palette.length];
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const x = chartX + (n <= 1 ? chartW / 2 : (i / (n - 1)) * chartW);
      const y = chartY + chartH - ((v - yMin) / ySpan) * chartH;
      ctx.beginPath();
      ctx.arc(x, y, 2.25, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // legend (optional)
  if (opts?.drawLegend) {
    const entries = series.map((s, i) => ({
      color: palette[i % palette.length],
      label: s.label ?? `Series ${i + 1}`,
    }));
    const swatchW = 14, gap = 8, padBox = 8, textGap = 6;
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

    const itemsWidth = entries.reduce((acc, e, i) =>
      acc + (i > 0 ? gap : 0) + swatchW + textGap + ctx.measureText(e.label).width, 0);
    const boxW = Math.min(itemsWidth + padBox * 2, chartW);
    const boxH = 20 + padBox * 2;

    const originX = (opts.legendPosition ?? 'top-right') === 'top-right'
      ? chartX + chartW - boxW - 4
      : chartX + 4;
    const originY = chartY + 4;

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(originX, originY, boxW, boxH);
    ctx.strokeStyle = '#e5e7eb';
    ctx.strokeRect(originX, originY, boxW, boxH);

    let cursorX = originX + padBox;
    const cursorY = originY + padBox + 12;
    entries.forEach((e, i) => {
      if (i > 0) cursorX += gap;
      ctx.fillStyle = e.color;
      ctx.fillRect(cursorX, cursorY - 10, swatchW, 10);
      cursorX += swatchW + textGap;
      ctx.fillStyle = '#334155';
      ctx.fillText(e.label, cursorX, cursorY);
      cursorX += ctx.measureText(e.label).width;
    });
  }

  // y-axis label (optional)
  if (opts?.yAxisLabel) {
    ctx.save();
    ctx.translate(14, chartY + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#64748b';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(opts.yAxisLabel, -ctx.measureText(opts.yAxisLabel).width / 2, 0);
    ctx.restore();
  }

  return canvas.toDataURL('image/png');
}

/**
 * Convenience wrapper for Blood Pressure charts:
 * - sensible y range
 * - weekday labels
 * - legend + axis label
 * (safe new export; existing charts unaffected)
 */
export function makeBloodPressureChartPng(
  systolic: number[],
  diastolic: number[],
  opts?: AxisLineChartOpts
): string {
  const labels = (opts?.labels && opts.labels.length === 7
    ? opts.labels
    : (['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as const));
  return makeLineChartWithAxesPng(
    [
      { label: 'Systolic', values: systolic },
      { label: 'Diastolic', values: diastolic },
    ],
    {
      
      ...(opts ?? {}),
      labels,              // set labels once
      yMin: typeof opts?.yMin === 'number' ? opts.yMin : 50,
      yMax: typeof opts?.yMax === 'number' ? opts.yMax : 180,
      yAxisLabel: opts?.yAxisLabel ?? 'mmHg',
      yTickStep: opts?.yTickStep ?? 10,
      drawLegend: opts?.drawLegend ?? true,
      legendPosition: opts?.legendPosition ?? 'top-right',
    }
  );
}
/*
Blood Sugar line chart wrapper with axis, legend and sensible defaults.
 * Supports mg/dL (default) or mmol/L with unit-based y-range presets.
 *
 * Pass up to 4 series (e.g., fasting AM, pre-meal, post-meal, bedtime),
 * each as an array of 7 numbers (Mon..Sun), use NaN for missing data. 
*/
export function makeBloodSugarChartPng(
  series: Array<{ label: string; values: number[] }>,
  opts?: AxisLineChartOpts & { unit?: "mg/dL" | "mmol/L" }
): string {
  const unit = opts?.unit ?? "mg/dL";
  // Sensible defaults; override with opts.yMin/opts.yMax if you prefer
  const defaults =
    unit === "mmol/L"
      ? { yMin: 3, yMax: 14, yAxisLabel: "mmol/L" }
      : { yMin: 50, yMax: 250, yAxisLabel: "mg/dL" };

 // Ensure labels are present (rotate/order upstream as you already do)
  const labels = (opts?.labels && opts.labels.length === 7
    ? opts.labels
    : (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const));
  return makeLineChartWithAxesPng(series, {
    ...(opts ?? {}),
    labels, // set labels once
    yAxisLabel: opts?.yAxisLabel ?? defaults.yAxisLabel,
    yMin: typeof opts?.yMin === "number" ? opts.yMin : defaults.yMin,
    yMax: typeof opts?.yMax === "number" ? opts.yMax : defaults.yMax,
    yTickStep: typeof opts?.yTickStep === "number" ? opts.yTickStep : (unit === "mmol/L" ? 1 : 10),
    drawLegend: opts?.drawLegend ?? true,
    legendPosition: opts?.legendPosition ?? "top-right",
  });
}
/**
+ * NEW: Mood AM/PM chart (two lines over Mon..Sun, y=1..5)
+ */
export function makeMoodAmPmChartPng(
  am: number[],
  pm: number[],
  opts?: AxisLineChartOpts
): string {
  const labels =
    opts?.labels && opts.labels.length === 7
      ? opts.labels
      : (["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const);
  return makeLineChartWithAxesPng(
    [
      { label: "AM", values: am.map(v => (Number.isFinite(v) ? v : NaN)) },
      { label: "PM", values: pm.map(v => (Number.isFinite(v) ? v : NaN)) },
    ],
    {
      ...(opts ?? {}),
      labels,
      yMin: 1,
      yMax: 5,
      yTickStep: 1,
      yAxisLabel: "Mood (1–5)",
      drawLegend: true,
      legendPosition: "top-right",
    }
  );
}


