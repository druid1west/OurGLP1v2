// src/auth/native.ts
import { logger } from '../utils/logger';
import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

const isObj = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStr = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0;

export const isNative = (): boolean => {
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android';
};

// Call once on app boot (e.g., in App.tsx)
export async function initSocialLogin(opts: {
  iosGoogleClientId: string;
  webGoogleClientId?: string;
  appleClientId?: string;
  appleRedirectUrl?: string;
}): Promise<void> {
  await SocialLogin.initialize({
    google: {
      iOSClientId: opts.iosGoogleClientId,
      iOSServerClientId: opts.webGoogleClientId ?? opts.iosGoogleClientId,
      webClientId: opts.webGoogleClientId,
      mode: 'online',
    },
    apple: {
      clientId: opts.appleClientId,
      redirectUrl: opts.appleRedirectUrl,
    },
  });
}

interface AppleCredential {
  // eslint-disable-next-line id-denylist -- external schema property name
  idToken?: string;
  authorizationCode?: string;
}

function pickApple(res: unknown): AppleCredential | null {
  if (!isObj(res)) return null;

  const result = isObj(res.result) ? res.result : undefined;
  const response = isObj(res.response) ? res.response : undefined;
  const candidate = (result ?? response ?? res) as JsonObject;

  // Use safe local names, then map to external property keys on return
  let idTok: string | undefined;
  if (isStr((candidate as Record<string, unknown>).idToken)) {
    idTok = candidate.idToken as string;
  } else if (isStr((candidate as Record<string, unknown>).identityToken)) {
    idTok = candidate.identityToken as string;
  } else if (isStr((candidate as Record<string, unknown>).id_token)) {
    idTok = candidate.id_token as string;
  } else if (isStr((candidate as Record<string, unknown>).token)) {
    idTok = candidate.token as string;
  }

  let authCode: string | undefined;
  if (isStr((candidate as Record<string, unknown>).authorizationCode)) {
    authCode = candidate.authorizationCode as string;
  } else if (isStr((candidate as Record<string, unknown>).code)) {
    authCode = candidate.code as string;
  } else if (isStr((candidate as Record<string, unknown>).authorization_code)) {
    authCode = candidate.authorization_code as string;
  }

  if (!idTok && !authCode) return null;

  // Map back to the external property names on the returned object
  return {
    // eslint-disable-next-line id-denylist -- external schema property name
    idToken: idTok,
    authorizationCode: authCode,
  };
}

interface GoogleCredential {
  // eslint-disable-next-line id-denylist -- external schema property name
  idToken?: string;
}

function pickGoogle(res: unknown): GoogleCredential | null {
  if (!isObj(res)) return null;

  const result = (isObj(res.result) ? res.result : res) as JsonObject;
  const auth = (isObj((result as Record<string, unknown>).authentication)
    ? (result as Record<string, JsonObject>).authentication
    : result) as JsonObject;

  let idTok: string | undefined;
  if (isStr((auth as Record<string, unknown>).idToken)) {
    idTok = auth.idToken as string;
  } else if (isStr((result as Record<string, unknown>).idToken)) {
    idTok = result.idToken as string;
  } else if (isStr((result as Record<string, unknown>).id_token)) {
    idTok = result.id_token as string;
  }

  return idTok
    ? {
        // eslint-disable-next-line id-denylist -- external schema property name
        idToken: idTok,
      }
    : null;
}

export async function loginWithApple(): Promise<{ credential: AppleCredential }> {
  if (!isNative()) throw new Error('Apple Sign-In is only available in the app');

  logger.info('[native] Apple login…');
  const res = await SocialLogin.login({
    provider: 'apple',
    options: { scopes: ['email', 'name'] },
  });

  const picked = pickApple(res);
  logger.info('[native] Apple result', {
    hasIdTok: Boolean(picked?.idToken),
    hasAuthCode: Boolean(picked?.authorizationCode),
  });

  if (!picked) throw new Error('Apple Sign-In returned no credentials');
  return { credential: picked };
}

export async function loginWithGoogle(): Promise<{ credential: GoogleCredential }> {
  if (!isNative()) throw new Error('Google Sign-In is only available in the app');

  logger.info('[native] Google login…');
  const res = await SocialLogin.login({
    provider: 'google',
    options: { scopes: ['email', 'profile'] },
  });

  const picked = pickGoogle(res);
  logger.info('[native] Google result', {
    hasIdTok: Boolean(picked?.idToken),
  });

  if (!picked) throw new Error('Google Sign-In returned no idToken');
  return { credential: picked };
}




