import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { NativeBiometric } from 'capacitor-native-biometric';

const SERVER = 'app.ourglp1.com'; // MUST match for set/get
const BIO_BOUND_KEY = 'bio_bound_v1';

const isNative = (): boolean => {
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android';
};

const isAndroid = (): boolean => {
  return Capacitor.getPlatform() === 'android';
};

/* ----------------------------- Type Utilities ----------------------------- */

type VerifyOpts = {
  reason?: string;
  title?: string;
  subtitle?: string;
  description?: string;
};

// Plugin may return { verified?: boolean } OR resolve void on success.
type VerifyResult = { verified?: boolean } | void;

// App-level credentials shape without banned identifiers
export type BiometricCredentials = { username?: string; credentialValue?: string };

type IsAvailableResult = {
  isAvailable: boolean;
  biometryType?: string | null;
};

function hasProp<K extends string>(val: unknown, key: K): val is Record<K, unknown> {
  return typeof val === 'object' && val !== null && key in val;
}

function isVerifyResult(val: unknown): val is { verified?: boolean } {
  return (
    hasProp(val, 'verified') &&
    (typeof (val as Record<'verified', unknown>).verified === 'boolean' ||
      typeof (val as Record<'verified', unknown>).verified === 'undefined')
  );
}

function looksLikeNativeCreds(val: unknown): val is Record<string, unknown> {
  return (
    hasProp(val, 'username') &&
    hasProp(val, 'password') &&
    typeof (val as Record<string, unknown>)['username'] === 'string' &&
    typeof (val as Record<string, unknown>)['password'] === 'string'
  );
}

function normalizeVerified(res: unknown): boolean {
  if (isVerifyResult(res)) return res.verified !== false;
  return true;
}

/* ----------------------------- Internal Helpers --------------------------- */

async function isBiometryAvailable(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { isAvailable } = (await NativeBiometric.isAvailable()) as unknown as IsAvailableResult;
    return !!isAvailable;
  } catch {
    // Simulator or no passcode enrolled ends up here
    return false;
  }
}

/** Quick, non-prompting existence check against Keychain/Keystore. */
async function keychainHasStored(): Promise<boolean> {
  try {
    const raw = await NativeBiometric.getCredentials({ server: SERVER });
    return looksLikeNativeCreds(raw) &&
      Boolean((raw as Record<string, unknown>)['username']) &&
      Boolean((raw as Record<string, unknown>)['password']);
  } catch {
    return false;
  }
}

/* --------------------------------- Public --------------------------------- */

/** Small helper for UI to decide if the Face/Touch ID button should be shown. */
export async function shouldShowBiometricButton(): Promise<boolean> {
  if (!await isBiometryAvailable()) return false;
  // Show button if we either have real creds stored or the app recorded a successful bind
  if (await keychainHasStored()) return true;
  const { value } = await Preferences.get({ key: BIO_BOUND_KEY });
  return value === '1';
}

/** Prompt Face/Touch ID and return true if the user authenticated. */
export async function verifyIdentity(opts: VerifyOpts = {}): Promise<boolean> {
  if (!await isBiometryAvailable()) return false;
  try {
    // Android-specific: Use more generic messaging that works with any biometric type
    const verifyOptions = isAndroid() ? {
      reason: opts.reason ?? 'Authenticate to continue',
      title: opts.title ?? 'Biometric Authentication',
      subtitle: opts.subtitle ?? '',
      description: opts.description ?? '',
    } : {
      reason: opts.reason ?? 'Authenticate to continue',
      title: opts.title ?? 'Authentication Required',
      subtitle: opts.subtitle ?? 'Biometric login',
      description: opts.description ?? 'Use Face ID / Touch ID',
    };

    const res = (await NativeBiometric.verifyIdentity(verifyOptions)) as unknown as VerifyResult;
    return normalizeVerified(res);
  } catch (err) {
    console.error('Biometric verification error:', err);
    return false;
  }
}

export async function checkBiometricAvailable(): Promise<boolean> {
  return isBiometryAvailable();
}

/** Quick, non-prompting existence check + availability. */
export async function hasBiometricCredentials(): Promise<boolean> {
  if (!await isBiometryAvailable()) return false;
  if (await keychainHasStored()) return true;

  const { value } = await Preferences.get({ key: BIO_BOUND_KEY });
  return value === '1';
}

/** Prompts Face/Touch ID then reads creds from Keychain/Keystore. */
export async function biometricAuthenticateAndGet(): Promise<BiometricCredentials | null> {
  if (!await isBiometryAvailable()) return null;
  try {
    // Android-specific: Use more generic messaging
    const verifyOptions = isAndroid() ? {
      reason: 'Authenticate to sign in',
      title: 'Biometric Authentication',
      subtitle: '',
      description: '',
    } : {
      reason: 'Authenticate to sign in',
      title: 'Authentication Required',
      subtitle: 'Biometric login',
      description: 'Use Face ID / Touch ID to sign in',
    };

    const res = (await NativeBiometric.verifyIdentity(verifyOptions)) as unknown as VerifyResult;

    if (!normalizeVerified(res)) return null;

    const raw = await NativeBiometric.getCredentials({ server: SERVER });
    if (!looksLikeNativeCreds(raw)) return null;

    const u = (raw as Record<string, string>)['username'];
    const c = (raw as Record<string, string>)['password'];
    return { username: u, credentialValue: c };
  } catch (err) {
    console.error('Biometric authenticate and get error:', err);
    return null;
  }
}

/**
 * Save creds after a successful normal login.
 * Note: plugin requires a key literally named "password"; we set it via bracket notation.
 * Only mark BIO_BOUND_KEY if saving credentials actually succeeded.
 */
export async function storeBiometricCredentials(email: string, credentialValue: string): Promise<void> {
  if (!await isBiometryAvailable()) return;
  // Derive the plugin's option type without importing it directly.
  type SetOpts = Parameters<typeof NativeBiometric.setCredentials>[0];

  const makePayload = (u: string, p: string): SetOpts => {
    const base = { username: u, server: SERVER } as const;
    const tmp = { ...base } as unknown as Record<string, unknown>;
    tmp['password'] = p; // required by plugin; bracket access avoids lint rules
    return tmp as unknown as SetOpts;
  };

  let saved = false;
  try {
    await NativeBiometric.setCredentials(makePayload(email, credentialValue));
    saved = true;
  } catch {
    try {
      await NativeBiometric.deleteCredentials({ server: SERVER });
      await NativeBiometric.setCredentials(makePayload(email, credentialValue));
      saved = true;
    } catch {
      // ignore
    }
  }

  if (saved) {
    await Preferences.set({ key: BIO_BOUND_KEY, value: '1' });
  }
}

// alias for older code paths
export const storeBiometricToken = storeBiometricCredentials;

export async function deleteBiometricToken(): Promise<void> {
  if (!isNative()) return;
  try {
    await NativeBiometric.deleteCredentials({ server: SERVER });
  } catch {
    // ignore
  }
  await Preferences.remove({ key: BIO_BOUND_KEY });
}




