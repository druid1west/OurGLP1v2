import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import Register from './Register';
import { rcInit, rcRestoreAndConfirm } from '@/lib/revenuecat';

export default function GuardedRegister() {
  const history = useHistory();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const gateKey = params.get('t');

  React.useEffect(() => {
    (async () => {
      if (gateKey) return; // already gated via t
      // Try restore to fetch a gating key silently for subscribed users
      try {
        const deviceId = await rcInit();
        const issuedKey = await rcRestoreAndConfirm(deviceId);
        history.replace(`/register?t=${encodeURIComponent(issuedKey)}`);
      } catch {
        history.replace('/paywall');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [gateKey]);

  return gateKey ? <Register /> : null;
}
