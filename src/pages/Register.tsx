// src/pages/Register.tsx

import React, { useState } from 'react';
import {
  IonPage,
  IonContent,
  IonLabel,
  IonButton,
  IonToast,
  IonItem,
  IonIcon,
  useIonRouter,
} from '@ionic/react';
import { useLocation } from 'react-router-dom';
import { eyeOutline, eyeOffOutline } from 'ionicons/icons';
import styles from './Register.module.css';
import '../theme/variables.css';

// Local account storage (device)
import { initLocalAccountTable, upsertLocalAccount } from '@/db/LocalAccountRepository';
import { hashPassword } from '@/utils/password';
import { logger } from '@/utils/logger';

// Local auth helpers and context (SQLite users table)
import { getUserByEmail, registerLocalUser, markUserAsLoggedIn } from '@/services/localAuth';
import { useAuth } from '@/context/useAuth';

// Biometrics
import { verifyIdentity, storeBiometricCredentials } from '@/utils/biometric';

import TopNav from '@/context/TopNav';
import BottomNav from '@/context/BottomNav';

type Form = {
  first_name: string;
  last_name: string;
  email: string;
  confirm_email: string;
  passphrase: string;
  confirm_passphrase: string;
};



const Register: React.FC = () => {
  const router = useIonRouter();
  const { search } = useLocation();
  const { refreshUser } = useAuth();

  const hasRandomUUID = (c: unknown): c is { randomUUID: () => string } =>
    typeof c === 'object' &&
    c !== null &&
    'randomUUID' in c &&
    typeof (c as Record<string, unknown>).randomUUID === 'function';

  const uuidv4 = (): string => {
    if (typeof crypto !== 'undefined' && hasRandomUUID(crypto)) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const isValidEmail = (e: string) => /\S+@\S+\.\S+/.test(e);
  const isStrongPassword = (p: string) =>
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/.test(p);

  const [form, setForm] = useState<Form>({
    first_name: '',
    last_name: '',
    email: '',
    confirm_email: '',
    passphrase: '',
    confirm_passphrase: '',
  });

  // 👁️ show passwords by default on register
  const [showPw, setShowPw] = useState<boolean>(true);
  const [showPw2, setShowPw2] = useState<boolean>(true);

  const [busy, setBusy] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const returnTo = React.useMemo(() => {
    const p = new URLSearchParams(search).get('returnTo');
    return p && p.startsWith('/') && p !== '/coach' ? p : '/today';
  }, [search]);

  const onChange =
    (field: keyof Form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  async function tryEnrollBiometrics(email: string, plainPassphrase: string): Promise<void> {
    try {
      const ok = await verifyIdentity({
        reason: 'Enable biometric login',
        title: 'Biometric Login',
        subtitle: 'Use Face/Touch ID to unlock',
        description: 'We will store a secure credential on this device.',
      });
      if (!ok) return;
      await storeBiometricCredentials(email, plainPassphrase);
    } catch {
      /* ignore biometric setup failures */
    }
  }

  const handleSubmit = async (): Promise<void> => {
    const email = form.email.trim().toLowerCase();
    const confirmEmail = form.confirm_email.trim().toLowerCase();
    const pw = form.passphrase;
    const pw2 = form.confirm_passphrase;

    if (!form.first_name.trim()) return alert('Please enter your first name.');
    if (!form.last_name.trim()) return alert('Please enter your last name.');
    if (!isValidEmail(email)) return alert('Please enter a valid email.');
    if (email !== confirmEmail) return alert('Email addresses do not match.');
    if (!isStrongPassword(pw)) {
      return alert('Password must be 8+ chars with uppercase, lowercase, number, and special character.');
    }
    if (pw !== pw2) return alert('Passwords do not match.');

    setBusy(true);
    try {
      await initLocalAccountTable();

      const existing = await getUserByEmail(email);
      if (existing) {
        alert('An account with this email already exists.');
        return;
      }

      const id = uuidv4();
      const hash = await hashPassword(pw);

      // 1) Device-local account (for password/biometrics)
      await upsertLocalAccount({
        id,
        email,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        password_hash: hash,
        last_login_at: new Date().toISOString(),
      });

      // 2) SQLite `users` row (AuthProvider consumes this)
      const tz =
        (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
      try {
        await registerLocalUser({
          id,
          email,
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          timezone: tz,
        });
      } catch {
        /* ignore unique race */
      }

      // 3) Mark logged in
      await markUserAsLoggedIn(id);

      // 4) Refresh context
      await refreshUser();

      // 5) Offer biometrics
      await tryEnrollBiometrics(email, pw);

      setToastMsg('Account created successfully!');
      setShowToast(true);

      setForm({
        first_name: '',
        last_name: '',
        email: '',
        confirm_email: '',
        passphrase: '',
        confirm_passphrase: '',
      });

      router.push(returnTo, 'root', 'replace');
    } catch (e) {
      logger.error('[Register] error', e);
      alert('Registration failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <IonPage>
      <TopNav showWhenAnon />

      <IonContent fullscreen className="viewportBetweenNavs android-register-content">
        <div className="pageScroll">
          <div className={styles.container}>
            <h2 className={styles.title}>Create Account</h2>
            <p className={styles.helperText}>
              Accounts are local to this device. You can connect Apple Health later to include
              steps, activity, sleep, heart rate, and workouts.
            </p>

            {/* First Name */}
            <IonItem lines="none" className="custom-input-item" style={{ marginBottom: '1rem' }}>
              <IonLabel id="firstNameLabel" position="stacked">
                First Name
              </IonLabel>
              <input
                id="first_name"
                aria-label="First name"
                title="First name"
                placeholder="Enter your first name"
                type="text"
                value={form.first_name}
                onChange={onChange('first_name')}
                className="native-input-white"
                autoComplete="given-name"
                
              />
            </IonItem>

            {/* Last Name */}
            <IonItem lines="none" className="custom-input-item" style={{ marginBottom: '1rem' }}>
              <IonLabel id="lastNameLabel" position="stacked">
                Last Name
              </IonLabel>
              <input
                id="last_name"
                aria-label="Last name"
                title="Last name"
                placeholder="Enter your last name"
                type="text"
                value={form.last_name}
                onChange={onChange('last_name')}
                className="native-input-white"
                autoComplete="family-name"
                
              />
            </IonItem>

            {/* Email */}
            <IonItem lines="none" className="custom-input-item" style={{ marginBottom: '1rem' }}>
              <IonLabel id="emailLabel" position="stacked">
                Email
              </IonLabel>
              <input
                id="email"
                aria-label="Email"
                title="Email address"
                placeholder="name@example.com"
                type="email"
                value={form.email}
                onChange={onChange('email')}
                className="native-input-white"
                autoComplete="email"
                inputMode="email"
               
              />
            </IonItem>

            {/* Confirm Email */}
            <IonItem lines="none" className="custom-input-item" style={{ marginBottom: '1rem' }}>
              <IonLabel id="confirmEmailLabel" position="stacked">
                Confirm Email
              </IonLabel>
              <input
                id="confirm_email"
                aria-label="Confirm email"
                title="Confirm email address"
                placeholder="Re-enter your email"
                type="email"
                value={form.confirm_email}
                onChange={onChange('confirm_email')}
                className="native-input-white"
                autoComplete="email"
                inputMode="email"
                
              />
            </IonItem>

            {/* Password */}
            <IonItem lines="none" className="custom-input-item" style={{ marginBottom: '1rem' }}>
              <IonLabel id="passwordLabel" position="stacked">
                Password
              </IonLabel>
              <div className={styles.inputBox}>
                <input
                  id="passphrase"
                  aria-label="Password"
                  title="Password"
                  placeholder="Create a password"
                  type={showPw ? 'text' : 'password'}
                  value={form.passphrase}
                  onChange={onChange('passphrase')}
                  className="native-input-white"
                  autoComplete="new-password"
                  
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  title={showPw ? 'Hide password' : 'Show password'}
                  
                >
                  <IonIcon icon={showPw ? eyeOffOutline : eyeOutline} />
                </button>
              </div>
            </IonItem>

            {/* Confirm Password */}
            <IonItem lines="none" className="custom-input-item" style={{ marginBottom: '1.5rem' }}>
              <IonLabel id="confirmPasswordLabel" position="stacked">
                Confirm Password
              </IonLabel>
              <div className={styles.inputBox}>
                <input
                  id="confirm_passphrase"
                  aria-label="Confirm password"
                  title="Confirm password"
                  placeholder="Re-enter your password"
                  type={showPw2 ? 'text' : 'password'}
                  value={form.confirm_passphrase}
                  onChange={onChange('confirm_passphrase')}
                  className="native-input-white"
                  autoComplete="new-password"
                  
                />
                <button
                  type="button"
                  onClick={() => setShowPw2((s) => !s)}
                  aria-label={showPw2 ? 'Hide password' : 'Show password'}
                  title={showPw2 ? 'Hide password' : 'Show password'}
                  className={styles.eyeButton}
                >
                  <IonIcon icon={showPw2 ? eyeOffOutline : eyeOutline} />
                </button>
              </div>
            </IonItem>

            <IonButton expand="block" className="custom-button" onClick={handleSubmit} disabled={busy}>
              {busy ? 'Creating Account…' : 'Create Account'}
            </IonButton>

            <p className={styles.termsText}>
  By continuing you agree to our <a className="underline" href="/terms">Terms</a> and{' '}
  <a className="underline" href="/privacy">Privacy Policy</a>.
</p>

            <IonToast
              isOpen={showToast}
              onDidDismiss={() => setShowToast(false)}
              message={toastMsg}
              duration={2200}
              color="success"
            />
          </div>
        </div>
      </IonContent>

      <BottomNav showWhenAnon />
    </IonPage>
  );
};

export default Register;
