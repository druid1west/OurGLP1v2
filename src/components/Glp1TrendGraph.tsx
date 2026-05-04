import React, { useMemo } from 'react';

import type { Glp1GraphPoint } from '../db/EffectivenessRepository';
import { getGlp1TrendAnchorDate, getGlp1VisibleWeekPoints } from '../lib/glp1Trend';
import styles from './Glp1TrendGraph.module.css';

type Props = {
  points: Glp1GraphPoint[];
  injectionDay?: string | null;
  timezone: string;
  compact?: boolean;
  emptyLabel?: string;
  showLegend?: boolean;
};

const Glp1TrendGraph: React.FC<Props> = ({
  points,
  injectionDay,
  timezone,
  compact = false,
  emptyLabel = 'No hunger or nausea logs in this injection week yet.',
  showLegend = true,
}) => {
  const width = 340;
  const height = compact ? 190 : 220;
  const paddingLeft = 36;
  const paddingRight = 20;
  const paddingTop = 18;
  const paddingBottom = compact ? 42 : 50;

  const anchorDate = useMemo(
    () => getGlp1TrendAnchorDate(injectionDay, timezone),
    [injectionDay, timezone]
  );
  const minTime = anchorDate.getTime();
  const maxTime = minTime + 7 * 24 * 60 * 60 * 1000;

  const visiblePoints = useMemo(
    () => getGlp1VisibleWeekPoints(points, injectionDay, timezone),
    [points, injectionDay, timezone]
  );

  if (visiblePoints.length === 0) {
    return <div className={styles.emptyState}>{emptyLabel}</div>;
  }

  const scaleX = (timestamp: string): number => {
    const time = new Date(timestamp).getTime();
    const ratio = (time - minTime) / (maxTime - minTime);
    return paddingLeft + ratio * (width - paddingLeft - paddingRight);
  };

  const scaleY = (value: number): number => {
    const ratio = value / 10;
    return height - paddingBottom - ratio * (height - paddingTop - paddingBottom);
  };

  const linePath = (key: 'hunger' | 'nausea'): string =>
    visiblePoints
      .map((point, index) =>
        `${index === 0 ? 'M' : 'L'} ${scaleX(point.recordedAt)} ${scaleY(point[key])}`
      )
      .join(' ');

  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const dayLabels = Array.from({ length: 8 }, (_, index) => {
    const date = new Date(anchorDate);
    date.setDate(date.getDate() + index);
    return {
      x: paddingLeft + (index / 7) * (width - paddingLeft - paddingRight),
      label: fmt.format(date),
      isAnchor: index === 0,
    };
  });
  const yLabels = [0, 2, 4, 6, 8, 10];

  return (
    <div className={`${styles.graphWrap} ${compact ? styles.compact : ''}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={styles.graphSvg}
        role="img"
        aria-label="Hunger and nausea trend over the current injection week"
      >
        {yLabels.map((value) => (
          <line
            key={`grid-${value}`}
            x1={paddingLeft}
            y1={scaleY(value)}
            x2={width - paddingRight}
            y2={scaleY(value)}
            className={styles.graphGrid}
          />
        ))}

        {dayLabels.slice(0, -1).map((day, index) => (
          <line
            key={`vline-${index}`}
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

        <path d={linePath('hunger')} className={styles.graphHunger} />
        <path d={linePath('nausea')} className={styles.graphNausea} />

        {visiblePoints.map((point, index) => (
          <g key={`${point.recordedAt}-${index}`}>
            <circle
              cx={scaleX(point.recordedAt)}
              cy={scaleY(point.hunger)}
              r="4"
              className={styles.graphHungerPoint}
            />
            <circle
              cx={scaleX(point.recordedAt)}
              cy={scaleY(point.nausea)}
              r="4"
              className={styles.graphNauseaPoint}
            />
          </g>
        ))}

        {yLabels.map((value) => (
          <text
            key={`ylabel-${value}`}
            x={paddingLeft - 10}
            y={scaleY(value)}
            className={styles.graphYLabel}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {value}
          </text>
        ))}

        {dayLabels.map((day, index) => (
          <text
            key={`xlabel-${index}`}
            x={day.x}
            y={height - paddingBottom + 22}
            className={day.isAnchor ? styles.graphXLabelAnchor : styles.graphXLabel}
            textAnchor="middle"
          >
            {day.label}
          </text>
        ))}

        <text
          x={paddingLeft}
          y={paddingTop - 6}
          className={styles.graphInjectionLabel}
          textAnchor="start"
        >
          Injection day
        </text>
      </svg>

      {showLegend && (
        <div className={styles.graphLegend}>
          <span className={styles.legendHunger}>Hunger</span>
          <span className={styles.legendNausea}>Nausea</span>
        </div>
      )}
    </div>
  );
};

export default Glp1TrendGraph;
