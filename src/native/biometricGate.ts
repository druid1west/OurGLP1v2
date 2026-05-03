// src/native/biometricGate.ts
import { NativeBiometric } from 'capacitor-native-biometric';
import { Preferences } from '@capacitor/preferences';
import { logger } from '../utils/logger';

const LAST_USER_KEY = 'last_user_id'; // or 'email_lower'

export async function enableBiometricForUser(userId: string) {
  const avail = await NativeBiometric.isAvailable();
  if (!avail.isAvailable) {
    logger.warn('[Bio] Not available', avail);
    return false;
  }
  // We do NOT store passwords. We only remember who can unlock.
  await Preferences.set({ key: LAST_USER_KEY, value: userId });
  logger.info('[Bio] Enabled for user', { userId });
  return true;
}

export async function tryBiometricAutoLogin(): Promise<string | null> {
  const avail = await NativeBiometric.isAvailable();
  if (!avail.isAvailable) return null;

  // Ask for FaceID/TouchID and return the userId if success.
  try {
    await NativeBiometric.verifyIdentity({
      reason: 'Unlock OurGLP1',
      title: 'Biometric Login',
      subtitle: 'Verify to continue',
      description: '',
      maxAttempts: 3,
      fallbackTitle: 'Enter Passcode',
    });
    const stored = await Preferences.get({ key: LAST_USER_KEY });
    const userId = stored.value ?? null;
    logger.info('[Bio] Verified identity', { hasUser: Boolean(userId) });
    return userId; // Your caller signs in this user without password
  } catch (e) {
    logger.warn('[Bio] Verification failed', { e });
    return null;
  }
}

export async function disableBiometric() {
  await Preferences.remove({ key: LAST_USER_KEY });
  logger.info('[Bio] Disabled');
}
