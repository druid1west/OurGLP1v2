// src/components/RequirePro.tsx
import React, { useEffect, useState } from 'react';
import { Redirect, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

function hasFreshRevenueCatProCache(): boolean {
  try {
    const status = localStorage.getItem('rc_entitlement_pro');
    if (status !== 'active') return false;

    const expiration = localStorage.getItem('rc_expiration');
    if (!expiration) return true;

    const until = Date.parse(expiration);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

export function RequirePro({ children }: { children: React.ReactNode }) {
  const { user, loading, isPro } = useAuth();
  const { pathname, search } = useLocation();
  const [shouldRedirect, setShouldRedirect] = useState(false);
  const hasCachedPro = hasFreshRevenueCatProCache();
  const canAccessPro = isPro || hasCachedPro;

  const returnTo = React.useMemo(() => {
    const dest = `${pathname}${search || ''}`;
    return dest.startsWith('/') ? dest : '/information';
  }, [pathname, search]);

  useEffect(() => {
    if (loading) return;

    // If already Pro, no redirect needed
    if (canAccessPro) {
      setShouldRedirect(false);
      return;
    }

    // Not Pro: redirect
    setShouldRedirect(true);
  }, [loading, canAccessPro]);

  // Show nothing while loading
  if (loading) return null;

  // If Pro, render children
  if (canAccessPro) return <>{children}</>;

  // Not Pro: redirect to paywall if logged in, register if not
  if (shouldRedirect) {
    if (user?.id) {
      const to = `/paywall?returnTo=${encodeURIComponent(returnTo)}`;
      return <Redirect to={to} />;
    } else {
      const to = `/register?returnTo=${encodeURIComponent(returnTo)}`;
      return <Redirect to={to} />;
    }
  }

  return null;
}
