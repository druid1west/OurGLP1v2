// src/pages/Home.tsx
import { checkBiometricAvailable, verifyIdentity } from '../utils/biometric';
import { getLatestEmailPasswordAccount, hasSavedEmailPasswordAccount } from '../db/LocalAccountRepository';
import { markUserAsLoggedIn, getUserByEmail, registerLocalUser } from '../services/localAuth';

import React, { useEffect, useState } from 'react';
import { IonPage, IonContent, IonButton, useIonRouter } from '@ionic/react';
import { useLocation } from 'react-router-dom';
import PageLayout from '../components/PageLayout';
import styles from './Home.module.css';

import { useAuth } from '../context/useAuth';
import { Capacitor } from '@capacitor/core';

import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';

import { trackEvent } from '../telemetry/analytics';
import { setupPushTokenListener, claimTokenForUser } from '../utils/pushManager';
import { IS_LOCAL_AUTH } from '../config/runtime';

type BioDeniedReason =
  | 'user_cancel'
  | 'no_biometrics'
  | 'lockout'
  | 'system_cancel'
  | 'unknown';

interface LocalAccount {
  id?: string;
  email?: string | null;
}

// Build-time constant (frozen so it’s not a hook dependency)
const LOCAL_AUTH_ENABLED: boolean = IS_LOCAL_AUTH;

function isErrWithMessage(e: unknown): e is { message: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as { message?: unknown }).message === 'string'
  );
}

function getErrorMessage(e: unknown): string {
  return isErrWithMessage(e) ? e.message : 'Biometric login failed';
}

function reasonFromMessage(message: string): BioDeniedReason {
  const m = message.toLowerCase();
  if (m.includes('cancel')) return 'user_cancel';
  if (m.includes('no biometric') || m.includes('not available')) return 'no_biometrics';
  if (m.includes('lock')) return 'lockout';
  if (m.includes('system')) return 'system_cancel';
  return 'unknown';
}

function getHasPro(u: unknown): boolean {
  if (typeof u !== 'object' || u === null) return false;
  const maybe = u as { has_pro?: unknown; subscription_tier?: unknown; pro_until?: unknown };
  if (maybe.has_pro !== true && maybe.subscription_tier !== 'pro') return false;
  if (typeof maybe.pro_until !== 'string') return false;
  const until = Date.parse(maybe.pro_until);
  return Number.isFinite(until) && until > Date.now();
}

