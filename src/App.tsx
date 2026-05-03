// src/App.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IonApp, IonRouterOutlet, setupIonicReact, IonSpinner } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Route, Redirect } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { createBrowserHistory, createHashHistory, type History } from 'history';
import { initHealthTables } from './db/HealthRepository';
import { initProtocolTables } from './db/ProtocolRepository';

// App Update Required Checking
import { App as CapacitorApp } from '@capacitor/app';
import UpdateRequired from './pages/UpdateRequired';

import { logger } from './utils/logger';

// Telemetry
import { initSentry } from './telemetry/sentry';
import { initAnalytics } from './telemetry/analytics';
import { getLocalCurrentUser } from './services/localAuth';

// DB + features
import { initDbOnce } from './db/sqlite';
import { ensurePushTokensTable } from './db/SettingsRepository';
import PrivateRoute from './pages/PrivateRoute';
import { RequirePro } from './components/RequirePro';

// Pages
import Home from './pages/Home';
import Login from './pages/Login';
import Info from './pages/Information';
import InfoDeepDive from './pages/InfoDeepDive';
import LandingPage from './pages/LandingPage';
import Register from './pages/Register';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import Paywall from './pages/Paywall';
import HealthTracker from './pages/HealthTracker';
import Today from './pages/Today';
import Protocols from './pages/Protocols';
import PersonalPlan from './pages/personalPlan';
import Support from './pages/Support';
import PrivacyPolicy from './pages/PrivacyPolicy';
import ResetPassword from './pages/ResetPassword';
import RemindersPage from './pages/RemindersPage';
import WeeklySummary from './pages/weeklySummaryPage';
import DayPage from './pages/DayPage';
import WeeklySummaryArchive from './pages/WeeklySummaryArchive';
import WeeklySummaryArchiveDetail from './pages/WeeklySummaryArchiveDetail';
import Terms from './pages/Terms';
import CelebrationPage from './pages/CelebrationPage';
import Effectiveness from './pages/Effectiveness';
import Glp1GraphArchive from './pages/Glp1GraphArchive';
import Glp1GraphArchiveDetail from './pages/GlP1GraphArchiveDetail';

// Providers
import ErrorBoundary from './ErrorBoundary';
import ReminderBadgeProvider from './context/ReminderBadgeProvider';
import AuthProvider from './context/AuthProvider';

// Notifications
import { LocalNotifications } from '@capacitor/local-notifications';
import { syncNotificationPermission, rescheduleAllReminders } from './boot/notifications';
import { useEffectOnce } from './hooks/useEffectOnce';

// Ionic CSS
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';
import './theme/variables.css';
import styles from './App.module.css';

// ============================
// TEST ONLY: disk space check
// Remove after testing if you don't want this feature yet.
// ============================
import { DiskSpace } from './plugins/diskSpace';
// ============================

setupIonicReact();

const ENABLE_ANALYTICS = import.meta.env.DEV;

// ============================
// TEST ONLY: minimum free space required to initialize local DB (tune later)
// Remove after testing if you don't want this feature yet.
// ============================
const MIN_FREE_BYTES_TEST = 200 * 1024 * 1024; // 200 MB

function formatMB(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}
// ============================

/* ----------------------------- window typings ----------------------------- */
declare global {
  interface Window {
    __SKIP_PURCHASES?: boolean;
  }
}

/* ----------------------------- guarded wrappers --------------------------- */
const PersonalPlanGuarded: React.FC = () => (
  <RequirePro>
    <PersonalPlan />
  </RequirePro>
);

const WeeklySummaryArchiveGuarded: React.FC = () => (
  <RequirePro>
    <WeeklySummaryArchive />
  </RequirePro>
);

const WeeklySummaryArchiveDetailGuarded: React.FC = () => (
  <RequirePro>
    <WeeklySummaryArchiveDetail />
  </RequirePro>
);

const DayPageGuarded: React.FC = () => (
  <RequirePro>
    <DayPage />
  </RequirePro>
);

const CelebrationGuarded: React.FC = () => (
  <RequirePro>
    <CelebrationPage />
  </RequirePro>
);
const Glp1GraphArchiveGuarded: React.FC = () => (
  <RequirePro>
    <Glp1GraphArchive />
  </RequirePro>
);

