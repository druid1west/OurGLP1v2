// src/context/AuthProvider.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AuthContext } from './AuthContext';
import type { User } from './authTypes';

import { logger } from '../utils/logger';
import { toSafeUser, safeLog } from '../utils/redact';
import { getLocalCurrentUser, clearLocalCurrentUser } from '../services/localAuth';
import { onAuthChanged } from '../services/authBus';
import { getEntitlements, isProNow } from '../db/EntitlementRepository';

/* ----------------------------- window typings ----------------------------- */
declare global {
  interface Window {
    __AUTH?: { user: { id: string | null; email: string | null } | null };
    __APP_USER?: { id?: string | null } | null;
    __USER?: { id?: string | null } | null;
  }
}

function setWindowAuthUser(u: Pick<User, 'id' | 'email'> | null): void {
  const isProd = import.meta.env.MODE === 'production';
  const rawId: string | null = u?.id ?? null;
  // In production: never expose email; in dev it's OK for debugging.
  const email: string | null = isProd ? null : ((u?.email as string | undefined) ?? null);
  // In production: only expose first 4 chars of UUID-ish id; otherwise null.
  const shortId: string | null =
    isProd && rawId ? (rawId.length >= 4 ? rawId.slice(0, 4) : null) : rawId;
  window.__AUTH = { user: shortId || email ? { id: shortId, email } : null };
  window.__APP_USER = { id: shortId };
  window.__USER = { id: shortId };
}

/* ----------------------------- component ---------------------------------- */

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isPro, setIsPro] = useState<boolean>(false);

  const prevUserId = useRef<string | null>(null);
  const logoutInFlight = useRef<boolean>(false);

  const refreshEntitlements = useCallback(async (): Promise<void> => {
    const uid = user?.id;
    if (!uid) {
      setIsPro(false);
      return;
    }
    try {
      const e = await getEntitlements(uid);
      setIsPro(isProNow(e));
      // Merge the latest entitlement snapshot into in-memory user
      setUser((u) =>
        u
          ? {
              ...u,
              has_pro: e.has_pro,
              subscription_tier: e.subscription_tier ?? u.subscription_tier ?? null,
              pro_until: e.pro_until ?? u.pro_until ?? null,
            }
          : u
      );
    } catch (err) {
      // Non-fatal: keep previous isPro
      logger.debug('[AuthContext] refreshEntitlements failed (non-fatal)', {
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  }, [user?.id]);

  const refreshUser = useCallback(async (): Promise<void> => {
    logger.debug('[AuthContext] refreshUser (LOCAL)');
    try {
      const u = await getLocalCurrentUser();
      if (u && u.id) {
        logger.info('[AuthContext] Fetched local user', safeLog({ user: toSafeUser(u) }));
        // Basic set first
        setUser(u);
        setWindowAuthUser({ id: u.id, email: u.email ?? '' });

        // First-login-in-session analytics
        if (!prevUserId.current) {
          try {
            const { trackEvent } = await import('../telemetry/analytics');
            trackEvent?.('login_success', {});
          } catch (err) {
            logger.debug('[AuthContext] analytics import failed (non-fatal)', {
              msg: err instanceof Error ? err.message : String(err),
            });
          }
        }
        prevUserId.current = u.id;
      } else {
        logger.info('[AuthContext] No local user data');
        setUser(null);
        setWindowAuthUser(null);
        prevUserId.current = null;
        setIsPro(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[AuthContext] Error fetching local user', { msg });
      setUser(null);
      setWindowAuthUser(null);
      prevUserId.current = null;
      setIsPro(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;

    logger.info('🚪 [AuthContext] Logging out (LOCAL)…');
    setLoading(true);
    try {
      await clearLocalCurrentUser();
      setUser(null);
      setWindowAuthUser(null);
      prevUserId.current = null;
      setIsPro(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('❌ [AuthContext] Error during logout', { msg });
      setUser(null);
      setWindowAuthUser(null);
      prevUserId.current = null;
      setIsPro(false);
    } finally {
      setLoading(false);
      logoutInFlight.current = false;
    }
  }, []);

  // Initial hydration
  useEffect(() => {
    let cancelled = false;
    (async () => {
      logger.debug('🚀 [AuthContext] mount → hydrate');
      await refreshUser();
      if (!cancelled) {
        // After user is known, sync entitlements from DB
        await refreshEntitlements();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshUser, refreshEntitlements]);

  // Re-hydrate on login/register/logout via event bus
  useEffect(() => onAuthChanged(async () => {
    await refreshUser();
    await refreshEntitlements();
  }), [refreshUser, refreshEntitlements]);

  // When the logged-in user changes, recompute entitlements
  useEffect(() => {
    if (!user?.id) return;
    void refreshEntitlements();
  }, [user?.id, refreshEntitlements]);

  // Optional: react to paywall finishing a purchase/restore
  useEffect(() => {
    const onBillingChanged = () => { void refreshEntitlements(); };
    window.addEventListener('billing:changed', onBillingChanged);
    return () => window.removeEventListener('billing:changed', onBillingChanged);
  }, [refreshEntitlements]);

  // Debug log when state changes
  useEffect(() => {
     // PII-safe state snapshot
    logger.debug('[AuthContext] state', safeLog({
      loading,
      user: user ? toSafeUser(user) : null,
      isPro,
    }));
  }, [loading, user, isPro]);

  // Derive isPro from in-memory user as a fallback (kept for robustness)
  const derivedIsPro = useMemo(() => {
    if (!user) return false;
    if (user.has_pro) return true;
    if (user.subscription_tier === 'pro') return true;
    if (user.pro_until) {
      const until = Date.parse(user.pro_until);
      if (!Number.isNaN(until) && until > Date.now()) return true;
    }
    return false;
  }, [user]);

  // Prefer the explicitly refreshed flag if set; otherwise fallback
  const effectiveIsPro = isPro || derivedIsPro;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        refreshUser,
        logout,
        isPro: effectiveIsPro,
        refreshEntitlements,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;








