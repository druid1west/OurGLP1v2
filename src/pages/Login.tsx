// src/pages/Login.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  IonPage,
  IonContent,
  IonButton,
  IonItem,
  IonLabel,
  IonToast,
  IonSpinner,
  IonIcon,
  useIonViewWillEnter,
} from '@ionic/react';
import { eyeOutline, eyeOffOutline } from 'ionicons/icons';
import { Link, useHistory } from 'react-router-dom';
import styles from './Login.module.css';

import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';

// Local DB account storage (biometrics + password hash)
import {
  initLocalAccountTable,
  getLatestEmailPasswordAccount,
  verifyAndLoginLocal,
} from '@/db/LocalAccountRepository';

// ✅ Biometrics: verify only (no password fetch/store)
import { verifyIdentity, shouldShowBiometricButton } from '@/utils/biometric';
import { enableBiometricForUser } from '@/native/biometricGate';
import { Preferences } from '@capacitor/preferences';

// Local DB “users” helpers
import {
  getUserByEmail,
  registerLocalUser,
  markUserAsLoggedIn,
} from '@/services/localAuth';

// Auth context
import { useAuth } from '@/context/useAuth';

// Build-time flag (frozen to avoid hook dep warnings)
import { IS_LOCAL_AUTH } from '@/config/runtime';
const LOCAL_AUTH_ENABLED: boolean = IS_LOCAL_AUTH;

interface ToastState {
  open: boolean;
  msg: string;
  color?: 'danger' | 'success';
}

interface LocalState {
  id: string | null;
  email: string | null;
  hasPw: boolean;
  bioBound: boolean;
  initialized: boolean;
}

const LAST_USER_KEY = 'last_user_id';

// Decides if we can show the biometric button (handles simulator & availability)
async function isBiometricReady(): Promise<boolean> {
  const ok = await shouldShowBiometricButton();
  if (!ok) return false;
  const { value } = await Preferences.get({ key: LAST_USER_KEY });
  return Boolean(value);
}

const Login: React.FC = () => {
  const history = useHistory();
  const { refreshUser } = useAuth();

  const [emailInput, setEmailInput] = useState<string>('');
  const [pwInput, setPwInput] = useState<string>('');
  const [showPw, setShowPw] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastState>({ open: false, msg: '' });

  const [state, setState] = useState<LocalState>({
    id: null,
    email: null,
    hasPw: false,
    bioBound: false,
    initialized: false,
  });

  const show = useCallback(
    (msg: string, color: 'danger' | 'success' = 'danger') =>
      setToast({ open: true, msg, color }),
    [],
  );

  const reloadAccounts = useCallback(async (): Promise<void> => {
    await initLocalAccountTable();
    const acct = await getLatestEmailPasswordAccount();
    const bio = await isBiometricReady();
    setState({
      id: acct?.id ?? null,
      email: acct?.email ?? null,
      hasPw: Boolean(acct?.password_hash),
      bioBound: bio,
      initialized: true,
    });
    if (acct?.email) setEmailInput(acct.email);
  }, []);

  useEffect(() => {
    void reloadAccounts();
  }, [reloadAccounts]);

  useIonViewWillEnter(() => {
    void reloadAccounts();
  });

  useEffect(() => {
    const onAuthChanged = (): void => {
      void reloadAccounts();
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void reloadAccounts();
      }
    };
    window.addEventListener('auth:changed', onAuthChanged);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('auth:changed', onAuthChanged);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reloadAccounts]);

  const ensureUsersRowForLocalAccount = useCallback(
    async (
      acctId: string,
      emailRaw: string,
      first?: string | null,
      last?: string | null,
    ): Promise<string> => {
      const email = emailRaw.trim().toLowerCase();
      const existing = await getUserByEmail(email);
      if (existing?.id) return existing.id;

      const tz =
        (typeof Intl !== 'undefined' &&
          Intl.DateTimeFormat().resolvedOptions().timeZone) ||
        'UTC';

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
      if (!created?.id)
        throw new Error(`Failed to create/find local user record for ${email}`);
      return created.id;
    },
    [],
  );

  const completeLogin = useCallback(
    async (acctId: string | null, email: string | null): Promise<void> => {
      if (!acctId || !email) {
        show('No local account found. Please create an account.');
        return;
      }
      const userId = await ensureUsersRowForLocalAccount(acctId, email);
      await markUserAsLoggedIn(userId);
      await refreshUser();
      window.dispatchEvent(new Event('auth:changed'));
      history.replace('/today');
    },
    [ensureUsersRowForLocalAccount, history, refreshUser, show],
  );

  // Face ID / Touch ID → verify only, never fetch or store password
  const handleBiometricLogin = useCallback(async (): Promise<void> => {
    if (!LOCAL_AUTH_ENABLED) {
      show('Local auth is disabled in this build.');
      return;
    }
    if (!state.bioBound) {
      show('Biometric login not set up on this device.');
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyIdentity({
        reason: 'Unlock with Face ID / Touch ID',
      });
      if (!ok) {
        show('Authentication canceled.');
        return;
      }
      await completeLogin(state.id, state.email);
    } catch {
      show('Face ID failed. Use password.');
    } finally {
      setBusy(false);
    }
  }, [state.bioBound, state.email, state.id, completeLogin, show]);

  // Password login → verify locally, then enable gate (no password saved)
  const handlePasswordLogin = useCallback(async (): Promise<void> => {
    if (!LOCAL_AUTH_ENABLED) {
      show('Local auth is disabled in this build.');
      return;
    }
    if (busy) return;
    setBusy(true);

    // Snapshot & clear password immediately to avoid accidental logging anywhere
    const typedEmail = emailInput.trim().toLowerCase();
    const pwLocal = pwInput;
    setPwInput('');

    try {
      const acct = await getLatestEmailPasswordAccount();
      if (!acct?.password_hash || !acct?.id || !acct?.email) {
        show('No password set or account missing. Please create an account.');
        return;
      }

      const storedEmail = acct.email.trim().toLowerCase();
      if (typedEmail && typedEmail !== storedEmail) {
        show('This email does not match the local account on this device.');
        return;
      }

      const verified = await verifyAndLoginLocal(acct.email, pwLocal);
      if (!verified) {
        show('Incorrect password.');
        return;
      }

      // Enable biometric gate for future logins WITHOUT saving the password
      await enableBiometricForUser(acct.id);

      await completeLogin(acct.id, acct.email);
    } catch {
      show('Login failed. Try again.');
    } finally {
      setBusy(false);
      // Ensure no lingering reference to pwLocal
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (function forget(_p: string): void {
        /* hint GC */
      })(pwLocal);
    }
  }, [busy, emailInput, pwInput, completeLogin, show]);

  if (!state.initialized) {
    return (
      <IonPage>
        <TopNav showWhenAnon />
        <IonContent fullscreen className={styles.contentPad}>
          <div className={styles.centerWrap}>
            <div className={styles.container}>
              <h2 className={styles.title}>Login</h2>
              <IonSpinner />
            </div>
          </div>
        </IonContent>
        <BottomNav showWhenAnon />
      </IonPage>
    );
  }

  const { hasPw, bioBound } = state;

  return (
    <IonPage>
      <TopNav showWhenAnon />
      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.pageBg}>
          <div className={styles.container}>
            <h2 className={styles.title}>Welcome back</h2>
            <p className={styles.helperText}>
              Your account is stored on this device. Optional Apple Health sync can add steps,
              activity, sleep, heart rate, and workouts after you grant permission.
            </p>

            {bioBound && (
  <IonButton
    expand="block"
    className={`${styles.mb12} custom-button`}
    onClick={handleBiometricLogin}
    disabled={busy}
  >
    {busy ? 'Authenticating…' : 'Continue with Face ID'}
  </IonButton>
)}

