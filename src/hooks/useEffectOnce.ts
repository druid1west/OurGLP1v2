// src/hooks/useEffectOnce.ts
import { useEffect, useRef } from 'react';
export function useEffectOnce(effect: () => void | (() => void)) {
  const ranRef = useRef(false);
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    return effect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