const Glp1GraphArchiveDetailGuarded: React.FC = () => (
  <RequirePro>
    <Glp1GraphArchiveDetail />
  </RequirePro>
);

/* --------------------------- version compare util ------------------------- */
function isVersionLessThan(current: string, latest: string): boolean {
  const cur = current.split('.').map((n) => parseInt(n, 10) || 0);
  const lat = latest.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(cur.length, lat.length);

  for (let i = 0; i < len; i++) {
    const c = cur[i] ?? 0;
    const l = lat[i] ?? 0;
    if (c < l) return true;
    if (c > l) return false;
  }
  return false;
}

/* --------------------------------- App ------------------------------------ */
const SKIP_PURCHASES = false;
const IOS_APP_STORE_LOOKUP_ID = '';
const IOS_APP_STORE_FALLBACK_URL = '';

const App: React.FC = () => {
  const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
  const isNative = platform !== 'web';
  const isIOS = platform === 'ios';
  const isAndroid = platform === 'android';

  // ============================
  // TEST ONLY: storage preflight UI state
  // Remove after testing if you don't want this feature yet.
  // ============================
  const [storageInfoTest, setStorageInfoTest] = useState<{
    availableBytes: number;
    requiredBytes: number;
  } | null>(null);
  // ============================

  // DB boot state (web starts "ready" since no native SQLite open is required)
  const [dbReady, setDbReady] = useState<boolean>(!isNative);
  const [dbError, setDbError] = useState<Error | null>(null);

  // Only iOS should block UI for App Store version check when a store ID is configured.
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(
    isIOS && Boolean(IOS_APP_STORE_LOOKUP_ID)
  );
  const [updateRequired, setUpdateRequired] = useState<boolean>(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [storeUrl, setStoreUrl] = useState<string | null>(null);

  // History: hash on native, browser on web
  const history: History = useMemo(
    () => (isNative ? createHashHistory() : createBrowserHistory()),
    [isNative]
  );

  // One-time flags/refs
  const uidRef = useRef<string | undefined>(undefined);
  const telemetryBootedRef = useRef<boolean>(false);
  const dbInitRef = useRef<boolean>(false);
  const notifBootedRef = useRef<boolean>(false);
  const visibilityBoundRef = useRef<boolean>(false);

  // Expose dev flag exactly once
  useEffectOnce(() => {
    window.__SKIP_PURCHASES = SKIP_PURCHASES;
    logger.info('[App] SKIP_PURCHASES', { SKIP_PURCHASES });
  });

  // Initialize theme on app startup
  useEffect(() => {
    const initTheme = async () => {
      try {
        const { value } = await Preferences.get({ key: 'app_theme' });
        const theme = value === 'dark' ? 'dark' : 'light';
        
        document.documentElement.setAttribute('data-theme', theme);
        document.body.setAttribute('data-theme', theme);
        
        logger.info('[App] Theme initialized', { theme });
      } catch (e) {
        logger.warn('[App] Theme init failed, defaulting to light', {
          msg: e instanceof Error ? e.message : String(e),
        });
        document.documentElement.setAttribute('data-theme', 'light');
        document.body.setAttribute('data-theme', 'light');
      }
    };

    void initTheme();
  }, []);

  // Initialize SQLite DB on native — StrictMode-safe + non-blocking background setup
  useEffect(() => {
    if (!isNative) return;
    if (dbInitRef.current) return;
    dbInitRef.current = true;

    let mounted = true;

    (async () => {
      try {
        // ============================
        // TEST ONLY: Disk space preflight (Android only)
        // Remove after testing if you don't want this feature yet.
        // ============================
        if (isAndroid) {
          try {
            const info = await DiskSpace.getInfo();
            logger.warn(`[DiskSpace] preflight ${JSON.stringify(info)}`);
            

            if (info.availableBytes < MIN_FREE_BYTES_TEST) {
              if (!mounted) return;

              setStorageInfoTest({
                availableBytes: info.availableBytes,
                requiredBytes: MIN_FREE_BYTES_TEST,
              });

              // Keep existing splash error flow but show a friendly message below
              setDbError(new Error('NOT_ENOUGH_STORAGE'));
              return; // ✅ do not attempt initDbOnce
            }
          } catch (e) {
            logger.warn('[TEST][DiskSpace] check failed (non-fatal)', {
              msg: e instanceof Error ? e.message : String(e),
            });
            // If check fails, continue to normal initDbOnce.
          }
        }
        // ============================
        // END TEST ONLY
        // ============================

        await initDbOnce();

        if (!mounted) return;
        setDbReady(true);

        // Non-critical setup — fire-and-forget, non-blocking
        void (async () => {
          try {
            await ensurePushTokensTable();
          } catch (e) {
            logger.warn('[App] ensurePushTokensTable failed (non-fatal)', {
              msg: e instanceof Error ? e.message : String(e),
            });
          }

          try {
            await initHealthTables();
          } catch (e) {
            logger.warn('[App] initHealthTables failed (non-fatal)', {
              msg: e instanceof Error ? e.message : String(e),
            });
          }

          try {
            await initProtocolTables();
          } catch (e) {
            logger.warn('[App] initProtocolTables failed (non-fatal)', {
              msg: e instanceof Error ? e.message : String(e),
            });
          }
        })();
      } catch (err) {
        logger.error('[App] initDbOnce failed (fatal)', {
          msg: err instanceof Error ? err.message : String(err),
        });
        if (mounted) {
          setDbError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isNative, isAndroid]);

  // Notifications boot + foreground reschedule
  useEffect(() => {
    if (!dbReady) return;

    let active = true;

    const boot = async (): Promise<void> => {
      try {
        if (isNative) {
          if (isAndroid) {
            // Android: do NOT prompt on boot
            await LocalNotifications.checkPermissions();
          } else {
            // iOS: OK to prompt (if you want)
            await LocalNotifications.requestPermissions();
          }
        }

        await syncNotificationPermission();

        if (active) {
          await rescheduleAllReminders();
        }
      } catch (e) {
        logger.warn('[App] notifications boot failed', {
          msg: e instanceof Error ? e.message : String(e),
        });
      }
    };

    const onVisibility = async (): Promise<void> => {
      if (document.visibilityState !== 'visible') return;
      try {
        await syncNotificationPermission();
        await rescheduleAllReminders();
      } catch (e) {
        logger.warn('[App] foreground reschedule failed', {
          msg: e instanceof Error ? e.message : String(e),
        });
      }
    };

    if (!notifBootedRef.current) {
      notifBootedRef.current = true;
      void boot();
    }

    if (!visibilityBoundRef.current) {
      document.addEventListener('visibilitychange', onVisibility);
      visibilityBoundRef.current = true;
    }

    return () => {
      active = false;
      if (visibilityBoundRef.current) {
        document.removeEventListener('visibilitychange', onVisibility);
        visibilityBoundRef.current = false;
      }
    };
  }, [dbReady, isNative, isAndroid]);

  // Telemetry boot (Sentry + Analytics) after DB is ready
  useEffect(() => {
    if (!dbReady || telemetryBootedRef.current) return;
    telemetryBootedRef.current = true;

    (async () => {
      const u = await getLocalCurrentUser();
      uidRef.current = u?.id;

      await initSentry({
        history,
        getUserId: () => uidRef.current,
      });

      if (ENABLE_ANALYTICS) {
        await initAnalytics({
          endpoint: '/api/analytics/collect',
          history,
          getUserId: () => uidRef.current,
          batchSize: 20,
          flushIntervalMs: 10_000,
        });
      }
    })().catch((e) => {
      logger.warn('[App] telemetry init failed', {
        msg: e instanceof Error ? e.message : String(e),
      });
    });
  }, [dbReady, history]);

  // iOS-only App Store version check
  useEffect(() => {
    if (!isIOS || !IOS_APP_STORE_LOOKUP_ID) {
      setCheckingUpdate(false);
      return;
    }

    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        const appInfo = await CapacitorApp.getInfo();
        const currentVersion = appInfo.version;

        const res = await fetch(`https://itunes.apple.com/lookup?id=${IOS_APP_STORE_LOOKUP_ID}`);
        const json: unknown = await res.json();
        const result = (json as { results?: Array<{ version?: string; trackViewUrl?: string }> }).results?.[0];

        if (!result) return;

        const storeVersion = result.version;
        const trackViewUrl = result.trackViewUrl;

        logger.info('[App] version check', { currentVersion, storeVersion, platform: 'ios' });

        if (storeVersion && isVersionLessThan(currentVersion, storeVersion)) {
          if (cancelled) return;
          setLatestVersion(storeVersion);
          setStoreUrl(trackViewUrl || IOS_APP_STORE_FALLBACK_URL);
          setUpdateRequired(true);
        }
      } catch (e) {
        logger.warn('[App] version check failed', {
          msg: e instanceof Error ? e.message : String(e),
        });
      } finally {
        if (!cancelled) setCheckingUpdate(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [isIOS]);

  const showSplash = !dbReady || checkingUpdate;

  return (
    <ErrorBoundary>
      <IonApp>
        {updateRequired && storeUrl ? (
          <IonReactRouter history={history}>
            <AuthProvider>
              <ReminderBadgeProvider>
                <UpdateRequired latestVersion={latestVersion} storeUrl={storeUrl} />
              </ReminderBadgeProvider>
            </AuthProvider>
          </IonReactRouter>
        ) : showSplash ? (
          <div className={styles.splashContainer}>
            <IonSpinner />
            <div className={styles.splashText}>Preparing app…</div>

            {dbError && (
              <div className={styles.errorContainer}>
                {dbError.message === 'NOT_ENOUGH_STORAGE' && storageInfoTest ? (
                  <>
                    <div className={styles.errorTitle}>Not enough free storage</div>
                    <div className={styles.errorSubtext}>
                      Please free up space and try again.
                    </div>
                    <div className={styles.storageInfo}>
                      Required: <b>{formatMB(storageInfoTest.requiredBytes)} MB</b>
                      <br />
                      Available: <b>{formatMB(storageInfoTest.availableBytes)} MB</b>
                    </div>
                  </>
                ) : (
                  <>Database init failed. {dbError.message}</>
                )}
              </div>
            )}
          </div>
        ) : (
          <IonReactRouter history={history}>
            <AuthProvider>
              <ReminderBadgeProvider>
                <IonRouterOutlet>
                  <Route exact path="/" render={() => <Redirect to="/home" />} />

                  {/* Public routes */}
                  <Route exact path="/home" component={Home} />
                  <Route exact path="/login" component={Login} />
                  <Route exact path="/register" component={Register} />
                  <Route exact path="/information" component={Info} />
                  <Route exact path="/deepdive" component={InfoDeepDive} />
                  <Route exact path="/welcome" component={LandingPage} />
                  <Route exact path="/paywall" component={Paywall} />
                  <Route exact path="/support" component={Support} />
                  <Route exact path="/privacy" component={PrivacyPolicy} />
                  <Route exact path="/resetpassword" component={ResetPassword} />
                  <Route exact path="/terms" component={Terms} />

                  {/* Private routes */}
                  <PrivateRoute exact path="/settings" component={Settings} />
                  <PrivateRoute exact path="/today" component={Today} />
                  <PrivateRoute exact path="/protocols" component={Protocols} />
                  <PrivateRoute exact path="/profile" component={Profile} />
                  <PrivateRoute exact path="/healthtracker" component={HealthTracker} />
                  <PrivateRoute exact path="/reminders" component={RemindersPage} />
                  <PrivateRoute exact path="/weeklysummary" component={WeeklySummary} />
                  <PrivateRoute exact path="/effectiveness" component={Effectiveness} />
                  <PrivateRoute exact path="/glp1-graph/archive" component={Glp1GraphArchiveGuarded} />
                  <PrivateRoute exact path="/glp1-graph/archive/:id" component={Glp1GraphArchiveDetailGuarded} />

                  {/* Pro-only routes */}
                  <PrivateRoute exact path="/personalplan" component={PersonalPlanGuarded} />
                  <PrivateRoute exact path="/celebrate" component={CelebrationGuarded} />
                  <PrivateRoute exact path="/weekly-summary/archive/:id" component={WeeklySummaryArchiveDetailGuarded} />
                  <PrivateRoute exact path="/weekly-summary/archive" component={WeeklySummaryArchiveGuarded} />
                  <PrivateRoute exact path="/plan/day/:day" component={DayPageGuarded} />
                  <PrivateRoute exact path="/day/:day" component={DayPageGuarded} />

                  <Route render={() => <Redirect to="/home" />} />
                </IonRouterOutlet>
              </ReminderBadgeProvider>
            </AuthProvider>
          </IonReactRouter>
        )}
      </IonApp>
    </ErrorBoundary>
  );
};

export default App;