{bioBound && hasPw && <div className={styles.orDivider}>or</div>}

{hasPw ? (
  <>
  <IonItem
  lines="none"
  className={`${styles.itemNoLines} custom-input-item`}
>
  <IonLabel id="loginEmailLabel" position="stacked">
    Email
  </IonLabel>

  <input
    id="loginEmail"
    type="email"
    value={emailInput}
    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
      setEmailInput(e.target.value)
    }
    className={`native-input-white ${styles.input}`}
    autoComplete="off"
    aria-labelledby="loginEmailLabel"
    placeholder="Enter your email"
  />
</IonItem>

    <IonItem
  lines="none"
  className={`${styles.itemNoLines} custom-input-item`}
>
  <IonLabel id="loginPasswordLabel" position="stacked">
    Password
  </IonLabel>

  <div className={styles.inputBox}>
    <input
      id="loginPassword"
      type={showPw ? 'text' : 'password'}
      value={pwInput}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        setPwInput(e.target.value)
      }
      className={`native-input-white ${styles.input} ${styles.inputWithEye}`}
      autoComplete="current-password"
      aria-labelledby="loginPasswordLabel"
      placeholder="Enter your password"
    />

    <button
      type="button"
      onClick={() => setShowPw((s) => !s)}
      aria-label={showPw ? 'Hide password' : 'Show password'}
      title={showPw ? 'Hide password' : 'Show password'}
      className={styles.eyeBtn}
    >
      <IonIcon icon={showPw ? eyeOffOutline : eyeOutline} />
    </button>
  </div>
</IonItem>

    <IonButton
      expand="block"
      className="custom-button"
      onClick={handlePasswordLogin}
      disabled={busy}
    >
      {busy ? 'Logging in…' : 'Login with Email'}
    </IonButton>

    <IonButton
      expand="block"
      className={`${styles.mt8} custom-button`}
      onClick={() => history.push('/resetpassword')}
    >
      Reset Password
    </IonButton>


                <p className={styles.legal}>
                  By continuing you agree to our{' '}
                  <Link className={styles.link} to="/terms">
                    Terms and Conditions
                  </Link>{' '}
                  and{' '}
                  <Link className={styles.link} to="/privacy">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </>
            ) : (
              <>
                <p className={styles.noAcct}>No local account yet. Create one on this device to begin.</p>
                <IonButton
                  expand="block"
                  className="custom-button"
                  onClick={() => history.push('/register')}
                >
                  Create Account
                </IonButton>

                <p className={styles.legal}>
                  By continuing you agree to our{' '}
                  <Link className={styles.link} to="/terms">
                    Terms and Conditions
                  </Link>{' '}
                  and{' '}
                  <Link className={styles.link} to="/privacy">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </>
            )}

            <IonToast
              isOpen={toast.open}
              onDidDismiss={() => setToast((s) => ({ ...s, open: false }))}
              message={toast.msg}
              duration={2400}
              color={toast.color}
            />
          </div>
        </div>
      </IonContent>
      <BottomNav showWhenAnon />
    </IonPage>
  );
};

export default Login;































