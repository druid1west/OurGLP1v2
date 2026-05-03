import React from 'react';
import styles from '@/pages/Profile.module.css';

type Props = {
  percent: number;
  ariaLabel?: string;
};

const Glp1EffectivenessRing: React.FC<Props> = ({ percent, ariaLabel }) => {
  return (
    <div className={styles.glp1CircleSvg}>
      <svg
        width="72"
        height="72"
        viewBox="0 0 36 36"
        role="img"
        aria-label={
          ariaLabel ?? `Estimated medication effectiveness ${percent} percent`
        }
      >
        {/* Background ring */}
        <circle
          cx="18"
          cy="18"
          r="16"
          fill="none"
          stroke="var(--border-primary)"
          strokeWidth="4"
        />

        {/* Progress ring */}
        <circle
          cx="18"
          cy="18"
          r="16"
          fill="none"
          stroke={
            percent < 33
              ? '#e74c3c'
              : percent < 66
              ? '#f1c40f'
              : '#2ecc71'
          }
          strokeWidth="4"
          strokeDasharray={`${percent} 100`}
          strokeLinecap="round"
          transform="rotate(-90 18 18)"
        />

        {/* Center label */}
        <text
          x="18"
          y="21"
          textAnchor="middle"
          fontSize="6"
          fontWeight="700"
          fill="currentColor"
        >
          {percent}%
        </text>
      </svg>
    </div>
  );
};

export default Glp1EffectivenessRing;