async function ensureUsersRowForLocalAccount(
  acctId: string,
  emailRaw: string,
  first?: string | null,
  last?: string | null,
): Promise<string> {
  const email = emailRaw.trim().toLowerCase();
  const existing = await getUserByEmail(email);
  if (existing?.id) return existing.id;

  const tz =
    (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';

  try {
    await registerLocalUser({
      id: acctId,
      email,
      first_name: first ?? null,
      last_name: last ?? null,
      timezone: tz,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/unique|constraint/i.test(msg)) throw e;
  }

  const created = await getUserByEmail(email);
  if (!created?.id) throw new Error(`Failed to create/find local user record for ${email}`);
  return created.id;
}

/**
 * Simple check: show biometric button whenever
 *  - local auth is enabled in this build
 *  - and device has some enrolled biometric (face / fingerprint)
 */
async function isBiometricReady(): Promise<boolean> {
  if (!LOCAL_AUTH_ENABLED) return false;
  try {
    const ok = await checkBiometricAvailable();
    return ok;
  } catch {
    return false;
  }
}

const Home: React.FC = () => {
  const router = useIonRouter();
  const location = useLocation();
  const { user, refreshUser } = useAuth();

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [bioReady, setBioReady] = useState(false);
  const [localAccountChecked, setLocalAccountChecked] = useState(false);
  const [hasSavedLocalAccount, setHasSavedLocalAccount] = useState(false);

  const platform = Capacitor.getPlatform();
  const isAndroid = platform === 'android';
  const isIos = platform === 'ios';

  useEffect(() => {
    (async () => {
      try {
        setBioReady(await isBiometricReady());
      } catch {
        setBioReady(false);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void hasSavedEmailPasswordAccount()
      .then((hasSavedAccount) => {
        if (cancelled) return;
        setHasSavedLocalAccount(hasSavedAccount);
      })
      .catch(() => {
        if (!cancelled) setHasSavedLocalAccount(false);
      })
      .finally(() => {
        if (!cancelled) setLocalAccountChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (user && (location.pathname === '/home' || location.pathname === '/')) {
      router.push('/today', 'root');
    }
  }, [location.pathname, router, user]);

  const completeLocalLogin = async (): Promise<void> => {
    const acctRaw = await getLatestEmailPasswordAccount();
    const acct = (acctRaw ?? {}) as LocalAccount;
    if (!acct.id) {
      setErrorMsg('No local account found. Please register.');
      return;
    }

    const userId = await ensureUsersRowForLocalAccount(acct.id, String(acct.email ?? ''));
    await markUserAsLoggedIn(userId);
    await refreshUser();

    try {
      setupPushTokenListener();
      await claimTokenForUser();
    } catch {
      // optional in dev
    }

    trackEvent('biometric_login_success', { platform });
    router.push('/today', 'forward');
  };

  // Biometric path: verify only (no credentials saved/fetched)
  const handleFaceIDLogin = async (): Promise<void> => {
    if (!LOCAL_AUTH_ENABLED) {
      setErrorMsg('Local auth is disabled in this build.');
      return;
    }
    setIsAuthenticating(true);
    setErrorMsg('');
    try {
      const ok = await verifyIdentity({ reason: 'Authenticate to sign in' });
      if (!ok) {
        setErrorMsg('Authentication canceled.');
        trackEvent('biometric_denied', { reason: 'user_cancel' as BioDeniedReason });
        return;
      }
      await completeLocalLogin();
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      const reason: BioDeniedReason = reasonFromMessage(message);
      trackEvent('biometric_denied', { reason });
      setErrorMsg(message);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const isPro = getHasPro(user);

  // Measure nav heights → CSS vars
  useEffect(() => {
    const top = document.getElementById('topNav');
    const bottom = document.getElementById('bottomNav');
    const root = document.documentElement;

    const applyHeights = () => {
      const topH = top?.getBoundingClientRect().height ?? 0;
      const botH = bottom?.getBoundingClientRect().height ?? 0;
      if (topH >= 44) root.style.setProperty('--top-nav-height', `${Math.round(topH)}px`);
      if (botH >= 48) root.style.setProperty('--bottom-nav-height', `${Math.round(botH)}px`);
    };

    const raf1 = requestAnimationFrame(applyHeights);
    const t = setTimeout(applyHeights, 120);

    const roTop = top ? new ResizeObserver(applyHeights) : null;
    const roBot = bottom ? new ResizeObserver(applyHeights) : null;
    roTop?.observe(top as Element);
    roBot?.observe(bottom as Element);

    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(t);
      roTop?.disconnect();
      roBot?.disconnect();
    };
  }, []);

  const biometricButtonLabel = isIos ? 'Login with Face ID' : 'Login with biometrics';

  return (
    <IonPage>
      <TopNav showWhenAnon />

      {/* Make IonContent transparent & padded via global.css */}
      

<IonContent id="homeContent" fullscreen className="viewportBetweenNavs homeContent">
<div className="pageScroll">
<div className={styles.pageBg}>
<PageLayout transparent>
<div className={`${styles.container} ${styles.containerTransparent}`}>
{/* Pinned/centered hero */}
<div className={styles.hero}>
<div className={styles.logoWrap}>
<img src="/assets/logo1.png" alt="GLP-1 Logo" className={styles.logo} />
</div>


<h1 className={`${styles.title} ${isAndroid ? styles.titleAndroidNudge : ''}`}>
Your GLP-1 Companion
</h1>


<p className={styles.subtitle}>
Simple daily support for protein, water, check-ins, and GLP-1 routines.
</p>
</div>


{/* Buttons live separately so hero doesn't move */}
<div className={styles.actions}>
{localAccountChecked && !hasSavedLocalAccount && (
<>
<IonButton onClick={() => router.push('/coach', 'forward')} className={styles.primaryBtn} expand="block">
Create local account
</IonButton>

<IonButton onClick={() => router.push('/coach', 'forward')} className={styles.secondaryBtn} expand="block" fill="outline">
Start with Coach
</IonButton>
</>
)}


{localAccountChecked && hasSavedLocalAccount && platform !== 'web' && bioReady && (
<IonButton
className={styles.primaryBtn}
expand="block"
onClick={handleFaceIDLogin}
disabled={isAuthenticating}
>
{isAuthenticating ? 'Authenticating…' : biometricButtonLabel}
</IonButton>
)}


{localAccountChecked && hasSavedLocalAccount && (
<>
<IonButton onClick={() => router.push('/login', 'forward')} className={styles.primaryBtn} expand="block">
Login with Email &amp; Password
</IonButton>


<IonButton onClick={() => router.push('/register', 'forward')} className={styles.primaryBtn} expand="block">
Register for an Account
</IonButton>
</>
)}


{!isPro && (
<IonButton onClick={() => router.push('/coach', 'forward')} className={styles.primaryBtn} expand="block">
Start setup with Coach
</IonButton>
)}


{errorMsg && <p className={styles.errorMessage}>{errorMsg}</p>}
</div>
</div>
</PageLayout>
</div>
</div>
</IonContent>

      <BottomNav showWhenAnon />
    </IonPage>
  );
};

export default Home;
