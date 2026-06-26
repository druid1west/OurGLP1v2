import { App as CapacitorApp } from '@capacitor/app';
import React, { useEffect, useMemo, useState } from 'react';
import {
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonPage,
  IonContent,
  IonSelect,
  IonSelectOption,
  IonToast,
  IonAlert,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import styles from './Settings.module.css';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';

import {
  getNotificationSoundId,
  setNotificationSoundId,
  type SoundId,
} from '@/db/SettingsRepository';

import TopNav from '@/context/TopNav';
import BottomNav from '@/context/BottomNav';
import { useAuth } from '@/context/useAuth';
import { emitAuthChanged } from '@/services/authBus';
import { dropAllLocalData } from '@/db/_maintenance';
import { logger } from '@/utils/logger';

import { openManageSubscriptions } from '@/lib/purchasesInit';

type SubscriptionStatus =
  | { kind: 'pro'; sandbox: boolean; startedAt?: string; expiresAt?: string }
  | { kind: 'free' };

type NotifPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

const dlog = logger.child('Settings');

const SOUND_OPTIONS: ReadonlyArray<{ id: SoundId; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'beep', label: 'Beep' },
  { id: 'chime', label: 'Chime' },
];

const formatDate = (value?: string): string => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

/* ------------------- Theme helpers ------------------- */

