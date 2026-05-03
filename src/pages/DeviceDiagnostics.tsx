// src/pages/DeviceDiagnostics.tsx
import React, { useEffect, useRef } from 'react';
import dayjs from 'dayjs';
import { logger } from '../utils/logger';
import { PushNotifications, type Token } from '@capacitor/push-notifications';
import {
  IonPage,
  IonHeader,
  IonTitle,
  IonContent,
  IonButton,
  IonList,
  IonItem,
  IonLabel,
} from '@ionic/react';

// ✅ the ONLY place that is allowed to call requestPermissions() lives elsewhere
import { reinitPushPermissions } from '../utils/reinitPushPermissions';

import styles from './DeviceDiagnostics.module.css';

type Perm = 'granted' | 'denied' | 'prompt' | 'limited' | 'unknown';

async function sha256hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type Snap = {
  perm: Perm;
  tokenHash12: string;
  lastRegISO: string;
  deepLinkResult: string;
};

const initialSnap: Snap = {
  perm: 'unknown',
  tokenHash12: '',
  lastRegISO: '',
  deepLinkResult: '',
};

export default function DeviceDiagnostics(): React.ReactElement {
  const permRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef<HTMLDivElement | null>(null);
  const lastRegRef = useRef<HTMLDivElement | null>(null);
  const deepRef = useRef<HTMLPreElement | null>(null);

  const busyRef = useRef<boolean>(false);
  const snapRef = useRef<Snap>({ ...initialSnap });

  function render(): void {
    const s = snapRef.current;

    if (permRef.current) permRef.current.textContent = s.perm;
    if (tokenRef.current) tokenRef.current.textContent = s.tokenHash12 || '—';

    if (lastRegRef.current) {
      lastRegRef.current.textContent = s.lastRegISO
        ? dayjs(s.lastRegISO).format('YYYY-MM-DD HH:mm:ss')
        : '—';
    }

    if (deepRef.current) deepRef.current.textContent = s.deepLinkResult || '—';
  }

  async function refreshStatus(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const p = await PushNotifications.checkPermissions();
      // Capacitor types: receive is one of granted/denied/prompt/limited
      const receive = (p as { receive?: Perm }).receive ?? 'unknown';
      snapRef.current.perm = receive;
      render();
    } catch (e) {
      logger.warn('[push] checkPermissions failed', e);
    } finally {
      busyRef.current = false;
    }
  }

  async function openPermissionPrompt(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      // ✅ this is your single-source prompt wrapper
      await reinitPushPermissions();
      // after user action, re-check and display updated state
      await refreshStatus();
    } catch (e) {
      logger.warn('[push] reinitPushPermissions failed', e);
    } finally {
      busyRef.current = false;
    }
  }

  async function registerToken(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      // ✅ no prompt here; just register (will succeed only if permitted)
      await PushNotifications.register();
    } catch (e) {
      logger.warn('[push] register failed', e);
    } finally {
      busyRef.current = false;
    }
  }

  async function sendTest(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'device-diagnostics' }),
      });

      let msg = 'Test push queued ✓';
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        msg = `Push test failed: ${res.status} ${JSON.stringify(j)}`;
      }
      alert(msg);
    } catch (e) {
      alert('Push test failed: network error');
      logger.warn('[push] test error', e);
    } finally {
      busyRef.current = false;
    }
  }

  useEffect(() => {
    let mounted = true;

    const onRegistration = (t: Token) => {
      void (async () => {
        try {
          const h = await sha256hex(t.value);
          if (!mounted) return;
          snapRef.current.tokenHash12 = h.slice(0, 12);
          snapRef.current.lastRegISO = new Date().toISOString();
          render();
        } catch (e) {
          logger.warn('[push] hash failed', e);
        }
      })();
    };

    const onRegError = (e: unknown) => {
      logger.warn('[push] registrationError', e);
    };

    const onReceived = (n: { title?: string | null }) => {
      logger.info('[push] received', { title: n.title ?? '' });
    };

    const onAction = (n: { notification?: { data?: unknown } }) => {
      try {
        const data = n.notification?.data ?? {};
        snapRef.current.deepLinkResult = JSON.stringify(data, null, 2);
      } catch {
        snapRef.current.deepLinkResult = '{}';
      }
      render();
    };

    PushNotifications.addListener('registration', onRegistration);
    PushNotifications.addListener('registrationError', onRegError);
    // keep these minimal & safe
    PushNotifications.addListener('pushNotificationReceived', onReceived as never);
    PushNotifications.addListener('pushNotificationActionPerformed', onAction as never);

    // initial read-only refresh
    void refreshStatus();

    return () => {
      mounted = false;
      // NOTE: removeAllListeners is global; acceptable for a diagnostics screen,
      // but if you have other screens registering listeners too, switch to per-handle remove().
      PushNotifications.removeAllListeners().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <IonPage>
      <IonHeader>
        <IonTitle>Device Diagnostics</IonTitle>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonList>
          <IonItem>
            <IonLabel>Permission</IonLabel>
            <div ref={permRef}>—</div>
          </IonItem>

          <IonItem>
            <IonLabel>Token (hash12)</IonLabel>
            <div ref={tokenRef}>—</div>
          </IonItem>

          <IonItem>
            <IonLabel>Last registered</IonLabel>
            <div ref={lastRegRef}>—</div>
          </IonItem>

          <IonItem lines="none">
            <IonLabel>Deep-link result</IonLabel>
          </IonItem>

          <IonItem lines="full">
            <pre ref={deepRef} className={styles.preWrap}>
              —
            </pre>
          </IonItem>
        </IonList>

        <div className={styles.actionsGrid}>
          <IonButton
            onClick={() => {
              void refreshStatus();
            }}
          >
            Refresh status
          </IonButton>

          <IonButton
            onClick={() => {
              void openPermissionPrompt();
            }}
          >
            Open permission prompt
          </IonButton>

          <IonButton
            onClick={() => {
              void registerToken();
            }}
          >
            Register token
          </IonButton>

          <IonButton
            onClick={() => {
              void sendTest();
            }}
          >
            Send me a test push
          </IonButton>
        </div>
      </IonContent>
    </IonPage>
  );
}


