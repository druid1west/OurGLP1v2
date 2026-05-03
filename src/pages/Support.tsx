import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { IonButton, IonPage, IonContent } from '@ionic/react';
import styles from './Support.module.css';

import TopNav from '@/context/TopNav';
import BottomNav from '@/context/BottomNav';

import {
  purchaseById,
  restorePurchases as rcRestorePurchases,
  getCustomerInfo as rcGetCustomerInfo,
  isProFromCustomerInfo as rcIsPro,
  openManageSubscriptions,
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

function toMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const data = obj.data as Record<string, unknown> | undefined;
    const underlying =
      typeof data?.underlyingErrorMessage === 'string' ? data.underlyingErrorMessage : undefined;
    const dataMsg = typeof data?.message === 'string' ? data.message : undefined;
    const msg = typeof obj.message === 'string' ? (obj.message as string) : undefined;
    return underlying ?? dataMsg ?? msg ?? 'Unknown error';
  }
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
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

async function waitForPro(timeoutMs = 12000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ci = await rcGetCustomerInfo();
      if (rcIsPro(ci)) return true;
    } catch {
      // ignore; retry
    }
    await new Promise((r) => setTimeout(r, 650));
  }
  return false;
}

/* ---------------------------------- view ----------------------------------- */

const Support: React.FC = () => {
  const sub = useSubscriptionStatus();

  const [busyBuy, setBusyBuy] = useState<boolean>(false);
  const [busyRestore, setBusyRestore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const subLabel = useMemo(() => {
    if (sub.kind === 'pro') return sub.sandbox ? 'Pro — Sandbox (Test)' : 'Pro — Active';
    if (sub.kind === 'free') return 'Not Subscribed';
    return 'Checking…';
  }, [sub]);

  const showUpgrade = sub.kind !== 'pro';

  const doPurchase = useCallback(async (): Promise<void> => {
    if (busyBuy) return;
    setError(null);
    setBusyBuy(true);
    try {
      await purchaseById();
      const active = await waitForPro(15000);
      if (!active) {
        setError('Purchase completed but Pro is not active yet. Try “Restore Purchases”.');
        return;
      }
      alert('Thanks for upgrading! Pro is active.');
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusyBuy(false);
    }
  }, [busyBuy]);

  const doRestore = useCallback(async (): Promise<void> => {
    if (busyRestore) return;
    setError(null);
    setBusyRestore(true);
    try {
      await rcRestorePurchases();
      const active = await waitForPro(10000);
      if (!active) {
        setError('No active subscription found to restore for this account.');
        return;
      }
      alert('Purchases restored. Pro is active.');
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusyRestore(false);
    }
  }, [busyRestore]);

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
                <IonButton onClick={() => void doPurchase()} expand="block" disabled={busyBuy}>
                  {busyBuy ? 'Processing…' : 'Go Pro'}
                </IonButton>
              ) : (
                <IonButton onClick={() => openManageSubscriptions()} expand="block" fill="outline">
                  Manage Subscription
                </IonButton>
              )}

              <IonButton
                onClick={() => void doRestore()}
                expand="block"
                fill="outline"
                disabled={busyRestore}
              >
                {busyRestore ? 'Restoring…' : 'Restore Purchases'}
              </IonButton>
            </div>

            {error && <div className={styles.errorBox}>{error}</div>}

            <p className={`${styles.body} ${styles.note}`}>
              Testers: if you’re using a sandbox/test account, the status will show{' '}
              <em>“Pro — Sandbox (Test)”</em>.
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







