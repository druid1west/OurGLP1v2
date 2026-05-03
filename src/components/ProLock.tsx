// src/components/ProLock.tsx
import React from 'react';
import { LockKeyhole } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import styles from './ProLock.module.css';

export function ProLock({
  children,
  cta = 'Unlock with Pro',
  onClick
}: { children: React.ReactNode; cta?: string; onClick?: () => void }) {
  const { isPro } = useAuth();
  if (isPro) return <>{children}</>;

  return (
    <div className={styles.container}>
      <div className={styles.dimmedContent}>{children}</div>
      <button
        type="button"
        onClick={onClick ?? (() => (window.location.href = '/paywall'))}
        className={styles.lockButton}
      >
        <LockKeyhole size={16} aria-hidden />
        <span>{cta}</span>
      </button>
    </div>
  );
}
