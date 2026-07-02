import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { IonButton, IonPage, IonContent } from '@ionic/react';
import { Link, useHistory } from 'react-router-dom';
import styles from './Support.module.css';

import TopNav from '@/context/TopNav';
import BottomNav from '@/context/BottomNav';

import {
  getCustomerInfo as rcGetCustomerInfo,
  isProFromCustomerInfo as rcIsPro,
} from '@/lib/purchasesInit';

/* ----------------------------- types & helpers ----------------------------- */

type SubscriptionStatus =
  | { kind: 'pro'; sandbox: boolean; expiresAt?: string }
  | { kind: 'free' }
  | { kind: 'unknown' };

type RcEntitlement = {
  isSandbox?: boolean;
  expirationDate?: string | null;
  expiresDate?: string | null;
};

type RcCustomerInfoLike = {
  entitlements?: {
    active?: Record<string, RcEntitlement>;
  };
  subscriber?: {
    activeEntitlements?: Record<string, RcEntitlement>;
  };
  activeEntitlements?: Record<string, RcEntitlement>;
};

function getStatusFromCustomerInfo(ci: unknown): SubscriptionStatus {
  const obj = (ci ?? {}) as RcCustomerInfoLike;

  const active =
    obj.entitlements?.active ??
    obj.subscriber?.activeEntitlements ??
    obj.activeEntitlements ??
    {};

  const proEnt =
    active.pro ??
    active.Pro ??
    Object.values(active)[0];

  if (!proEnt) return { kind: 'free' };

  const expiresAt =
    proEnt.expiresDate ??
    proEnt.expirationDate ??
    undefined;

  return {
    kind: 'pro',
    sandbox: Boolean(proEnt.isSandbox),
    expiresAt: expiresAt ?? undefined,
  };
}

/* ------------------------------ subscription ------------------------------ */

function useSubscriptionStatus(): SubscriptionStatus {
  const [status, setStatus] = useState<SubscriptionStatus>({ kind: 'unknown' });

  useEffect(() => {
    let cancelled = false;

    const refresh = async (): Promise<void> => {
      try {
        const ci = await rcGetCustomerInfo();
        if (cancelled) return;

        if (rcIsPro(ci)) {
          const s = getStatusFromCustomerInfo(ci);
          // If rcIsPro says true but parsing fails, still treat as Pro (safe)
          if (s.kind === 'pro') setStatus(s);
          else setStatus({ kind: 'pro', sandbox: false });
        } else {
          setStatus({ kind: 'free' });
        }
      } catch {
        if (!cancelled) setStatus({ kind: 'unknown' });
      }
    };

    void refresh();
    window.addEventListener('rc:customerInfoChanged', refresh);

    return () => {
      cancelled = true;
      window.removeEventListener('rc:customerInfoChanged', refresh);
    };
  }, []);

  return status;
}

/* ---------------------------------- view ----------------------------------- */

const Support: React.FC = () => {
  const history = useHistory();
  const sub = useSubscriptionStatus();

  const subLabel = useMemo(() => {
    if (sub.kind === 'pro') return 'Pro — Active';
    if (sub.kind === 'free') return 'Not Subscribed';
    return 'Checking…';
  }, [sub]);

  const showUpgrade = sub.kind !== 'pro';

  const openPaywall = useCallback((mode?: 'manage'): void => {
    const manageParam = mode === 'manage' ? '&manage=1' : '';
    history.push(`/paywall?returnTo=/support${manageParam}`);
  }, [history]);

  const openRestore = useCallback((): void => {
    history.push('/paywall?returnTo=/support&restore=1');
  }, [history]);

  return (
    <IonPage>
      <TopNav showWhenAnon />
      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.container}>
          <h2 className={styles.title}>Support — OurGLP1</h2>
          <p className={styles.updated}>Last updated: September 25, 2025</p>

          <section className={styles.card} aria-labelledby="subscription-status-heading">
            <h3 id="subscription-status-heading" className={styles.sectionHeading}>
              Subscription Status
            </h3>

            <p className={styles.body}>
              Status: <strong>{subLabel}</strong>
              {sub.kind === 'pro' && sub.expiresAt ? (
                <> — renews/expires: {new Date(sub.expiresAt).toLocaleString()}</>
              ) : null}
            </p>

            <div className={styles.actions}>
              {showUpgrade ? (
                <IonButton onClick={() => openPaywall()} expand="block">
                  Go Pro
                </IonButton>
              ) : (
                <IonButton onClick={() => openPaywall('manage')} expand="block" fill="outline">
                  Manage Subscription
                </IonButton>
              )}

              <IonButton
                onClick={openRestore}
                expand="block"
                fill="outline"
              >
                Restore Purchases
              </IonButton>
            </div>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Subscription Plans</h3>
            <p className={styles.body}>
              OurGLP1 Pro is available as a monthly subscription at $4.99/month or a yearly
              subscription at $39.99/year, with local App Store pricing shown before purchase.
              You can manage or cancel subscriptions from your Apple ID subscription settings.
            </p>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Apple Health Sync</h3>
            <p className={styles.body}>
              With permission, OurGLP1 can read Apple Health steps, active calories, exercise
              minutes, sleep, heart rate, and workouts. This may include Apple Watch activity that
              appears in Apple Health. You can change Apple Health permissions in the Health app at
              any time.
            </p>
          </section>

          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Medical Sources</h3>
            <p className={styles.body}>
              OurGLP1 is for tracking and organization only. It does not diagnose,
              prescribe, recommend dose changes, or replace professional medical advice.
              Review the app's cited health information here:{' '}
              <Link className={styles.link} to="/medical-sources">
                Medical Sources &amp; Citations
              </Link>
              .
            </p>
          </section>

          {/* Remaining sections unchanged */}
          <section className={styles.card}>
            <h3 className={styles.sectionHeading}>Contact Us</h3>
            <p className={styles.body}>
              If you need assistance with the app, have questions about subscriptions, or want to
              report a bug:
            </p>
            <ul className={styles.list}>
              <li>
                Email:{' '}
                <a className={styles.link} href="mailto:support@ourglp1.com">
                  support@ourglp1.com
                </a>
              </li>
              <li>
                General info:{' '}
                <a className={styles.link} href="mailto:info@ourglp1.com">
                  info@ourglp1.com
                </a>
              </li>
              <li>
                Privacy/data requests:{' '}
                <a className={styles.link} href="mailto:privacy@ourglp1.com">
                  privacy@ourglp1.com
                </a>
              </li>
            </ul>
            <p className={styles.body}>Typical reply time: within 1–2 business days.</p>
          </section>

          {/* … keep your other sections as-is … */}
        </div>
      </IonContent>
      <BottomNav showWhenAnon />
    </IonPage>
  );
};

export default Support;
