// src/hooks/useUserProfile.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserProfile } from '../db/UserRepository';
import { getLocalUserProfile } from '../db/UserRepository';
import { onAuthChanged } from '../services/authBus';

export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Guards for StrictMode / unmount
  const ranOnceRef = useRef(false);
  const mountedRef = useRef(true);
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    // De-dupe concurrent or double-invoked refreshes
    if (inFlightRef.current) return inFlightRef.current;

    setLoading(true);
    const p = (async () => {
      const local = await getLocalUserProfile();
      if (mountedRef.current) {
        setProfile(local);
      }
    })()
      .finally(() => {
        if (mountedRef.current) {
          setLoading(false);
        }
        inFlightRef.current = null;
      });

    inFlightRef.current = p;
    return p;
  }, []);

  // Initial load: run only once per mount (StrictMode-safe)
  useEffect(() => {
    if (ranOnceRef.current) return;
    ranOnceRef.current = true;
    void refresh();
  }, [refresh]);

  // Re-hydrate on login/logout; ensure single subscription with cleanup
  useEffect(() => {
    const off = onAuthChanged(() => {
      // No setLoading flicker here; refresh handles loading state
      void refresh();
    });
    return off; // unsubscribe on unmount
  }, [refresh]);

  return { profile, loading, refresh };
}