async function getTheme(): Promise<'light' | 'dark'> {
  try {
    const { value } = await Preferences.get({ key: 'app_theme' });
    return value === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

async function setTheme(theme: 'light' | 'dark'): Promise<void> {
  await Preferences.set({ key: 'app_theme', value: theme });
  // Apply to BOTH html and body to ensure all Ionic components see it
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);
}

/* -------------------------------- Page -------------------------------- */

const Settings: React.FC = () => {
  const history = useHistory();
  const { user, isPro } = useAuth();

  const [soundId, setSoundIdState] = useState<SoundId>('default');
  const [savedToast, setSavedToast] = useState<boolean>(false);

  const [notifAllowed, setNotifAllowed] = useState<NotifPermission>('unknown');

  const [confirmEraseOpen, setConfirmEraseOpen] = useState<boolean>(false);
  const [erasing, setErasing] = useState<boolean>(false);

  const [theme, setThemeState] = useState<'light' | 'dark'>('light');

  const sub = useMemo<SubscriptionStatus>(() => {
    if (isPro) {
      return {
        kind: 'pro',
        sandbox: user?.entitlement_source !== 'revenuecat',
        expiresAt: user?.pro_until ?? undefined,
      };
    }
    return { kind: 'free' };
  }, [isPro, user?.entitlement_source, user?.pro_until]);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const subLabel = useMemo(() => {
    if (sub.kind === 'pro') return 'Pro — Active subscription';
    return 'Free — Upgrade anytime to unlock Pro features.';
  }, [sub]);

  // App version
  useEffect(() => {
    (async () => {
      try {
        const info = await CapacitorApp.getInfo();
        setAppVersion(info.version);
      } catch (e) {
        dlog.warn('failed to load app version', {
          msg: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, []);

  // Load theme on mount
  useEffect(() => {
    (async () => {
      const savedTheme = await getTheme();
      setThemeState(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    })();
  }, []);

  // Notification + sound settings
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const snd = await getNotificationSoundId();
        if (mounted) setSoundIdState(snd);
      } catch (e) {
        dlog.warn('failed to load sound settings', {
          msg: e instanceof Error ? e.message : String(e),
        });
      }

      try {
        const p = await LocalNotifications.checkPermissions();
        const display = (p as { display?: NotifPermission }).display;
        if (mounted) setNotifAllowed(display ?? 'unknown');
      } catch {
        if (mounted) setNotifAllowed('unknown');
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function onChangeSound(value: SoundId): Promise<void> {
    setSoundIdState(value);
    try {
      await setNotificationSoundId(value);
      setSavedToast(true);
    } catch (e) {
      dlog.error('setNotificationSoundId failed', {
        msg: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function handleDeleteAccount(): Promise<void> {
    setErasing(true);
    const result = await dropAllLocalData();
    await Preferences.clear();
    emitAuthChanged(null);
    setErasing(false);
    setConfirmEraseOpen(false);

    if (result.ok) {
      alert('Your account and all data on this device have been deleted.');
      history.replace('/welcome');
      return;
    }
    alert(`Deletion completed with issues:\n\n${result.errors.join('\n')}`);
  }

  function openPaywall(): void {
    history.push('/paywall?returnTo=/settings');
  }

  const handleThemeToggle = async (): Promise<void> => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setThemeState(newTheme);
    await setTheme(newTheme);
  };

  const signedInAs = useMemo(() => {
    const u = user as unknown as Record<string, unknown> | undefined;
    const email = u && typeof u.email === 'string' ? u.email : undefined;
    const first = u && typeof u.first_name === 'string' ? u.first_name : undefined;
    const last = u && typeof u.last_name === 'string' ? u.last_name : undefined;

    if (first || last) {
      return `${first ?? ''}${first && last ? ' ' : ''}${last ?? ''}${email ? ` · ${email}` : ''}`;
    }
    if (email) return email;
    return undefined;
  }, [user]);

  return (
    <IonPage data-test-id="settings-page">
      <TopNav showWhenAnon />

      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.pageInner}>
          <h2 className={styles.title}>Settings</h2>

          {appVersion && (
            <div className={styles.appVersion}>
              App version: <strong>{appVersion}</strong>
            </div>
          )}

          {/* Subscription */}
          <div className={styles.infoBox}>
            <h3 className={styles.sectionTitle}>Subscription</h3>

            {signedInAs && (
              <div className={styles.kvRow}>
                <span className={styles.kvKey}>Signed in as</span>
                <span className={styles.kvVal}>{signedInAs}</span>
              </div>
            )}

            <div className={styles.kvRow}>
              <span className={styles.kvKey}>Status</span>
              <span className={sub.kind === 'pro' ? styles.badgeActive : styles.badgeInactive}>
                {subLabel}
              </span>
            </div>

            {sub.kind === 'pro' && (
              <>
                <div className={styles.kvRow}>
                  <span className={styles.kvKey}>Started</span>
                  <span className={styles.kvVal}>{formatDate(sub.startedAt)}</span>
                </div>
                <div className={styles.kvRow}>
                  <span className={styles.kvKey}>Renews / Expires</span>
                  <span className={styles.kvVal}>{formatDate(sub.expiresAt)}</span>
                </div>
              </>
            )}

            <div className={styles.subActions}>
              {sub.kind === 'pro' ? (
                <IonButton expand="block" onClick={() => openManageSubscriptions()}>
                  Manage Subscription
                </IonButton>
              ) : (
                <IonButton expand="block" onClick={openPaywall}>
                  Go Pro
                </IonButton>
              )}

              <IonButton
                expand="block"
                fill="outline"
                onClick={openPaywall}
              >
                Restore Purchases
              </IonButton>
            </div>
          </div>

          {/* Notifications */}
          <div className={styles.listCard}>
            <IonList inset={false}>
              <IonItem lines="full">
                <IonLabel>Notifications Allowed</IonLabel>
                <div className={styles.rightVal}>
                  <b>{notifAllowed}</b>
                </div>
              </IonItem>

              <IonItem>
                <IonLabel>Notification sound</IonLabel>
                <IonSelect
                  interface="action-sheet"
                  value={soundId}
                  onIonChange={(e) => void onChangeSound(e.detail.value as SoundId)}
                >
                  {SOUND_OPTIONS.map((s) => (
                    <IonSelectOption key={s.id} value={s.id}>
                      {s.label}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
            </IonList>

            <IonToast
              isOpen={savedToast}
              message="Notification sound saved ✓"
              duration={900}
              onDidDismiss={() => setSavedToast(false)}
            />
          </div>

          {/* Dark Mode Toggle */}
          <div className={styles.listCard}>
            <IonList inset={false}>
              <IonItem lines="none">
                <IonLabel className={styles.themeLabel}>Dark Mode</IonLabel>
                <button
                  className={styles.themeToggleButton}
                  onClick={() => void handleThemeToggle()}
                >
                  {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
                </button>
              </IonItem>
            </IonList>
          </div>

          {/* Delete account */}
          <div className={styles.dangerBox}>
            <h3 className={styles.dangerTitle}>Delete Account</h3>
            <p className={styles.muted}>
              Permanently delete your account and all data stored on this device. This action
              cannot be undone.
            </p>

            <IonButton
              color="danger"
              expand="block"
              onClick={() => setConfirmEraseOpen(true)}
              disabled={erasing}
            >
              {erasing ? 'Deleting…' : 'Delete Account & Data'}
            </IonButton>

            <IonAlert
              isOpen={confirmEraseOpen}
              onDidDismiss={() => setConfirmEraseOpen(false)}
              header="Delete account?"
              message="This permanently deletes your account and all data stored on this device. This cannot be undone."
              buttons={[
                { text: 'Cancel', role: 'cancel' },
                {
                  text: 'Delete',
                  role: 'destructive',
                  handler: () => {
                    void handleDeleteAccount();
                  },
                },
              ]}
            />
          </div>

          <div aria-hidden className={styles.endSpacer} />
        </div>
      </IonContent>

      <BottomNav />
    </IonPage>
  );
};

export default Settings;



