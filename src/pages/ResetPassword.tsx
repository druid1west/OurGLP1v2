// ============================================================================
// File: src/pages/ResetPassword.tsx
// Local-only password reset:
// 1) User enters email + current password
// 2) If valid, they enter new password twice and submit
// 3) We update the local DB password hash (no backend involved)
// ============================================================================
import { logger } from '@/utils/logger';
import React, { useState } from 'react';
import {
  IonItem,
  IonLabel,
  IonButton,
  IonToast,
  IonPage,
  IonContent,
} from '@ionic/react';
import styles from './ResetPassword.module.css';
import '../theme/variables.css';

import {
  verifyAndLoginLocal,
  updateAccountPasswordHash,
} from '@/db/LocalAccountRepository';
import { hashPassword } from '@/utils/password';

// Navigation
import TopNav from '@/context/TopNav';
import BottomNav from '@/context/BottomNav';

const ResetPassword: React.FC = () => {
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1
  const [email, setEmail] = useState<string>('');
  const [currentPassword, setCurrentPassword] = useState<string>('');

  // Step 2
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirm, setConfirm] = useState<string>('');

  // UI
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Verified local user id
  const [userId, setUserId] = useState<string | null>(null);

  const clearErrors = (): void => {
    setMessage('');
    setError('');
  };

  const validEmail = (s: string): boolean => /\S+@\S+\.\S+/.test(s);

  // STEP 1
  const handleVerifyCurrent = async (): Promise<void> => {
    clearErrors();

    const e = email.trim().toLowerCase();

    if (!validEmail(e)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!currentPassword) {
      setError('Please enter your current password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const acc = await verifyAndLoginLocal(e, currentPassword);
      if (!acc?.id) {
        setError('Unable to verify your account. Please try again.');
        return;
      }
      setUserId(String(acc.id));
      setStep(2);
      setMessage('Verified. Please set a new password.');
    } catch (e2) {
      logger.error('[ResetPassword] verify failed', e2);
      setError('Email or password is incorrect.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // STEP 2
  const handleUpdatePassword = async (): Promise<void> => {
    clearErrors();

    if (!userId) {
      setError('Session expired. Please verify your current password again.');
      setStep(1);
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('New passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const newHash = await hashPassword(newPassword);
      await updateAccountPasswordHash(userId, newHash);

      setMessage('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (e2) {
      logger.error('[ResetPassword] update failed', e2);
      setError('Could not update password. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <IonPage>
      <TopNav showWhenAnon />

      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.container}>
          <h2 className={styles.title}>Reset Password</h2>

          <p className={styles.subtitle}>
            {step === 1
              ? 'Verify your current password.'
              : 'Enter your new password (twice).'}
          </p>

          {step === 1 ? (
            <>
              <IonItem lines="none" className={`${styles.itemNoLines} custom-input-item`}>
                <IonLabel position="stacked">Email</IonLabel>
                <input
                  id="resetEmail"
                  type="email"
                  value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setEmail(e.target.value)
                  }
                  className={`native-input-white ${styles.input}`}
                  autoComplete="off"
                  inputMode="email"
                  placeholder="you@example.com"
                  aria-label="Email"
                />
              </IonItem>

              <IonItem lines="none" className={`${styles.itemNoLines} custom-input-item`}>
                <IonLabel position="stacked">Current password</IonLabel>
                <input
                  id="resetCurrentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setCurrentPassword(e.target.value)
                  }
                  className={`native-input-white ${styles.input}`}
                  autoComplete="current-password"
                  placeholder="Current password"
                  aria-label="Current password"
                />
              </IonItem>

              <IonButton
                expand="block"
                className="custom-button"
                onClick={() => void handleVerifyCurrent()}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Verifying…' : 'Verify'}
              </IonButton>
            </>
          ) : (
            <>
              <IonItem lines="none" className={`${styles.itemNoLines} custom-input-item`}>
                <IonLabel position="stacked">New password</IonLabel>
                <input
                  id="resetNewPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setNewPassword(e.target.value)
                  }
                  className={`native-input-white ${styles.input}`}
                  autoComplete="new-password"
                  placeholder="New password (min 8 chars)"
                  aria-label="New password"
                />
              </IonItem>

              <IonItem lines="none" className={`${styles.itemNoLines} custom-input-item`}>
                <IonLabel position="stacked">Confirm new password</IonLabel>
                <input
                  id="resetConfirmPassword"
                  type="password"
                  value={confirm}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setConfirm(e.target.value)
                  }
                  className={`native-input-white ${styles.input}`}
                  autoComplete="new-password"
                  placeholder="Confirm new password"
                  aria-label="Confirm new password"
                />
              </IonItem>

              <div className={styles.actionsRow}>
                <IonButton
                  expand="block"
                  className="custom-button"
                  onClick={() => setStep(1)}
                  fill="outline"
                  color="medium"
                >
                  Back
                </IonButton>

                <IonButton
                  expand="block"
                  className="custom-button"
                  onClick={() => void handleUpdatePassword()}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Updating…' : 'Update Password'}
                </IonButton>
              </div>
            </>
          )}

          {message ? <p className={styles.success}>{message}</p> : null}
          {error ? <p className={styles.errorMessage}>{error}</p> : null}

          <IonToast
            isOpen={Boolean(message)}
            onDidDismiss={() => setMessage('')}
            message={message}
            duration={2500}
            color="success"
          />
        </div>
      </IonContent>

      <BottomNav showWhenAnon={false} />
    </IonPage>
  );
};

export default ResetPassword;



