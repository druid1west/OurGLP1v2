// src/pages/Unsubscribe.tsx
import React, { useCallback, useMemo, useState } from 'react';
import { IonButton, IonToast } from '@ionic/react';
import styles from './Unsubscribe.module.css';
import { useAuth } from '../context/useAuth';
import { useIonRouter } from '@ionic/react';
import type { Color } from '@ionic/core';

type ToastState = {
  open: boolean;
  msg: string;
  color?: Color; // primary|secondary|tertiary|success|warning|danger|light|medium|dark
};

const Unsubscribe: React.FC = () => {
  const router = useIonRouter();
  const { user } = useAuth();

  const [toast, setToast] = useState<ToastState>({ open: false, msg: '' });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const getDisplayName = (u: unknown): string => {
  if (u && typeof u === 'object') {
    const obj = u as Record<string, unknown>;
    const first = obj['first_name'];
    const firstAlt = obj['firstName'];
    if (typeof first === 'string') return first;
    if (typeof firstAlt === 'string') return firstAlt;
  }
  return '';
};

// ...
const displayName = useMemo(() => getDisplayName(user), [user]);

  const unsubToken = useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('t') || '';
  }, []);

  const handleOpenReminders = useCallback(() => {
    router.push('/reminders');
  }, [router]);

  const handleUnsub = useCallback(async () => {
   if (!unsubToken) {
      setToast({ open: true, msg: 'Missing unsubscribe token.', color: 'danger' });
      return;
    }
    try {
      setBusy(true);
      // Backend returns HTML; we only care about success/failure status.
       const res = await fetch(`/api/reminders/unsubscribe?t=${encodeURIComponent(unsubToken)}`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'text/html' },
      });

      if (res.ok) {
        setDone(true);
        setToast({ open: true, msg: 'Email turned off for this reminder.', color: 'success' });
      } else {
        setToast({ open: true, msg: 'Unsubscribe failed. The link may be expired.', color: 'warning' });
      }
    } catch {
      setToast({ open: true, msg: 'Network error while unsubscribing.', color: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [unsubToken]);

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.title}>Unsubscribe from email for this reminder</h1>

      {!done && (
        <div className={styles.card}>
          <p className={styles.lead}>
            {displayName ? (<><strong>{displayName}</strong>, </>) : null}
            here’s exactly what will happen if you continue:
          </p>
          <ul className={styles.list}>
            <li>
              We’ll use the secure link you opened (a short-lived signed token) to
              identify <em>one</em> of your reminders.
            </li>
            <li>
              The server will remove <strong>email</strong> from that reminder’s delivery methods.
              Your push/in-app notifications stay the same.
            </li>
            <li>
              If email was the only method left, the reminder will be set to <em>disabled</em> to keep things tidy.
            </li>
            <li>
              You can turn email back on any time by editing the reminder on the Reminders page,
              or by creating a new reminder.
            </li>
          </ul>

          <div className={styles.actions}>
            <IonButton expand="block" onClick={handleUnsub} disabled={busy}>
              {busy ? 'Unsubscribing…' : 'Unsubscribe from email'}
            </IonButton>
            <IonButton fill="clear" onClick={handleOpenReminders}>
              Open Reminders
            </IonButton>
          </div>

          <p className={styles.fineprint}>
            This doesn’t close your account or change your profile. It only affects <em>email</em>
            for the specific reminder identified by this link.
          </p>
        </div>
      )}

      {done && (
        <div className={styles.card}>
          <p className={styles.lead}>
            {displayName ? (<><strong>{displayName}</strong>, </>) : null}
            you’ve been unsubscribed from <strong>email</strong> for this reminder.
          </p>
          <p>
            Push notifications are unchanged. If email was the only method, this reminder is now disabled.
            You can re-enable email any time from the Reminders page.
          </p>

          <div className={styles.actions}>
            <IonButton expand="block" onClick={handleOpenReminders}>
              Open Reminders
            </IonButton>
          </div>
        </div>
      )}

      <IonToast
        isOpen={toast.open}
        onDidDismiss={() => setToast({ ...toast, open: false })}
        message={toast.msg}
        duration={2200}
        color={toast.color}
      />
    </div>
  );
};

export default Unsubscribe;