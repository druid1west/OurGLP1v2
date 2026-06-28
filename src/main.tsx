// src/main.tsx
import './boot/globalErrors';
import { logger } from './utils/logger';
import { initRevenueCat } from './lib/purchasesInit';
import { Purchases } from '@revenuecat/purchases-capacitor';
import {
  refreshCurrentUserEntitlementFromRevenueCat,
  syncCurrentUserEntitlementFromCustomerInfo,
  writeRcCacheFromCustomerInfo,
} from './lib/rcSync';
import { initDbp } from './dev/dbp';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initDbOnce } from './db/sqlite';
import { resetLocalDbDev } from './db/devReset';
import { Capacitor } from '@capacitor/core';
import { initHealthTables } from './db/HealthRepository';
import { initProtocolTables } from './db/ProtocolRepository';
import { canUseStoreKitTestProducts } from './plugins/storeKitTest';
import { App as CapacitorApp } from '@capacitor/app';
import { getLocalCurrentUser } from './services/localAuth';

// import '@/polyfills/crypto-subtle';

// Your theme
import './theme/variables.css';



const isDev = import.meta.env.DEV;
const isNative = Capacitor.getPlatform() !== 'web';

async function boot() {
  // Force verbose logs while we debug celebrations
  // setLogLevel('debug');
  // logger.info('[BOOT] Log level set', { level: getLogLevel() });
  if (!isNative) {
    const params = new URLSearchParams(window.location.search);
    const shouldReset = isDev && params.get('localdb') === 'reset';
    if (shouldReset) {
      logger.warn('[BOOT] Dev reset requested via ?localdb=reset');
      await resetLocalDbDev();
    }
    await initDbOnce();
    await initHealthTables();
    await initProtocolTables();
  }

  if (isDev) {
    initDbp();
  }

  // ✅ Configure RevenueCat + listener (native only)
  if (isNative) {
    const rcLog = logger.child('RC');
    const useStoreKitTest = isDev ? await canUseStoreKitTestProducts() : false;

    if (useStoreKitTest) {
      rcLog.info('Skipping RevenueCat in Xcode StoreKit test mode');
    } else {
      let bootUserId: string | undefined;
      try {
        await initDbOnce();
        await initHealthTables();
        await initProtocolTables();
        const bootUser = await getLocalCurrentUser();
        bootUserId = bootUser?.id || undefined;
      } catch (e) {
        rcLog.warn('Could not read local user before RevenueCat configure', {
          msg: e instanceof Error ? e.message : String(e),
        });
      }

      await initRevenueCat(bootUserId);

      Purchases.addCustomerInfoUpdateListener((info) => {
        writeRcCacheFromCustomerInfo(info);
        void syncCurrentUserEntitlementFromCustomerInfo(info, { emitEvents: false })
          .finally(() => {
            rcLog.info('customerInfo updated');
            window.dispatchEvent(new Event('billing:changed'));
            window.dispatchEvent(new Event('rc:customerInfoChanged'));
          });
      });

      // ✅ Seed local cache once so Settings has data immediately
      try {
        const info = await Purchases.getCustomerInfo();
        writeRcCacheFromCustomerInfo(info);
        await syncCurrentUserEntitlementFromCustomerInfo(info, { emitEvents: false });
        window.dispatchEvent(new Event('billing:changed'));
        window.dispatchEvent(new Event('rc:customerInfoChanged'));
      } catch (e) {
        rcLog.warn('initial getCustomerInfo failed', { msg: e instanceof Error ? e.message : String(e) });
      }

      try {
        CapacitorApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            void refreshCurrentUserEntitlementFromRevenueCat();
          }
        });
      } catch (e) {
        rcLog.warn('appStateChange listener failed', {
          msg: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Missing #root element');

  ReactDOM.createRoot(rootEl).render(
    isDev ? <App /> : (
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  );
}

boot().catch((err) => {
  logger.error('[BOOT] Failed to initialize app:', err);
  document.body.innerHTML = `<div style="padding:2rem;color:red;">Failed to start app. Check console.</div>`;
});
