// src/pages/Paywall.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { logger } from '@/utils/logger';
import {
  IonButton,
  useIonRouter,
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
} from '@ionic/react';
import { useLocation, Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import type { PurchasesPackage } from '@revenuecat/purchases-capacitor';
import {
  Archive,
  BarChart3,
  CheckCircle2,
  HeartPulse,
  LockKeyhole,
  RefreshCw,
  Sparkles,
  Watch,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { JSX } from 'react';

import TopNav from '@/context/TopNav';
import BottomNav from '@/context/BottomNav';
import styles from './Paywall.module.css';

import { useAuth } from '@/context/useAuth';
import { IS_LOCAL_AUTH } from '@/config/runtime';
import { upgradeLocalUserToPro } from '@/services/localAuth';
import { getSetupStatus } from '@/lib/setupStatus';
import {
  initAndGetAppUserId,
  purchasePackage as rcPurchasePackage,
  restorePurchases as rcRestorePurchases,
  getCustomerInfo as rcGetCustomerInfo,
  isProFromCustomerInfo as rcIsPro,
} from '@/lib/purchasesInit';
import {
  rcGetBothPackages,
  rcGetPriceString,
} from '@/lib/revenuecat';
import { syncLocalEntitlementFromCustomerInfo } from '@/lib/rcSync';
import {
  StoreKitTest,
  STOREKIT_PRODUCT_IDS,
  isStoreKitTestSupportedPlatform,
  type StoreKitProduct,
} from '@/plugins/storeKitTest';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────
type SubscriptionType = 'monthly' | 'yearly';

interface PackageInfo {
  pkg?: PurchasesPackage;
  productId: string;
  price: string;
  identifier: string;
  source: 'revenuecat' | 'storekit';
}

interface FeatureItem {
  title: string;
  description: string;
  icon: LucideIcon;
}

const FREE_FEATURES: FeatureItem[] = [
  {
    title: 'Today dashboard',
    description: 'Daily protein, hydration, fasting, injection, sleep, and movement at a glance.',
    icon: HeartPulse,
  },
  {
    title: 'Apple Health sync',
    description: 'Steps, active calories, exercise minutes, sleep, heart rate, and workouts stay included.',
    icon: Watch,
  },
  {
    title: 'Core GLP-1 logging',
    description: 'Keep manual tracking, reminders, profile targets, and the weekly review usable for everyone.',
    icon: CheckCircle2,
  },
];

const PRO_FEATURES: FeatureItem[] = [
  {
    title: 'Personal plan',
    description: 'Turn your logs into a clearer week-by-week plan for protein, water, fasting, and movement.',
    icon: Sparkles,
  },
  {
    title: 'Deeper trends',
    description: 'Unlock day detail, saved graph history, and pattern review across more than today.',
    icon: BarChart3,
  },
  {
    title: 'Archive and share',
    description: 'Keep weekly summaries, revisit past periods, and build a cleaner record for appointments.',
    icon: Archive,
  },
];

const ENABLE_LOCAL_PURCHASE_BYPASS =
  import.meta.env.VITE_ENABLE_LOCAL_PURCHASE_BYPASS === '1' ||
  import.meta.env.VITE_ENABLE_LOCAL_PURCHASE_BYPASS === 'true';

const ENABLE_TEST_PURCHASE_BYPASS =
  import.meta.env.VITE_ENABLE_TEST_PURCHASE_BYPASS === '1' ||
  import.meta.env.VITE_ENABLE_TEST_PURCHASE_BYPASS === 'true';

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────
function toMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const maybeObj = err as Record<string, unknown>;
    const data = (maybeObj.data as Record<string, unknown>) || undefined;
    const underlying =
      typeof data?.underlyingErrorMessage === 'string'
        ? data.underlyingErrorMessage
        : undefined;
    const dataMsg =
      typeof data?.message === 'string' ? data.message : undefined;
    const msg =
      typeof maybeObj.message === 'string'
        ? (maybeObj.message as string)
        : undefined;
    if (underlying) return underlying;
    if (dataMsg) return dataMsg;
    if (msg) return msg;
    if ('toString' in maybeObj && typeof maybeObj.toString === 'function') {
      const s = String(maybeObj.toString());
      if (s && s !== '[object Object]') return s;
    }
  }
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

function getDefaultPriceLabel(type: SubscriptionType = 'monthly'): string {
  const locale = (
    Intl.DateTimeFormat().resolvedOptions().locale || ''
  ).toLowerCase();
  const likelyGB = locale.includes('gb') || locale.includes('en-gb');
  
  if (type === 'yearly') {
    return likelyGB ? '£39.99/year' : '$39.99/year';
  }
  return likelyGB ? '£4.99/month' : '$4.99/month';
}

function findStoreKitProduct(products: StoreKitProduct[], type: SubscriptionType): StoreKitProduct | null {
  const suffix = type === 'yearly' ? '.yearly' : '.monthly';
  return products.find((product) => product.id.endsWith(suffix)) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────
export default function Paywall(): JSX.Element {
  const router = useIonRouter();
  const { search } = useLocation();
  const { user, loading: authLoading, refreshUser, refreshEntitlements, isPro } = useAuth();

  const [loading, setLoading] = useState(true);
  const [setupGateLoading, setSetupGateLoading] = useState(true);
  const [setupGateReady, setSetupGateReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appUserId, setAppUserId] = useState<string>('');
  
  // Subscription packages
  const [monthlyPackage, setMonthlyPackage] = useState<PackageInfo | null>(null);
  const [yearlyPackage, setYearlyPackage] = useState<PackageInfo | null>(null);
  const [selectedType, setSelectedType] = useState<SubscriptionType>('yearly');
  const [storeKitMode, setStoreKitMode] = useState(false);
  const autoRestoreStartedRef = useRef(false);

  const platform = useMemo(() => Capacitor.getPlatform(), []);
  const isIOS = platform === 'ios';
  const isAndroid = platform === 'android';
  const isProd = import.meta.env.PROD === true;
  const isLocalBypass = IS_LOCAL_AUTH && !isProd && ENABLE_LOCAL_PURCHASE_BYPASS;
  const isTesterBypass = IS_LOCAL_AUTH && ENABLE_TEST_PURCHASE_BYPASS;

  const platformLabel =
    isIOS ? 'Apple ID' : isAndroid ? 'Google account' : 'store account';

  const returnTo = useMemo(() => {
    const p = new URLSearchParams(search).get('returnTo');
    return p && p.startsWith('/') ? p : '/coach';
  }, [search]);

  const shouldAutoRestore = useMemo(() => {
    return new URLSearchParams(search).get('restore') === '1';
  }, [search]);

  const shouldShowManage = useMemo(() => {
    return new URLSearchParams(search).get('manage') === '1';
  }, [search]);

  useEffect(() => {
    let cancelled = false;

    if (authLoading) {
      setSetupGateLoading(true);
      return;
    }

    if (!user?.id) {
      setSetupGateReady(false);
      setSetupGateLoading(false);
      router.push('/coach', 'root');
      return;
    }

    setSetupGateLoading(true);
    void getSetupStatus(user)
      .then((status) => {
        if (cancelled) return;
        setSetupGateReady(status.complete);
        if (!status.complete) {
          router.push('/coach', 'root');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSetupGateReady(false);
        router.push('/coach', 'root');
      })
      .finally(() => {
        if (!cancelled) setSetupGateLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!setupGateReady) return;
    if (!isPro || shouldShowManage) return;
    const destination = returnTo.startsWith('/paywall') ? '/today' : returnTo;
    router.push(destination, 'root');
  }, [isPro, returnTo, router, setupGateReady, shouldShowManage]);

  // Get selected package
  const selectedPackage = useMemo(() => {
    return selectedType === 'yearly' ? yearlyPackage : monthlyPackage;
  }, [selectedType, yearlyPackage, monthlyPackage]);

  const hasAnyStorePackage = Boolean(monthlyPackage || yearlyPackage);
  const bypassEnabled = isLocalBypass || isTesterBypass;
  const canUseBypass = isLocalBypass || (isTesterBypass && !hasAnyStorePackage);
  const showYearlyOption = Boolean(yearlyPackage || canUseBypass);
  const showMonthlyOption = Boolean(monthlyPackage || canUseBypass);
  const selectedPriceLabel =
    selectedPackage?.price || getDefaultPriceLabel(selectedType);

  // If not logged in, send to setup keeping the app in the correct order.
  useEffect(() => {
    if (!authLoading && !user?.id) {
      logger.info('[Paywall] No user.id → redirecting to /coach');
      router.push('/coach', 'root');
    }
  }, [authLoading, user?.id, router]);

  // Init purchase products. Debug builds can use the Xcode StoreKit file first;
  // TestFlight/App Store builds use RevenueCat first, then StoreKit as a fallback.
  useEffect(() => {
    let didCancel = false;

    const loadStoreKitFallback = async (reason: string): Promise<boolean> => {
      if (!isIOS || !isStoreKitTestSupportedPlatform()) return false;

      try {
        const availability = await StoreKitTest.isAvailable();
        if (!availability.available) return false;

        const { products } = await StoreKitTest.getProducts({
          productIds: [...STOREKIT_PRODUCT_IDS],
        });
        if (didCancel || products.length === 0) return false;

        const monthly = findStoreKitProduct(products, 'monthly');
        const yearly = findStoreKitProduct(products, 'yearly');

        if (monthly) {
          setMonthlyPackage({
            productId: monthly.id,
            price: monthly.displayPrice,
            identifier: monthly.id,
            source: 'storekit',
          });
        }

        if (yearly) {
          setYearlyPackage({
            productId: yearly.id,
            price: yearly.displayPrice,
            identifier: yearly.id,
            source: 'storekit',
          });
        }

        if (monthly || yearly) {
          setStoreKitMode(true);
          setError(null);
          logger.info('[Paywall boot] using StoreKit fallback', { reason });
          return true;
        }
      } catch (e) {
        logger.warn('[Paywall boot] StoreKit fallback unavailable', {
          reason,
          msg: toMessage(e),
        });
      }

      return false;
    };

    (async () => {
      try {
        logger.info('[Paywall boot] starting', {
          IS_LOCAL_AUTH,
          isProd,
          platform,
          hasUser: Boolean(user?.id),
        });

        if (!isProd) {
          const loadedStoreKitFirst = await loadStoreKitFallback('Xcode StoreKit products are available');
          if (didCancel) return;
          if (loadedStoreKitFirst) return;
        }

        const id = await initAndGetAppUserId(user?.id);
        if (didCancel) return;
        setAppUserId(id);
        logger.info('[Paywall boot] rcInit() ok; appUserId:', id);

        // Fetch both packages
        const { monthly, yearly } = await rcGetBothPackages();
        if (didCancel) return;

        if (monthly) {
          const price = rcGetPriceString(monthly);
          setMonthlyPackage({
            pkg: monthly,
            productId: 'com.ourglp1.app.pro.monthly',
            price,
            identifier: monthly.identifier,
            source: 'revenuecat',
          });
          logger.info('[Paywall boot] monthly package loaded:', price);
        }

        if (yearly) {
          const price = rcGetPriceString(yearly);
          setYearlyPackage({
            pkg: yearly,
            productId: 'com.ourglp1.app.pro.yearly',
            price,
            identifier: yearly.identifier,
            source: 'revenuecat',
          });
          logger.info('[Paywall boot] yearly package loaded:', price);
        }

        if (!monthly && !yearly) {
          logger.warn('[Paywall boot] No packages available from RC');
          const loadedStoreKit = await loadStoreKitFallback('RevenueCat returned no packages');
          if (!loadedStoreKit) {
            setError(
              bypassEnabled
                ? null
                : 'No subscription packages are available yet. TestFlight does not use the Xcode .storekit file; it needs App Store Connect products or a working RevenueCat offering.',
            );
          }
        }
      } catch (e) {
        const msg = toMessage(e);
        logger.error('[Paywall boot] init failed:', msg);
        const loadedStoreKit = await loadStoreKitFallback(msg);
        if (!loadedStoreKit) {
          setError(bypassEnabled ? null : msg);
        }
      } finally {
        if (!didCancel) setLoading(false);
      }
    })();
    return () => {
      didCancel = true;
    };
  }, [user?.id, platform, isProd, bypassEnabled, isIOS]);

  // After purchase/restore, wait for entitlement
  const waitForEntitlement = useCallback(
    async (timeoutMs = 15000): Promise<boolean> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          const ci = await rcGetCustomerInfo();
          if (rcIsPro(ci)) return true;
        } catch {
          // keep polling
        }
        await new Promise((r) => setTimeout(r, 750));
      }
      return false;
    },
    [],
  );

  const finalizeAndReturn = useCallback(async (grantLocalTestAccess = false) => {
    if (grantLocalTestAccess && IS_LOCAL_AUTH && user?.id) {
      const months = selectedType === 'yearly' ? 12 : 1;
      await upgradeLocalUserToPro(user.id, months);
    }
    await refreshUser();
    await refreshEntitlements();
    window.dispatchEvent(new Event('billing:changed'));
    router.push(returnTo, 'root');
  }, [returnTo, refreshEntitlements, refreshUser, router, user?.id, selectedType]);

  const handleBuy = useCallback(async () => {
    if (busy) return;

    if (!selectedPackage && !canUseBypass) {
      setError('Please select a subscription plan');
      return;
    }

    setBusy(true);
    setError(null);

    logger.info('[Paywall] handleBuy()', {
      isProd,
      IS_LOCAL_AUTH,
      isLocalBypass,
      selectedType,
      hasUser: Boolean(user?.id),
    });

    try {
      if (!selectedPackage && canUseBypass) {
        logger.info('[Paywall] Tester/local build → bypassing purchases');
        await finalizeAndReturn(true);
        return;
      }

      if (!selectedPackage) return;

      if (selectedPackage.source === 'storekit') {
        logger.info('[Paywall] calling Xcode StoreKit purchase...', {
          productId: selectedPackage.productId,
        });

        const result = await StoreKitTest.purchase({
          productId: selectedPackage.productId,
        });

        if (result.cancelled) {
          setError('Purchase cancelled.');
          setBusy(false);
          return;
        }

        if (result.pending) {
          setError('Purchase is pending approval.');
          setBusy(false);
          return;
        }

        if (!result.success) {
          setError('StoreKit purchase did not complete.');
          setBusy(false);
          return;
        }

        await finalizeAndReturn(true);
        return;
      }

      if (!selectedPackage.pkg) {
        setError('Selected subscription package is not available.');
        setBusy(false);
        return;
      }

      logger.info('[Paywall] calling purchasePackage()...', {
        identifier: selectedPackage.identifier,
      });
      
      const ci = await rcPurchasePackage(selectedPackage.pkg);
      const activeNow = rcIsPro(ci);
      const activeSoon = activeNow ? true : await waitForEntitlement(15000);
      
      if (!activeSoon) {
        setError(
          'Purchase completed but access is not active yet. Pull to refresh or tap "Restore Purchases".',
        );
        setBusy(false);
        return;
      }

      if (user?.id) {
        const entitlementInfo = activeNow ? ci : await rcGetCustomerInfo();
        await syncLocalEntitlementFromCustomerInfo(user.id, entitlementInfo);
      }
      
      await finalizeAndReturn();
    } catch (e) {
      const msg = toMessage(e);
      logger.error('[Paywall] purchase failed:', msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    canUseBypass,
    finalizeAndReturn,
    isLocalBypass,
    isProd,
    user?.id,
    waitForEntitlement,
    selectedPackage,
    selectedType,
  ]);

  const handleRestore = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    logger.info('[Paywall] handleRestore()', {
      isProd,
      IS_LOCAL_AUTH,
      isLocalBypass,
      hasUser: Boolean(user?.id),
    });

    try {
      if (canUseBypass && !storeKitMode) {
        logger.info('[Paywall] Tester/local build → bypassing restore');
        await finalizeAndReturn(true);
        return;
      }

      if (storeKitMode) {
        logger.info('[Paywall] calling Xcode StoreKit restore...');
        const restored = await StoreKitTest.restore({
          productIds: [...STOREKIT_PRODUCT_IDS],
        });

        if (!restored.active) {
          setError(`No active StoreKit test subscription found for this ${platformLabel}.`);
          setBusy(false);
          return;
        }

        await finalizeAndReturn(true);
        return;
      }

      logger.info('[Paywall] calling Purchases.restorePurchases()…');
      const ci = await rcRestorePurchases();
      const activeNow = rcIsPro(ci);
      const activeSoon = activeNow ? true : await waitForEntitlement(10000);
      
      if (!activeSoon) {
        if (user?.id) {
          await syncLocalEntitlementFromCustomerInfo(user.id, ci);
        }
        setError(
          `No active subscription found to restore for this ${platformLabel}.`,
        );
        setBusy(false);
        return;
      }

      if (user?.id) {
        const entitlementInfo = activeNow ? ci : await rcGetCustomerInfo();
        await syncLocalEntitlementFromCustomerInfo(user.id, entitlementInfo);
      }
      
      await finalizeAndReturn();
    } catch (e) {
      const msg = toMessage(e);
      logger.error('[Paywall] restore failed:', msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    canUseBypass,
    finalizeAndReturn,
    isLocalBypass,
    isProd,
    user?.id,
    waitForEntitlement,
    platformLabel,
    storeKitMode,
  ]);

  useEffect(() => {
    if (!shouldAutoRestore || autoRestoreStartedRef.current || !user?.id || loading || !setupGateReady) return;
    autoRestoreStartedRef.current = true;
    void handleRestore();
  }, [handleRestore, loading, setupGateReady, shouldAutoRestore, user?.id]);

  const handleManage = useCallback(() => {
    if (isIOS) {
      window.location.assign(
        'itms-apps://apps.apple.com/account/subscriptions',
      );
    } else if (isAndroid) {
      window.location.assign(
        'https://play.google.com/store/account/subscriptions',
      );
    } else {
      window.open(
        'https://support.apple.com/en-gb/HT202039',
        '_blank',
        'noopener,noreferrer',
      );
    }
  }, [isIOS, isAndroid]);

  const handleLater = useCallback(() => {
    router.push(user?.id ? '/coach' : '/home', 'back');
  }, [router, user?.id]);

  if (authLoading || setupGateLoading || loading) {
    return (
      <IonPage>
        <TopNav showWhenAnon setupOnly />
        <IonHeader>
          <IonToolbar>
            <IonTitle>OURGLP1 PRO</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent fullscreen>
          <div className={styles.scrollContainer}>
            <main className={styles.paywallContainer}>
              <div className={styles.loadingBox}>
                <RefreshCw className={styles.spin} size={20} />
                <span>Loading...</span>
              </div>
            </main>
          </div>
        </IonContent>
        <BottomNav showWhenAnon setupOnly />
      </IonPage>
    );
  }

  if (!setupGateReady) {
    return (
      <IonPage>
        <TopNav showWhenAnon setupOnly />
        <IonContent fullscreen>
          <div className={styles.scrollContainer}>
            <main className={styles.paywallContainer}>
              <div className={styles.loadingBox}>
                <RefreshCw className={styles.spin} size={20} />
                <span>Opening setup...</span>
              </div>
            </main>
          </div>
        </IonContent>
        <BottomNav showWhenAnon setupOnly />
      </IonPage>
    );
  }

  return (
    <IonPage>
      <TopNav showWhenAnon />
      <IonHeader>
        <IonToolbar>
          <IonTitle>OURGLP1 PRO</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        <div className={styles.scrollContainer}>
          <main className={styles.paywallContainer}>
            <section className={styles.heroPanel}>
              <div className={styles.kicker}>
                <LockKeyhole size={17} />
                <span>Pro layer for version 2</span>
              </div>
              <h2 className={styles.title}>Deeper GLP-1 insight, without locking the tracker</h2>
              <p className={styles.subtitle}>
                Today, manual logging, reminders, and Apple Health sync stay part of the core app.
                Pro adds the longer-view planning and history that make the tracker more useful over time.
              </p>

              <div className={styles.heroHighlights} aria-label="OurGLP1 Pro highlights">
                <div>
                  <strong>Free</strong>
                  <span>Track the day well</span>
                </div>
                <div>
                  <strong>Pro</strong>
                  <span>Understand the pattern</span>
                </div>
              </div>
            </section>

            <section className={styles.valueGrid} aria-label="Free and Pro feature comparison">
              <div className={styles.valueColumn}>
                <div className={styles.columnHeader}>
                  <span>Included</span>
                  <strong>Core tracker</strong>
                </div>
                <ul className={styles.featureList}>
                  {FREE_FEATURES.map(({ icon: Icon, title, description }) => (
                    <li key={title}>
                      <Icon size={18} aria-hidden />
                      <div>
                        <strong>{title}</strong>
                        <span>{description}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={`${styles.valueColumn} ${styles.proColumn}`}>
                <div className={styles.columnHeader}>
                  <span>Upgrade</span>
                  <strong>Pro intelligence</strong>
                </div>
                <ul className={styles.featureList}>
                  {PRO_FEATURES.map(({ icon: Icon, title, description }) => (
                    <li key={title}>
                      <Icon size={18} aria-hidden />
                      <div>
                        <strong>{title}</strong>
                        <span>{description}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className={styles.planPanel} aria-label="Choose a Pro subscription">
              <div className={styles.planIntro}>
                <div>
                  <h3>Choose Pro</h3>
                  <p>Lower monthly entry for v2, with the yearly plan kept as the best long-term value.</p>
                </div>
                <span className={styles.priceNote}>
                  {storeKitMode
                    ? isProd ? 'Apple StoreKit mode' : 'Xcode StoreKit test mode'
                    : canUseBypass && !hasAnyStorePackage
                    ? 'Tester unlock enabled'
                    : 'Prices may vary by region.'}
                </span>
              </div>

              <div className={styles.subscriptionOptions} role="radiogroup" aria-label="Subscription plan">
                {showYearlyOption && (
                  <button
                    type="button"
                    className={`${styles.subscriptionCard} ${
                      selectedType === 'yearly' ? styles.selected : ''
                    } ${busy ? styles.disabled : ''}`}
                    onClick={() => !busy && setSelectedType('yearly')}
                    disabled={busy}
                    role="radio"
                    aria-checked={selectedType === 'yearly'}
                  >
                    <span className={styles.badge}>Best value</span>
                    <span className={styles.subscriptionTitle}>Yearly</span>
                    <strong className={styles.subscriptionPrice}>
                      {yearlyPackage?.price || getDefaultPriceLabel('yearly')}
                    </strong>
                    <span className={styles.subscriptionPeriod}>Billed annually</span>
                    <span className={styles.savingsText}>A steadier price for longer progress.</span>
                  </button>
                )}

                {showMonthlyOption && (
                  <button
                    type="button"
                    className={`${styles.subscriptionCard} ${
                      selectedType === 'monthly' ? styles.selected : ''
                    } ${busy ? styles.disabled : ''}`}
                    onClick={() => !busy && setSelectedType('monthly')}
                    disabled={busy}
                    role="radio"
                    aria-checked={selectedType === 'monthly'}
                  >
                    <span className={styles.subscriptionTitle}>Monthly</span>
                    <strong className={styles.subscriptionPrice}>
                      {monthlyPackage?.price || getDefaultPriceLabel('monthly')}
                    </strong>
                    <span className={styles.subscriptionPeriod}>Billed monthly</span>
                    <span className={styles.savingsText}>Good for trying the deeper tools first.</span>
                  </button>
                )}
              </div>

              <div className={styles.subscriptionSummary} aria-label="Subscription summary">
                <strong>Subscription:</strong> Pro,{' '}
                {selectedType === 'yearly' ? '1 year' : '1 month'}, auto-renewable,{' '}
                {selectedPriceLabel}.{' '}
                {isIOS && <>Cancel anytime in Settings &gt; Apple ID &gt; Subscriptions.</>}
                {isAndroid && (
                  <>
                    Cancel anytime in Google Play Store &gt; Profile &gt; Payments and subscriptions &gt; Subscriptions.
                  </>
                )}
                {!isIOS && !isAndroid && <>Cancel anytime through your store account subscription settings.</>}
              </div>

              {error && <div className={styles.errorBox}>{error}</div>}

              {canUseBypass && !hasAnyStorePackage && (
                <div className={styles.testerBox}>
                  Tester mode is active for this build, so this unlocks Pro on this device without
                  showing an Apple payment sheet.
                </div>
              )}

              <div className={styles.actions}>
                <IonButton
                  onClick={handleBuy}
                  expand="block"
                  disabled={busy || (!selectedPackage && !canUseBypass)}
                  className={styles.buyButton}
                >
                  {busy
                    ? 'Processing...'
                    : !selectedPackage && canUseBypass
                    ? 'Unlock Pro for testing'
                    : `Continue - ${selectedPriceLabel}`}
                </IonButton>

                <IonButton
                  onClick={handleRestore}
                  expand="block"
                  fill="outline"
                  disabled={busy || !user?.id}
                  className={styles.restoreButton}
                >
                  Restore Purchases
                </IonButton>

                <div className={styles.secondaryActions}>
                  <button type="button" onClick={handleManage} disabled={busy}>
                    Manage Subscription
                  </button>
                  <button type="button" onClick={handleLater} disabled={busy}>
                    Maybe later
                  </button>
                </div>
              </div>
            </section>

            <section className={styles.legalPanel}>
              <p>
                {isIOS ? (
                  <>
                    Subscription auto-renews unless cancelled at least 24 hours before the end of the current period.
                    Payment is charged to your Apple ID. You can manage or cancel in iOS Settings &gt; Apple ID &gt; Subscriptions.
                  </>
                ) : isAndroid ? (
                  <>
                    Subscription auto-renews unless cancelled. Payment is charged to your Google account.
                    You can manage or cancel in the Google Play Store under Profile &gt; Payments and subscriptions &gt; Subscriptions.
                  </>
                ) : (
                  <>
                    Subscription auto-renews unless cancelled. You can manage or cancel on your store account subscriptions page.
                  </>
                )}
              </p>
              <p>
                By subscribing you agree to our <Link to="/privacy">Privacy Policy</Link> and{' '}
                <Link to="/terms">Terms of Use</Link>.
              </p>

              {appUserId && (
                <p className={styles.customerId}>
                  Customer ID: <code>{appUserId}</code>
                </p>
              )}
            </section>

            <div className={styles.spacer} aria-hidden />
          </main>
        </div>
      </IonContent>

      <BottomNav showWhenAnon={false} />
    </IonPage>
  );
}
