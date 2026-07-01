// ============================================================================
// File: src/pages/Profile.tsx
// Description: Profile page with shared navigation components (local-only)
// ============================================================================
import { useHistory } from 'react-router-dom';
import { logger } from '../utils/logger';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IonPage,
  IonContent,
  IonSpinner,
  IonButton,
  useIonViewDidEnter,
  useIonViewWillEnter,
  useIonViewWillLeave,
  useIonViewDidLeave,         
  IonAlert,    
} from '@ionic/react';
import imageCompression from 'browser-image-compression';
import { rawTimeZones as timeZones } from '@vvo/tzdb';
import { useAuth } from '@/context/useAuth';
import styles from './Profile.module.css';

import { trackEvent } from '../telemetry/analytics';


import { checkBiometricAvailable, deleteBiometricToken } from '../utils/biometric';
import { Capacitor, type CapacitorException } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource, type CameraPhoto } from '@capacitor/camera';

import { updateLocalUserProfile, type UserProfilePatch } from '../services/localAuth';
import { getSettings, setFastingPlan, setInjectionSchedule, type WeekdayFull } from '@/db/SettingsRepository';
import {
  upsertDailyProtein,
  listHealthLogsRange,
  getHealthDailySummaryByDay,
  upsertHealthDailySummary,
  importAppleHealthWorkoutsAndEmit,
  type HealthDailySummary,
} from '../db/HealthRepository';
import { listSleepLogsRange } from '../db/SleepRepository';
import {
  computeCalorieRange,
  computeCarbRange,
  computeFatRange,
  computeProteinRange,
  computeHydrationRange,
  getSleepColor,
  SLEEP_RECOMMENDED,
} from '../lib/nutrition';
import { addNutritionTotals, nutritionFromLogData, roundNutritionTotals } from '../lib/nutritionLog';
import {
  AppleHealth,
  isAppleHealthSupportedPlatform,
  type AppleHealthDailySummary,
} from '../plugins/appleHealth';

// Import navigation components
import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';
import { Browser } from '@capacitor/browser';
import { Preferences } from '@capacitor/preferences';          // 👈 add
import { dropAllLocalData } from '../db/_maintenance';           // 👈 add
import { emitAuthChanged } from '../services/authBus';           // 👈 add

import { getCurrentEffectiveness, type CurrentEffectiveness } from '../lib/effectiveness';
import Glp1EffectivenessRing from '@/components/Glp1EffectivenessRing';
import {
  createProtocol,
  getPrimaryProtocol,
  type Protocol,
} from '../db/ProtocolRepository';
import {
  getProtocolPreset,
  PROTOCOL_PRESETS,
  type ProtocolPreset,
} from '../lib/protocolCatalog';

// ---------- Debug flag ----------
const DEBUG_PROFILE = false;
const noop: (...args: unknown[]) => void = () => {};
const dlog = DEBUG_PROFILE
  ? {
      debug: (...a: unknown[]) => logger.debug('[Profile]', ...a),
      info:  (...a: unknown[]) => logger.info('[Profile]', ...a),
      warn:  (...a: unknown[]) => logger.warn('[Profile]', ...a),
      error: (...a: unknown[]) => logger.error('[Profile]', ...a),
    }
  : {
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
    };

const todayYmdLocal = (): string => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};




// ---------- Types ----------
type FormShape = {
  email: string;
  first_name: string;
  last_name: string;
  medication_name: string;
  medication_dose: string;
  fasting_schedule: string;
  fasting_start: string;   // HH:MM (input type="time")
  injection_day: string;   // "Mon".."Sun" (3-letter code)
  injection_time: string;  // HH:MM (input type="time", step=900)
  timezone: string;        // used for UI/plan/summary
};

type ProfileBody = Partial<{
  first_name: string;
  last_name: string;
  medication_name: string;
  medication_dose: string;
  fasting_schedule: string;
  fasting_start: string; // HH:MM:SS
  height: string;
  weight: string;
  bmi: string;
}>;

const PROFILE_PRIMARY_PROTOCOL_IDS = [
  'semaglutide',
  'tirzepatide',
  'liraglutide',
] as const;
type PrimaryProtocolRhythm = 'weekly_injection' | 'daily_pill';

const PROFILE_PRIMARY_PROTOCOLS = PROFILE_PRIMARY_PROTOCOL_IDS.map((id) => getProtocolPreset(id));

const MEDICATION_OPTIONS = PROFILE_PRIMARY_PROTOCOLS.map((preset) => preset.name);

type Glp1MedicationFamily = 'semaglutide' | 'tirzepatide' | 'liraglutide';

function medicationFamily(name: string): Glp1MedicationFamily | null {
  const normalized = name.trim().toLowerCase();

  if (!normalized) return null;
  if (
    normalized.includes('semaglutide') ||
    normalized.includes('ozempic') ||
    normalized.includes('wegovy')
  ) {
    return 'semaglutide';
  }
  if (
    normalized.includes('tirzepatide') ||
    normalized.includes('mounjaro') ||
    normalized.includes('zepbound')
  ) {
    return 'tirzepatide';
  }
  if (normalized.includes('liraglutide') || normalized.includes('saxenda')) {
    return 'liraglutide';
  }

  return null;
}

function doseOptionsForMedication(name: string): string[] {
  return protocolPresetForProfileMedication(name)?.doseOptions?.filter((dose) => dose !== 'Other') ?? [];
}

function protocolPresetForProfileMedication(name: string): ProtocolPreset | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;

  const exact = PROTOCOL_PRESETS.find((preset) => preset.name.toLowerCase() === normalized);
  if (exact) return exact;

  switch (medicationFamily(name)) {
    case 'semaglutide':
      return getProtocolPreset('semaglutide');
    case 'tirzepatide':
      return getProtocolPreset('tirzepatide');
    case 'liraglutide':
      return getProtocolPreset('liraglutide');
    default:
      return null;
  }
}

// ---------- Error helpers ----------
type MaybeAxiosLike = {
  isAxiosError?: boolean;
  message?: string;
  response?: { data?: { error?: string; message?: string } };
};

async function openExternal(href: string): Promise<void> {
  try {
    await Browser.open({ url: href });
  } catch {
    // Fallback if Browser plugin isn’t available in web
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

function getErrorMessage(err: unknown, fallback = 'Request failed.'): string {
  if (err instanceof Error && typeof err.message === 'string') return err.message;
  const m = err as MaybeAxiosLike;
  return (
    (m?.response?.data?.error && String(m.response.data.error)) ||
    (m?.response?.data?.message && String(m.response.data.message)) ||
    (m?.message && String(m.message)) ||
    fallback
  );
}

// ---------- Base64 helpers (browser-safe; no Node Buffer) ----------
function binToBase64(bin: string): string {
  // Convert a binary string to base64 in browser environments
  if (typeof btoa !== 'undefined') return btoa(bin);
  // Fallback: TextEncoder -> binary string -> btoa (if present)
  const bytes = new TextEncoder().encode(bin);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa !== 'undefined' ? btoa(s) : '';
}

function base64ToBinary(b64: string): string {
  // Convert base64 to a "binary string" (each char = one byte)
  if (typeof atob !== 'undefined') return atob(b64);
  // If atob isn’t available, produce a conservative fallback
  // (Most WebViews have atob; this is just a last-resort.)
  try {
    const decoder = new TextDecoder('latin1');
    // Decode base64 → bytes using the browser by drawing to a canvas is overkill here,
    // so we return empty string to avoid Buffer usage in truly edge cases.
    // In practice, this branch should almost never run.
    console.warn('[Profile] base64ToBinary fallback path used (no atob)');
    return decoder.decode(new Uint8Array([]));
  } catch {
    return '';
  }
}

// ---------- Helpers ----------



function minutesBetweenIso(startIso: string | null | undefined, endIso: string | null | undefined): number {
  if (!startIso || !endIso) return 0;
  const a = Date.parse(startIso);
  const b = Date.parse(endIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.floor((b - a) / 60000);
}


function getUserIdString(u: unknown): string | null {
  if (!u || typeof u !== 'object') return null;
  const r = u as Record<string, unknown>;
  const raw = r.id;
  if (typeof raw === 'string' && raw.trim() !== '') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}



function shortToFullWeekday(s?: string | null): WeekdayFull | undefined {
  if (!s) return undefined;
  const k = String(s).slice(0, 3).toLowerCase();
  switch (k) {
    case 'mon': return 'Monday';
    case 'tue': return 'Tuesday';
    case 'wed': return 'Wednesday';
    case 'thu': return 'Thursday';
    case 'fri': return 'Friday';
    case 'sat': return 'Saturday';
    case 'sun': return 'Sunday';
    default: return undefined;
  }
}

// numeric helpers
const toNum = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};



// ---- Unit types & conversion helpers ----
type HeightUnit = 'cm' | 'ft-in';
type WeightUnit = 'kg' | 'st-lb' | 'lb';

const KG_PER_LB = 0.45359237;
const CM_PER_INCH = 2.54;
const LB_PER_STONE = 14;

const kgToLb = (kg: number): number => kg * (1 / KG_PER_LB);
const lbToKg = (lb: number): number => lb * KG_PER_LB;

const kgToStonePounds = (kg: number): { stone: number; pounds: number } => {
  if (!kg || kg <= 0) return { stone: 0, pounds: 0 };
  const totalLb = kgToLb(kg);
  let stone = Math.floor(totalLb / LB_PER_STONE);
  let pounds = Math.round(totalLb - stone * LB_PER_STONE);
  // normalise rounding of 14 lb → +1 stone
  if (pounds === LB_PER_STONE) {
    stone += 1;
    pounds = 0;
  }
  return { stone, pounds };
};

const stonePoundsToKg = (stone: number, pounds: number): number => {
  if (!stone && !pounds) return 0;
  const totalLb = stone * LB_PER_STONE + pounds;
  return lbToKg(totalLb);
};

const cmToFeetInches = (cm: number): { feet: number; inches: number } => {
  if (!cm || cm <= 0) return { feet: 0, inches: 0 };
  const totalInches = cm / CM_PER_INCH;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  return { feet, inches };
};

const feetInchesToCm = (feet: number, inches: number): number => {
  if (!feet && !inches) return 0;
  const totalInches = feet * 12 + inches;
  return totalInches * CM_PER_INCH;
};


const toHHMM = (val?: string | null): string => {
  if (!val) return '';
  return val.includes('T') ? val.split('T')[1].slice(0, 5) : val.slice(0, 5);
};

const safeHHMM = (v?: string | null): string => {
  const s = toHHMM(v || '');
  return /^\d{2}:\d{2}$/.test(s) ? s : '';
};

const toHHMMSS = (hhmm?: string): string => (hhmm && hhmm.length >= 5 ? `${hhmm.slice(0, 5)}:00` : '');

// Normalize any weekday-ish string to 3-letter code ('Mon'..'Sun')
const toShortDay = (v?: string | null): string => {
  if (!v) return '';
  const s = String(v).trim().toLowerCase();
  const map: Record<string, string> = {
    mon: 'Mon', monday: 'Mon',
    tue: 'Tue', tues: 'Tue', tuesday: 'Tue',
    wed: 'Wed', weds: 'Wed', wednesday: 'Wed',
    thu: 'Thu', thur: 'Thu', thurs: 'Thu', thursday: 'Thu',
    fri: 'Fri', friday: 'Fri',
    sat: 'Sat', saturday: 'Sat',
    sun: 'Sun', sunday: 'Sun',
  };
  return map[s] || map[s.slice(0, 3)] || '';
};

// Local: file -> data URL
async function fileToDataUrl(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const bin = Array.from(bytes).map((b) => String.fromCharCode(b)).join('');
  const b64 = binToBase64(bin);
  const mime = file.type || 'image/jpeg';
  return `data:${mime};base64,${b64}`;
}

// Convert a Blob/File to a File (ensures we have a name)
const ensureFileWithName = (blob: Blob, fallbackName: string): File =>
  (blob instanceof File ? blob : new File([blob], fallbackName, { type: blob.type || 'application/octet-stream' }));

// Detect native Capacitor environment (iOS/Android) vs web
const isNative = (): boolean => Capacitor.getPlatform() !== 'web';

// Treat user-initiated cancels as non-errors
const isUserCanceled = (e: unknown): boolean => {
  if (e instanceof Error && e.message?.toLowerCase().includes('cancel')) return true;
  if (typeof e === 'object' && e !== null) {
    const code = (e as Partial<CapacitorException> & { code?: string }).code?.toLowerCase();
    if (code === 'user_cancel' || code === 'operation_canceled' || code === 'canceled') return true;
  }
  return false;
};

// Turn a Camera result into a File
async function cameraResultToFile(result: CameraPhoto): Promise<File> {
  const name = `photo_${Date.now()}.${(result.format || 'jpeg').toLowerCase()}`;
  if (result.base64String) {
    const b64 = result.base64String;
    const byteCharacters = base64ToBinary(b64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: `image/${result.format || 'jpeg'}` });
    return new File([blob], name, { type: blob.type });
  }
  const uri = result.webPath || result.path;
  if (!uri) throw new Error('No image URI from camera');
  const res = await fetch(uri);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

// Local-only: accept + normalize plan, no network
async function postWeeklyPlanShort(payload: {
  injection_day: string;   // 'Mon'..'Sun'
  injection_time: string;  // 'HH:MM'
  timezone?: string;
}): Promise<boolean> {
  const day = toShortDay(payload.injection_day);
  const hhmm = (payload.injection_time || '').slice(0, 5);
  if (!day || !hhmm) {
    dlog.warn('postWeeklyPlanShort: invalid payload', payload);
    return false;
  }
  return true;
}

const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3 MB

const Profile: React.FC = () => {
  const { user, loading: authLoading, refreshUser } = useAuth();
  const history = useHistory();

  // All hooks must be unconditionally declared
   // canonical values for calculations / storage
  const [height, setHeight] = useState<number>(0);   // cm
  const [weight, setWeight] = useState<number>(0);   // kg
  const [bmi, setBmi] = useState<number>(0);
    // UI unit selection
  const [heightUnit, setHeightUnit] = useState<HeightUnit>('cm');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');

  // UI fields for non-metric input (kept as strings for <input>)
  const [heightFeet, setHeightFeet] = useState<string>('');
  const [heightInches, setHeightInches] = useState<string>('');
  const [weightStone, setWeightStone] = useState<string>('');
  const [weightPounds, setWeightPounds] = useState<string>('');
  const [weightLb, setWeightLb] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showToast, setShowToast] = useState<boolean>(false);
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [bioResetSupported, setBioResetSupported] = useState(false);
  const [brokenImage, setBrokenImage] = useState(false);
  const [currentEffectiveness, setCurrentEffectiveness] = useState<CurrentEffectiveness | null>(null);
  const [effectivenessRefreshKey, setEffectivenessRefreshKey] = useState(0);
  const [primaryProtocol, setPrimaryProtocol] = useState<Protocol | null>(null);
  const [profileProtocolRhythm, setProfileProtocolRhythm] = useState<PrimaryProtocolRhythm>('weekly_injection');

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState<FormShape>({
    email: '',
    first_name: '',
    last_name: '',
    medication_name: '',
    medication_dose: '',
    fasting_schedule: '',
    fasting_start: '',
    injection_day: '',
    injection_time: '',
    timezone: '',
  });

  const [proteinLoggedToday, setProteinLoggedToday] = useState<number>(0);
  const [carbsLoggedToday, setCarbsLoggedToday] = useState<number>(0);
  const [fatLoggedToday, setFatLoggedToday] = useState<number>(0);
  const [caloriesLoggedToday, setCaloriesLoggedToday] = useState<number>(0);
  const [hydrationLoggedToday, setHydrationLoggedToday] = useState<number>(0);

  const [proteinMin, setProteinMin] = useState<string>('');
  const [proteinMax, setProteinMax] = useState<string>('');
  const [carbsMin, setCarbsMin] = useState<string>('');
  const [carbsMax, setCarbsMax] = useState<string>('');
  const [fatMin, setFatMin] = useState<string>('');
  const [fatMax, setFatMax] = useState<string>('');
  const [caloriesMin, setCaloriesMin] = useState<string>('');
  const [caloriesMax, setCaloriesMax] = useState<string>('');

  const [hydrationMin, setHydrationMin] = useState<string>('');
  const [hydrationMax, setHydrationMax] = useState<string>('');

  const [sleepAvgHours7d, setSleepAvgHours7d] = useState<number>(0);
  const [sleepLoggedNights7d, setSleepLoggedNights7d] = useState<number>(0);
  const [exerciseHealthSummary, setExerciseHealthSummary] = useState<HealthDailySummary | null>(null);
  const [exerciseHealthSyncing, setExerciseHealthSyncing] = useState(false);
  const [exerciseHealthMessage, setExerciseHealthMessage] = useState('');

  const [isCapturing, setIsCapturing] = useState(false);

  // refs
  const fileRefLibrary = useRef<HTMLInputElement>(null);
  const fileRefCamera = useRef<HTMLInputElement>(null);

  // Time zone preference: auto-follow device or manual
  const [tzSource, setTzSource] = useState<'device' | 'manual'>(() => {
    try {
      const saved = window.localStorage.getItem('tzSource');
      return saved === 'manual' ? 'manual' : 'device';
    } catch {
      return 'device';
    }
  });

  const [deviceTimezone, setDeviceTimezone] = useState<string>(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  });

  const effectiveTimezone = useMemo(
    () => (tzSource === 'device' ? deviceTimezone : (form.timezone || 'UTC')),
    [tzSource, deviceTimezone, form.timezone]
  );

  const selectedProtocolPreset = useMemo(
    () => protocolPresetForProfileMedication(form.medication_name),
    [form.medication_name]
  );

  const selectedProtocolIsDaily = profileProtocolRhythm === 'daily_pill';
  const selectedProtocolIsWeekly = profileProtocolRhythm === 'weekly_injection';

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setCurrentEffectiveness(null);
      return;
    }

    const userForEffectiveness = {
      ...user,
      timezone: effectiveTimezone,
    };

    void getCurrentEffectiveness(userForEffectiveness)
      .then((effectiveness) => {
        if (!cancelled) setCurrentEffectiveness(effectiveness);
      })
      .catch(() => {
        if (!cancelled) setCurrentEffectiveness(null);
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveTimezone, effectivenessRefreshKey, user]);

  useEffect(() => {
    const refresh = (): void => setEffectivenessRefreshKey((n) => n + 1);
    window.addEventListener('protocols:changed', refresh);
    window.addEventListener('profile:saved', refresh);
    window.addEventListener('glp1:changed', refresh);
    return () => {
      window.removeEventListener('protocols:changed', refresh);
      window.removeEventListener('profile:saved', refresh);
      window.removeEventListener('glp1:changed', refresh);
    };
  }, []);

  // Global error hooks (dev-only)
  useEffect(() => {
    if (!DEBUG_PROFILE) return;
    const onErr = (ev: ErrorEvent) => dlog.error('window.onerror', ev.message, ev.error);
    const onRej = (ev: PromiseRejectionEvent) => dlog.error('window.unhandledrejection', ev.reason);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);

  // Mount/unmount diagnostics
  
  useEffect(() => {
    dlog.info('mounted');
    return () => dlog.info('unmounted');
  }, []);
  useIonViewWillEnter(() => dlog.info('ionViewWillEnter'));
  useIonViewDidEnter(() => dlog.info('ionViewDidEnter'));
  useIonViewWillLeave(() => dlog.info('ionViewWillLeave'));
  useIonViewDidLeave(() => dlog.info('ionViewDidLeave'));

  useEffect(() => {
    dlog.debug('tzSource changed', { tzSource });
    try {
      window.localStorage.setItem('tzSource', tzSource);
   } catch (e) {
      dlog.debug('tzSource persist failed', e);
    }
  }, [tzSource]);

  // watch for device tz changes (travel/DST)
  useEffect(() => {
    dlog.debug('device tz watch effect: start', { initialDeviceTz: deviceTimezone });
    const readTz = () => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      } catch {
        return 'UTC';
      }
    };
    const check = () => {
      const tz = readTz();
      if (tz !== deviceTimezone) {
        dlog.info('deviceTimezone changed', { from: deviceTimezone, to: tz });
        setDeviceTimezone(tz);
      }
    };
    const onVisible = () => {
      if (!document.hidden) {
        dlog.debug('visibilitychange → check tz');
        check();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(check, 60_000);
    check();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
      dlog.debug('device tz watch effect: cleanup');
    };
  }, [deviceTimezone]);

  // blob URL cleanup
  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith('blob:')) {
        dlog.debug('cleanup: revokeObjectURL (unmount)');
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Discover biometric capability (native + enrolled)
  useEffect(() => {
    dlog.debug('biometric check: start');
    checkBiometricAvailable()
      .then((ok) => {
        dlog.debug('biometric check: result', ok);
        setBioResetSupported(!!ok);
      })
      .catch((e) => {
        dlog.warn('biometric check: error', e);
        setBioResetSupported(false);
      });
  }, []);

  // Initial load from user (local-only)
  useEffect(() => {
    dlog.debug('init effect: user changed', {
      hasUser: !!user,
      userKeys: user ? Object.keys(user) : null,
    });
    if (!user) return;

    const detectedTz = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      } catch {
        return 'UTC';
      }
    })();

    dlog.debug('init: set metrics from user', {
      height: user.height,
      weight: user.weight,
      bmi: user.bmi,
    });

    setHeight(toNum(user.height, 0));
    setWeight(toNum(user.weight, 0));

     // initialise display fields for default units
    if (user.height) {
      const { feet, inches } = cmToFeetInches(toNum(user.height, 0));
      setHeightFeet(feet ? String(feet) : '');
      setHeightInches(inches ? String(inches) : '');
    }
    if (user.weight) {
      const { stone, pounds } = kgToStonePounds(toNum(user.weight, 0));
      setWeightStone(stone ? String(stone) : '');
      setWeightPounds(pounds ? String(pounds) : '');
      setWeightLb(kgToLb(toNum(user.weight, 0)).toFixed(0));
    }

    setForm({
      email: user.email || '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      medication_name: user.medication_name || '',
      medication_dose: user.medication_dose || '',
      fasting_schedule: user.fasting_schedule || '',
      fasting_start: safeHHMM(user.fasting_start),
      injection_day: toShortDay(user.injection_day),
      injection_time: safeHHMM(user.injection_time),
      timezone: user.timezone || detectedTz,
    });

    // Photo preview — data URL only in local mode
    if (user.profile_photo) {
      if (user.profile_photo.startsWith('data:')) {
        dlog.debug('init: set preview from local data URL');
        setPreviewUrl(user.profile_photo);
        setBrokenImage(false);
      } else {
        // Non-data URLs are not used in local-only mode
        setBrokenImage(true);
      }
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setPrimaryProtocol(null);
      return;
    }

    void getPrimaryProtocol(user.id)
      .then((protocol) => {
        if (cancelled) return;
        setPrimaryProtocol(protocol);
        if (!protocol) return;
        setProfileProtocolRhythm(
          protocol.cadence_type === 'daily' || protocol.route_type === 'oral'
            ? 'daily_pill'
            : 'weekly_injection'
        );

        setForm((prev) => ({
          ...prev,
          medication_name: protocol.name || prev.medication_name,
          medication_dose: protocol.dose_label || prev.medication_dose,
          injection_day:
            protocol.cadence_type === 'weekly'
              ? toShortDay(protocol.anchor_day)
              : '',
          injection_time: safeHHMM(protocol.dose_time) || prev.injection_time,
        }));
      })
      .catch((error) => {
        if (!cancelled) {
          setPrimaryProtocol(null);
          dlog.warn('primary protocol load failed', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [effectivenessRefreshKey, user?.id]);

  // Update ft/in display when metric height changes or unit toggles
  useEffect(() => {
    if (heightUnit !== 'ft-in' || !height) return;
    const { feet, inches } = cmToFeetInches(height);
    setHeightFeet(feet ? String(feet) : '');
    setHeightInches(inches ? String(inches) : '');
  }, [height, heightUnit]);

  // Update stone/lb or lb display when metric weight changes or unit toggles
  useEffect(() => {
    if (!weight) return;
    if (weightUnit === 'st-lb') {
      const { stone, pounds } = kgToStonePounds(weight);
      setWeightStone(stone ? String(stone) : '');
      setWeightPounds(pounds ? String(pounds) : '');
    } else if (weightUnit === 'lb') {
      setWeightLb(kgToLb(weight).toFixed(0));
    }
  }, [weight, weightUnit]);

  // Load today's hydration from local DB (mirrors protein)
useEffect(() => {
  const loadTodayHydration = async (): Promise<void> => {
    try {
      const ymdUtc = new Date().toISOString().slice(0, 10);
      const fromIso = `${ymdUtc}T00:00:00.000Z`;
      const toIso   = `${ymdUtc}T23:59:59.999Z`;
      const rows = await listHealthLogsRange(fromIso, toIso);

      const mlFrom = (data: unknown): number => {
        if (data && typeof data === 'object') {
          const o = data as Record<string, unknown>;
          // accept numbers or numeric strings in common keys
          for (const k of ['ml', 'milliliters', 'amount', 'value'] as const) {
            const v = o[k];
            if (typeof v === 'number' && Number.isFinite(v)) return v;
            if (typeof v === 'string' && Number.isFinite(Number(v))) return Number(v);
          }
        }
        return 0;
      };

      const totalMl = rows
        .filter((r) => String(r.entry_type).toLowerCase() === 'hydration')
        .reduce<number>((sum, r) => sum + mlFrom(r.data), 0);

      setHydrationLoggedToday(totalMl);
    } catch {
      setHydrationLoggedToday(0);
    }
  };
  void loadTodayHydration();
}, []);

useEffect(() => {
  const loadSleep7d = async (): Promise<void> => {
    try {
      const today = new Date();
      const toYmd = today.toISOString().slice(0, 10);
      const fromYmd = new Date(today.getTime() - 6 * 24 * 3600 * 1000).toISOString().slice(0, 10);

      const rows = await listSleepLogsRange(fromYmd, toYmd);

      // Sum minutes per local sleep_date; cap crazy values to 20h like your other page
      const perDay: Record<string, number> = {};
      for (const r of rows) {
        const mins = minutesBetweenIso(r.sleep_at, r.wake_at);
        if (mins > 0 && mins <= 20 * 60) {
          const key = r.sleep_date; // already YYYY-MM-DD
          perDay[key] = (perDay[key] ?? 0) + mins;
        }
      }

      const totals = Object.values(perDay).filter(m => m > 0);
      const nights = totals.length;
      const avgHours = nights ? Number((totals.reduce((s, m) => s + m, 0) / 60 / nights).toFixed(1)) : 0;

      setSleepLoggedNights7d(Math.min(7, nights));
      setSleepAvgHours7d(avgHours);
   } catch (err) {
  dlog.warn('loadSleep7d failed', err);
  setSleepLoggedNights7d(0);
  setSleepAvgHours7d(0);
}
  };

  void loadSleep7d();

  // Optional: live refresh if other parts of app emit sleep changes
  const onChanged = () => void loadSleep7d();
  window.addEventListener('sleep:changed', onChanged);
  return () => window.removeEventListener('sleep:changed', onChanged);
}, []);

const loadExerciseHealthSummary = useCallback(async (): Promise<void> => {
  try {
    const summary = await getHealthDailySummaryByDay(todayYmdLocal());
    setExerciseHealthSummary(summary);
  } catch (err) {
    dlog.warn('loadExerciseHealthSummary failed', err);
    setExerciseHealthSummary(null);
  }
}, []);

useEffect(() => {
  void loadExerciseHealthSummary();
  const onChanged = () => void loadExerciseHealthSummary();
  window.addEventListener('health:changed', onChanged);
  window.addEventListener('exercise:changed', onChanged);
  return () => {
    window.removeEventListener('health:changed', onChanged);
    window.removeEventListener('exercise:changed', onChanged);
  };
}, [loadExerciseHealthSummary]);

const syncExerciseAppleHealth = useCallback(async (): Promise<void> => {
  setExerciseHealthMessage('');

  if (!isAppleHealthSupportedPlatform()) {
    setExerciseHealthMessage('Apple Health is available on iPhone builds.');
    return;
  }

  setExerciseHealthSyncing(true);
  try {
    const availability = await AppleHealth.isAvailable();
    if (!availability.available) {
      setExerciseHealthMessage('Apple Health is not available on this device.');
      return;
    }

    const day = todayYmdLocal();
    await AppleHealth.requestAuthorization();
    const summary: AppleHealthDailySummary = await AppleHealth.getDailySummary({ day });
    const workoutResult = await AppleHealth.getWorkouts({ day });

    await upsertHealthDailySummary({
      day: summary.day,
      source: 'apple_health',
      steps: summary.steps,
      activeEnergyKcal: summary.activeEnergyKcal,
      exerciseMinutes: summary.exerciseMinutes,
      sleepMinutes: summary.sleepMinutes,
      restingHeartRate: summary.restingHeartRate,
      averageHeartRate: summary.averageHeartRate,
      latestHeartRate: summary.latestHeartRate,
      workouts: summary.workouts,
    });

    const imported = await importAppleHealthWorkoutsAndEmit(workoutResult.workouts);
    setExerciseHealthMessage(
      imported.inserted > 0
        ? `Apple Health activity synced. Added ${imported.inserted} workout${imported.inserted === 1 ? '' : 's'}.`
        : 'Apple Health activity synced. No new workouts to add.'
    );
    await loadExerciseHealthSummary();
    window.dispatchEvent(new Event('exercise:changed'));
  } catch (err) {
    dlog.warn('syncExerciseAppleHealth failed', err);
    setExerciseHealthMessage('Apple Health could not sync yet.');
  } finally {
    setExerciseHealthSyncing(false);
  }
}, [loadExerciseHealthSummary]);

  // Refresh nutrition/hydration totals when logs change elsewhere
useEffect(() => {
  const reload = async (): Promise<void> => {
    try {
      const ymdUtc = new Date().toISOString().slice(0, 10);
      const fromIso = `${ymdUtc}T00:00:00.000Z`;
      const toIso   = `${ymdUtc}T23:59:59.999Z`;
      const rows = await listHealthLogsRange(fromIso, toIso);

      const numFrom = (data: unknown, keys: readonly string[]): number => {
        if (data && typeof data === 'object') {
          const o = data as Record<string, unknown>;
          for (const k of keys) {
            const v = o[k];
            if (typeof v === 'number' && Number.isFinite(v)) return v;
            if (typeof v === 'string' && Number.isFinite(Number(v))) return Number(v);
          }
        }
        return 0;
      };

      const nutrition = roundNutritionTotals(rows
        .filter((r) => String(r.entry_type).toLowerCase() === 'protein')
        .reduce((sum, r) => addNutritionTotals(sum, nutritionFromLogData(r.data)), {
          protein: 0,
          carbs: 0,
          fat: 0,
          calories: 0,
        }));
      setProteinLoggedToday(nutrition.protein);
      setCarbsLoggedToday(nutrition.carbs);
      setFatLoggedToday(nutrition.fat);
      setCaloriesLoggedToday(nutrition.calories);

      const hydration = rows
        .filter((r) => String(r.entry_type).toLowerCase() === 'hydration')
        .reduce<number>((sum, r) => sum + numFrom(r.data, ['ml', 'milliliters', 'amount', 'value']), 0);
      setHydrationLoggedToday(hydration);
    } catch (e) {
      dlog.warn('reload (nutrition/hydration) failed', e);
    }
  };

  void reload();
  window.addEventListener('protein:changed', reload);
  window.addEventListener('hydration:changed', reload);
  return () => {
    window.removeEventListener('protein:changed', reload);
    window.removeEventListener('hydration:changed', reload);
  };
}, []);

  // BMI + protein/hydration targets
  useEffect(() => {
    const h = toNum(height, 0);
    const w = toNum(weight, 0);
    if (h > 0 && w > 0) {
      const meters = h / 100;
      const bmiVal = w / (meters * meters);
      const nextBmi = Number.isFinite(bmiVal) ? bmiVal : 0;
      setBmi(nextBmi);

      const range = computeProteinRange(w);
      setProteinMin(range ? String(range.min) : '');
      setProteinMax(range ? String(range.max) : '');
      const carbRange = computeCarbRange();
      setCarbsMin(String(carbRange.min));
      setCarbsMax(String(carbRange.max));
      const fatRange = computeFatRange(w);
      setFatMin(fatRange ? String(fatRange.min) : '');
      setFatMax(fatRange ? String(fatRange.max) : '');
      const calorieRange = computeCalorieRange(w);
      setCaloriesMin(calorieRange ? String(calorieRange.min) : '');
      setCaloriesMax(calorieRange ? String(calorieRange.max) : '');

      dlog.debug('bmi/protein effect', { h, w, bmi: nextBmi });
    } else {
      setBmi(0);
      setProteinMin('');
      setProteinMax('');
      setCarbsMin('');
      setCarbsMax('');
      setFatMin('');
      setFatMax('');
      setCaloriesMin('');
      setCaloriesMax('');
      dlog.debug('bmi/protein effect: reset (insufficient metrics)', { h, w });
    }
  }, [height, weight]);

  useEffect(() => {
    const w = toNum(weight, 0);
    if (w > 0) {
      const range = computeHydrationRange(w);
      setHydrationMin(range ? String(range.min) : '');
      setHydrationMax(range ? String(range.max) : '');
      dlog.debug('hydration effect', { w });
    } else {
      setHydrationMin('');
      setHydrationMax('');
      dlog.debug('hydration effect: reset (no weight)');
    }
  }, [weight]);

  // Stable user id derived once per id-change
  const uid = getUserIdString(user as unknown);

 // Persist a canonical daily PROTEIN total row whenever the displayed total changes
  useEffect(() => {
    if (!uid || proteinLoggedToday == null) return;
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' (UTC)
    void (async () => {
      try {
        await upsertDailyProtein(uid, today, proteinLoggedToday);
        dlog.debug('Daily protein upserted', { userId: uid, date: today, protein: proteinLoggedToday });
      } catch (err) {
        dlog.warn('Failed to upsert daily protein', err);
      }
    })();
  }, [uid, proteinLoggedToday]);

  // Persist a canonical daily HYDRATION total row whenever the displayed total changes
  useEffect(() => {
    if (!uid || hydrationLoggedToday == null) return;
    const today = new Date().toISOString().slice(0, 10);
    void (async () => {
      try {
        const { upsertDailyHydration } = await import('@/db/HealthRepository');
        await upsertDailyHydration(uid, today, hydrationLoggedToday);
        dlog.debug('Daily hydration upserted', { userId: uid, date: today, ml: hydrationLoggedToday });
        window.dispatchEvent(new Event('hydration:changed'));
      } catch (err) {
        dlog.warn('Failed to upsert daily hydration', err);
      }
    })();
  }, [uid, hydrationLoggedToday]);

  const sleepColor = getSleepColor(sleepAvgHours7d);
  const sleepBadgeClass =
  sleepColor === 'green'
    ? styles.sleepGreen
    : sleepColor === 'yellow'
    ? styles.sleepYellow
    : styles.sleepRed;


  const handlePhotoChange = async (e?: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    dlog.info('handlePhotoChange: start');
    const inputEl = (e?.currentTarget ?? fileRefLibrary.current ?? fileRefCamera.current) as HTMLInputElement | null;
    const file = e?.target?.files?.[0];
    if (!file) {
      dlog.debug('handlePhotoChange: no file');
      return;
    }

    dlog.debug('handlePhotoChange: file', { type: file.type, size: file.size });

    // type validation (loose)
    const okTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!okTypes.includes(file.type) && !file.type.startsWith('image/')) {
      alert('Please choose an image file.');
      return;
    }

    // size validation
    if (file.size > MAX_FILE_BYTES) {
      alert('Please choose an image smaller than 3 MB.');
      return;
    }

    try {
      const compressedBlob = await imageCompression(file, {
        maxSizeMB: 0.3,
        maxWidthOrHeight: 800,
        useWebWorker: true,
      });
      dlog.debug('handlePhotoChange: compressed', { size: compressedBlob.size, type: compressedBlob.type });
      const compressed = ensureFileWithName(compressedBlob, file.name || 'photo.jpg');
      setProfilePhoto(compressed);
      setBrokenImage(false);

      setPreviewUrl((old) => {
        if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
        const url = URL.createObjectURL(compressed);
        dlog.debug('handlePhotoChange: previewUrl set');
        return url;
      });
    } catch (err) {
      dlog.warn('image compress failed', err);
      alert('Could not process image.');
    } finally {
      if (inputEl) {
        setTimeout(() => {
          try {
            inputEl.value = '';
          } catch (e2) {
            dlog.debug('file input clear failed', e2);
          }
        }, 0);
      }
    }
  };

  const handleTakePhoto = async (): Promise<void> => {
    if (isCapturing) return;
    setIsCapturing(true);
    dlog.info('handleTakePhoto: start', { native: isNative() });
    try {
      if (!isNative()) {
        fileRefCamera.current?.click();
        return;
      }
      const shot = await Camera.getPhoto({
        resultType: isNative() ? CameraResultType.Base64 : CameraResultType.Uri,
        source: CameraSource.Camera,
        quality: 60,
        allowEditing: false,
      });
      dlog.debug('handleTakePhoto: shot', { format: shot.format, webPath: !!shot.webPath, path: !!shot.path });
      const file = await cameraResultToFile(shot);
      const compressedBlob = await imageCompression(file, {
        maxSizeMB: 0.3,
        maxWidthOrHeight: 800,
        useWebWorker: true,
      });
      dlog.debug('handleTakePhoto: compressed', { size: compressedBlob.size, type: compressedBlob.type });
      const compressed = ensureFileWithName(compressedBlob, file.name || 'photo.jpg');
      setProfilePhoto(compressed);
      setBrokenImage(false);

      setPreviewUrl((old) => {
        if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
        const url = URL.createObjectURL(compressed);
        dlog.debug('handleTakePhoto: previewUrl set');
        return url;
      });
    } catch (err) {
      if (isUserCanceled(err)) {
        dlog.info('handleTakePhoto: user canceled');
        return;
      }
      dlog.warn('camera capture failed', err);
      alert('Could not open the camera. You can pick from your photo library instead.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleResetFaceID = async (): Promise<void> => {
    dlog.info('handleResetFaceID: start');
    try {
      await deleteBiometricToken();
      trackEvent('profile_saved', { action: 'biometric_reset' });
      alert('Biometric credentials removed.');
      dlog.info('handleResetFaceID: success');
    } catch (e) {
      dlog.warn('handleResetFaceID: failed', e);
      alert('Failed to remove credentials.');
    }
  };

  const handleImgError = (): void => {
    dlog.warn('image failed to load');
    setBrokenImage(true);
  };

  const handleDeleteAccount = async (): Promise<void> => {
  dlog.info('[Profile] handleDeleteAccount: start');
  setDeleting(true);
  try {
    const result = await dropAllLocalData();
    await Preferences.clear();
    emitAuthChanged(null);
    if (result.ok) {
      alert('Your account and all data on this device have been deleted.');
      history.replace('/welcome');
    } else {
      alert(`Deletion completed with issues:\n\n${result.errors.join('\n')}`);
    }
  } catch (err) {
    dlog.error('[Profile] delete failed', err);
    alert('Delete failed. Please try again.');
  } finally {
    setDeleting(false);
    setConfirmDeleteOpen(false);
  }
};

  const handleSubmit = async (): Promise<void> => {
    dlog.info('handleSubmit: start');
    setIsSubmitting(true);

    try {
      const body: ProfileBody = {};
      const protocolPreset = selectedProtocolPreset;
      const protocolDose = form.medication_dose.trim();
      const protocolTime = safeHHMM(form.injection_time) || '08:00';
      const weeklyAnchorDay = shortToFullWeekday(form.injection_day);
      const shouldSavePrimaryProtocol = Boolean(
        protocolPreset &&
          protocolDose &&
          protocolTime &&
          (!selectedProtocolIsWeekly || weeklyAnchorDay)
      );
      const nextProtocolAnchorDay = selectedProtocolIsWeekly ? weeklyAnchorDay : null;
      const nextProtocolRouteLabel = selectedProtocolIsWeekly ? 'Injection' : 'Oral';
      const nextProtocolRouteType = selectedProtocolIsWeekly ? 'injection' as const : 'oral' as const;
      const nextProtocolCadenceLabel = selectedProtocolIsWeekly ? 'Weekly' : 'Daily';
      const nextProtocolCadenceType = selectedProtocolIsWeekly ? 'weekly' as const : 'daily' as const;
      const nextProtocolEffectivenessModel = selectedProtocolIsWeekly ? 'weekly_glp1' as const : 'daily_24h' as const;
      const primaryProtocolChanged = Boolean(
        shouldSavePrimaryProtocol &&
          (
            !primaryProtocol ||
            primaryProtocol.name !== protocolPreset?.name ||
            (primaryProtocol.dose_label ?? '') !== protocolDose ||
            (primaryProtocol.dose_time ?? '') !== protocolTime ||
            (primaryProtocol.anchor_day ?? null) !== nextProtocolAnchorDay ||
            primaryProtocol.cadence_type !== nextProtocolCadenceType ||
            primaryProtocol.route_type !== nextProtocolRouteType
          )
      );

      // Weekly Plan — always local
      if (selectedProtocolIsWeekly && form.injection_day && form.injection_time) {
        dlog.debug('handleSubmit: postWeeklyPlanShort');
        await postWeeklyPlanShort({
          injection_day: toShortDay(form.injection_day),
          injection_time: form.injection_time,
          timezone: effectiveTimezone,
        });
      }

      // === Detect changes (local write-through) ===
      const nextSchedule = form.fasting_schedule;
      const nextStart8 = toHHMMSS(form.fasting_start);
      const fastingChanged = true;

      if (fastingChanged) {
        body.fasting_schedule = nextSchedule;
        body.fasting_start = nextStart8;
      }

      body.medication_name = form.medication_name;
      body.medication_dose = form.medication_dose;
      body.first_name = form.first_name;
      body.last_name = form.last_name;

      if (height) body.height = String(height);
      if (weight) body.weight = String(weight);
      if (bmi) body.bmi = String(bmi.toFixed(1));

      dlog.debug('handleSubmit: changes summary', {
        bodyKeys: Object.keys(body),
        hasPhoto: !!profilePhoto,
      });

      // === LOCAL SAVE ===
      const patch: UserProfilePatch = {
        first_name: body.first_name ?? null,
        last_name: body.last_name ?? null,
        medication_name: body.medication_name ?? null,
        medication_dose: body.medication_dose ?? null,
        timezone: effectiveTimezone ?? null,
        height: body.height ? Number(body.height) : null,
        weight: body.weight ? Number(body.weight) : null,
        bmi: body.bmi ? Number(body.bmi) : null,
        injection_day: selectedProtocolIsWeekly ? (toShortDay(form.injection_day) || null) : null,
        injection_time: safeHHMM(form.injection_time) || null,
        fasting_schedule: body.fasting_schedule ?? null,
        fasting_start: body.fasting_start ? safeHHMM(body.fasting_start) : null,
      };

      dlog.debug('[Profile DEBUG] Saving fasting data to DB:', {
        fasting_schedule: patch.fasting_schedule,
        fasting_start: patch.fasting_start,
      });

      if (profilePhoto) {
        try {
          const dataUrl = await fileToDataUrl(profilePhoto);
          patch.profile_photo = dataUrl;
        } catch (e) {
          dlog.warn('local photo encode failed', e);
        }
      }

      // 1) Persist profile to local DB
      await updateLocalUserProfile(user!.id, patch);

      if (primaryProtocolChanged && protocolPreset) {
        await createProtocol({
          userId: user!.id,
          kind: protocolPreset.kind,
          name: protocolPreset.name,
          doseLabel: protocolDose,
          cadenceLabel: nextProtocolCadenceLabel,
          routeLabel: nextProtocolRouteLabel,
          routeType: nextProtocolRouteType,
          cadenceType: nextProtocolCadenceType,
          doseTime: protocolTime,
          anchorDay: nextProtocolAnchorDay,
          reviewAnchorDay: selectedProtocolIsDaily ? 'Monday' : nextProtocolAnchorDay,
          effectivenessModel: nextProtocolEffectivenessModel,
          trackingFocus: protocolPreset.trackingFocus,
          notes: selectedProtocolIsDaily
            ? `${protocolPreset.note} Daily pill rhythm selected by the user.`
            : protocolPreset.note,
          isPrimary: true,
        });
        setPrimaryProtocol(await getPrimaryProtocol(user!.id));
        window.dispatchEvent(new Event('protocols:changed'));
      }

     // 2) Persist fasting/injection schedule to settings (so DayPage reads it)
      try {
        if (patch.fasting_schedule || patch.fasting_start) {
          await setFastingPlan(patch.fasting_schedule ?? '', patch.fasting_start ?? '');
          dlog.debug('handleSubmit: setFastingPlan saved to settings');
        }

        const dayFull = selectedProtocolIsWeekly ? shortToFullWeekday(patch.injection_day ?? null) : null;
        if (dayFull && patch.injection_time) {
          await setInjectionSchedule(dayFull, patch.injection_time);
          dlog.debug('handleSubmit: setInjectionSchedule saved to settings');
        }
          // Broadcast settings change so listeners can refresh immediately
        window.dispatchEvent(new Event('settings:changed'));

        // Also broadcast a precise anchor-change event for week/day recompute
        if (patch.injection_day || patch.injection_time || patch.timezone) {
         const detail = {
            day: patch.injection_day ?? null,
            time: patch.injection_time ?? null,
            // prefer patch.timezone if defined; otherwise fall back to effectiveTimezone; otherwise null
            tz: patch.timezone ?? effectiveTimezone ?? null,
          };
          window.dispatchEvent(new CustomEvent('anchor:changed', { detail }));
        }
      } catch (e) {
        dlog.warn('handleSubmit: saving to settings failed', e);
      }

     
     // 3) Refresh auth context so components using useAuth() re-render with new values
     await refreshUser();

      const verify = await getSettings();
      dlog.debug('[Profile DEBUG] Saved DB state:', {
        fasting_schedule: verify.fasting_schedule,
        fasting_start: verify.fasting_start,
      });

      // === Update UI ===
      setForm((prev) => ({
        ...prev,
        injection_day: selectedProtocolIsWeekly ? (patch.injection_day || prev.injection_day) : '',
        injection_time: patch.injection_time || prev.injection_time,
        fasting_schedule: patch.fasting_schedule ?? prev.fasting_schedule,
        fasting_start: patch.fasting_start ?? prev.fasting_start,
        timezone: patch.timezone || prev.timezone,
      }));

      setHeight(patch.height ?? height);
      setWeight(patch.weight ?? weight);
      setBmi(patch.bmi ?? bmi);

      if (patch.profile_photo) {
        setPreviewUrl(patch.profile_photo);
        setBrokenImage(false);
      }

      // Analytics
      const changedFields = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] != null);
      trackEvent('profile_saved', { fields: changedFields });
      if (patch.fasting_schedule) {
        trackEvent('fasting_schedule_saved', { window: patch.fasting_schedule });
      }

     // Single, final "profile saved" signal for any loose listeners
      window.dispatchEvent(new Event('profile:saved'));
      setShowToast(true);
      dlog.info('handleSubmit: done');
   } catch (e) {
      const msg = getErrorMessage(e, 'Could not save profile.');
      dlog.error('[profile] save failed', e);
      alert(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Derived values
  const safeBmi = toNum(bmi, 0);
  const medicationDoseOptions = useMemo(
    () => (
      selectedProtocolIsDaily
        ? getProtocolPreset('daily-glp1-pill').doseOptions?.filter((dose) => dose !== 'Other') ?? []
        : doseOptionsForMedication(form.medication_name)
    ),
    [form.medication_name, selectedProtocolIsDaily]
  );
  const visibleMedicationDoseOptions = useMemo(() => {
    const currentDose = form.medication_dose.trim();
    if (!currentDose || medicationDoseOptions.includes(currentDose)) return medicationDoseOptions;
    return [currentDose, ...medicationDoseOptions];
  }, [form.medication_dose, medicationDoseOptions]);
  const glp1Pct = currentEffectiveness?.percent ?? 0;
  const effectivenessIsDaily =
    currentEffectiveness?.model === 'daily' ||
    primaryProtocol?.effectiveness_model === 'daily_24h' ||
    selectedProtocolIsDaily;
  const effectivenessFallbackTitle = effectivenessIsDaily
    ? 'Daily Pill Effectiveness'
    : 'Weekly Injection Effectiveness';
  const effectivenessFallbackLabel = effectivenessIsDaily
    ? `Daily pill${form.medication_dose ? ` - ${form.medication_dose}` : ''}`
    : `${form.medication_name || 'Weekly GLP-1'}${form.medication_dose ? ` - ${form.medication_dose}` : ''}`;
  const effectivenessFallbackDetail = effectivenessIsDaily
    ? `Estimated 24-hour coverage from your usual ${safeHHMM(primaryProtocol?.dose_time ?? form.injection_time) || '08:00'} pill time`
    : 'Estimated weekly injection effectiveness since the scheduled dose';
  const effectivenessTitle = currentEffectiveness?.title ?? effectivenessFallbackTitle;
  const effectivenessLabel =
    currentEffectiveness && currentEffectiveness.model === (effectivenessIsDaily ? 'daily' : 'weekly')
      ? currentEffectiveness.label
      : effectivenessFallbackLabel;
  const effectivenessDetail =
    currentEffectiveness && currentEffectiveness.model === (effectivenessIsDaily ? 'daily' : 'weekly')
      ? currentEffectiveness.detail
      : effectivenessFallbackDetail;

  
    const bmiClass =
  safeBmi < 18.5
    ? styles.bmiBlue
    : safeBmi < 25
    ? styles.bmiGreen
    : safeBmi < 30
    ? styles.bmiYellow
    : styles.bmiRed;


  const proteinMinNum = toNum(proteinMin, 0);
  const proteinMaxNum = toNum(proteinMax, 0);
  const carbsMinNum = toNum(carbsMin, 0);
  const carbsMaxNum = toNum(carbsMax, 0);
  const fatMinNum = toNum(fatMin, 0);
  const fatMaxNum = toNum(fatMax, 0);
  const caloriesMinNum = toNum(caloriesMin, 0);
  const caloriesMaxNum = toNum(caloriesMax, 0);
  const hydrationMinNum = toNum(hydrationMin, 0);
  const hydrationMaxNum = toNum(hydrationMax, 0);

  const proteinRemainingMin = Math.max(0, proteinMinNum - proteinLoggedToday);
  const proteinRemainingMax = Math.max(0, proteinMaxNum - proteinLoggedToday);
  const carbsRemainingMin = Math.max(0, carbsMinNum - carbsLoggedToday);
  const carbsRemainingMax = Math.max(0, carbsMaxNum - carbsLoggedToday);
  const fatRemainingMin = Math.max(0, fatMinNum - fatLoggedToday);
  const fatRemainingMax = Math.max(0, fatMaxNum - fatLoggedToday);
  const caloriesRemainingMin = Math.max(0, caloriesMinNum - caloriesLoggedToday);
  const caloriesRemainingMax = Math.max(0, caloriesMaxNum - caloriesLoggedToday);
  const hydrationRemainingMin = Math.max(0, hydrationMinNum - hydrationLoggedToday);
  const hydrationRemainingMax = Math.max(0, hydrationMaxNum - hydrationLoggedToday);

  // Precompute branch views
const loadingView = (
  <div className={styles.loadingCenter}>
    <IonSpinner />
  </div>
);

const noUserView = (
  <div className={styles.noUserBox}>
    <p>No user found. Please log in.</p>
  </div>
);

const mainUIView = (
  <div className={styles.mainScroll}>
    <div className={styles.profileContainer}>
        <h2 className={styles.title}>Welcome, {form.first_name || 'User'}</h2>

        <div className={styles.topRow}>
          <div className={styles.flexRow}>
            {/* Height with unit selector */}
            <div className={styles.fieldGroup}>
              <label>Height</label>
              <div className={styles.rowCenterGap8}>
                <select
  value={heightUnit}
  onChange={(e) => setHeightUnit(e.target.value as HeightUnit)}
  className={`${styles.input} ${styles.w40}`}
  aria-label="Height unit"
  title="Height unit"
>
  <option value="cm">cm</option>
  <option value="ft-in">ft / in</option>
</select>

                {heightUnit === 'cm' ? (
  <input
    type="number"
    inputMode="decimal"
    step="0.1"
    min={100}
    max={250}
    value={height || ''}
    onChange={(e) => setHeight(toNum(e.target.value, 0))}
    className={`${styles.input} ${styles.w60}`}
    placeholder="cm"
    aria-label="Height in centimeters"
    title="Height in centimeters"
  />
) : (
  <div className={`${styles.rowGap6} ${styles.w60}`}>
    <input
      type="number"
      inputMode="decimal"
      min={3}
      max={8}
      value={heightFeet}
      onChange={(e) => {
        const next = e.target.value;
        setHeightFeet(next);
        const cm = feetInchesToCm(toNum(next, 0), toNum(heightInches, 0));
        setHeight(cm);
      }}
      className={`${styles.input} ${styles.half}`}
      placeholder="ft"
      aria-label="Height feet"
      title="Height feet"
    />
    <input
      type="number"
      inputMode="decimal"
      min={0}
      max={11}
      value={heightInches}
      onChange={(e) => {
        const next = e.target.value;
        setHeightInches(next);
        const cm = feetInchesToCm(toNum(heightFeet, 0), toNum(next, 0));
        setHeight(cm);
      }}
      className={`${styles.input} ${styles.half}`}
      placeholder="in"
      aria-label="Height inches"
      title="Height inches"
    />
  </div>
)}
</div>
</div>

<br />
<br />

{/* Weight with unit selector */}
<div className={styles.fieldGroup}>
  <label>Weight</label>
  <div className={styles.colGap6}>
    <select
      value={weightUnit}
      onChange={(e) => setWeightUnit(e.target.value as WeightUnit)}
      className={styles.input}
      aria-label="Weight unit"
      title="Weight unit"
    >
      <option value="kg">kg</option>
      <option value="st-lb">stone + lb</option>
      <option value="lb">lb (US)</option>
    </select>

    {weightUnit === 'kg' && (
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        min={30}
        max={400}
        value={weight || ''}
        onChange={(e) => setWeight(toNum(e.target.value, 0))}
        className={styles.input}
        placeholder="kg"
        aria-label="Weight in kilograms"
        title="Weight in kilograms"
      />
    )}

    {weightUnit === 'st-lb' && (
      <div className={styles.rowGap6}>
        <input
          type="number"
          inputMode="decimal"
          min={4}
          max={40}
          value={weightStone}
          onChange={(e) => {
            const next = e.target.value;
            setWeightStone(next);
            const kg = stonePoundsToKg(toNum(next, 0), toNum(weightPounds, 0));
            setWeight(kg);
          }}
          className={`${styles.input} ${styles.half}`}
          placeholder="st"
          aria-label="Weight stone"
          title="Weight stone"
        />
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={13}
          value={weightPounds}
          onChange={(e) => {
            const next = e.target.value;
            setWeightPounds(next);
            const kg = stonePoundsToKg(toNum(weightStone, 0), toNum(next, 0));
            setWeight(kg);
          }}
          className={`${styles.input} ${styles.half}`}
          placeholder="lb"
          aria-label="Weight pounds"
          title="Weight pounds"
        />
      </div>
    )}

    {weightUnit === 'lb' && (
      <input
        type="number"
        inputMode="decimal"
        min={70}
        max={900}
        value={weightLb}
        onChange={(e) => {
          const next = e.target.value;
          setWeightLb(next);
          const kg = lbToKg(toNum(next, 0));
          setWeight(kg);
        }}
        className={styles.input}
        placeholder="lb"
        aria-label="Weight in pounds"
        title="Weight in pounds"
      />
    )}
  </div>
</div>
</div>

<br />
<br />

<div className={styles.bmiBox}>
 <div className={`${styles.bmiValue} ${bmiClass}`}>
  BMI: {safeBmi > 0 ? safeBmi.toFixed(1) : '—'}
</div>
  <div className={styles.bmiLabel}>
    {safeBmi === 0
      ? ''
      : safeBmi < 18.5
      ? 'Underweight'
      : safeBmi < 25
      ? 'Healthy weight'
      : safeBmi < 30
      ? 'Overweight'
      : 'Obese'}
  </div>
</div>

<div className={styles.sourceRow}>
  <strong>Sources:</strong>{' '}
  <button
    type="button"
    onClick={() => openExternal('https://www.cdc.gov/bmi/faq/?CDC_AAref_Val')}
    className={styles.linkButton}
    aria-label="CDC: About Adult BMI (opens external website)"
    title="CDC — About Adult BMI"
  >
    CDC — About Adult BMI
  </button>
  {' · '}
  <button
    type="button"
    onClick={() =>
      openExternal('https://www.who.int/news-room/fact-sheets/detail/obesity-and-overweight')
    }
    className={styles.linkButton}
    aria-label="WHO: Obesity and overweight (opens external website)"
    title="WHO — BMI Categories & context"
  >
    WHO — BMI Categories & context
  </button>
</div>

<div className={styles.cardsGrid}>
  <div
    className={`${styles.statCard} ${styles.clickableCard}`}
    role="button"
    tabIndex={0}
    aria-label="View detailed medication effectiveness"
    onClick={() => history.push('/effectiveness')}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        history.push('/effectiveness');
      }
    }}
  >
    <div className={styles.statTitle}>{effectivenessTitle}</div>
    <div className={styles.mutedSmall}>Tap to view detailed effectiveness</div>
    <div aria-hidden className={styles.endSpacer} />

    <div className={styles.glp1Row}>
      <Glp1EffectivenessRing
        percent={glp1Pct}
        ariaLabel={`Estimated medication effectiveness ${glp1Pct} percent`}
      />

      <div className={styles.glp1Text}>
        <div>
          <strong>{effectivenessLabel}</strong>
        </div>

        <div className={styles.muted}>
          {effectivenessDetail}
        </div>
      </div>
    </div>
  </div>

  <div
    className={`${styles.statCard} ${styles.clickableCard} ${styles.protocolSummaryCard}`}
    role="button"
    tabIndex={0}
    aria-label="Change or add protocol"
    onClick={() => history.push('/protocols')}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        history.push('/protocols');
      }
    }}
  >
    <div className={styles.statTitle}>Primary Protocol</div>
    <div className={styles.mutedSmall}>Tap to change or add protocol</div>
    <div className={styles.protocolSummaryRows}>
      <div>
        <span>Medication</span>
        <strong>{primaryProtocol?.name || form.medication_name || 'Not selected'}</strong>
      </div>
      <div>
        <span>Type</span>
        <strong>{selectedProtocolIsDaily ? 'Daily pill' : 'Weekly injection'}</strong>
      </div>
      <div>
        <span>Dose</span>
        <strong>{primaryProtocol?.dose_label || form.medication_dose || 'Not set'}</strong>
      </div>
      <div>
        <span>{selectedProtocolIsDaily ? 'Dose time' : 'Anchor'}</span>
        <strong>
          {selectedProtocolIsDaily
            ? safeHHMM(primaryProtocol?.dose_time ?? form.injection_time) || '08:00'
            : `${toShortDay(primaryProtocol?.anchor_day) || form.injection_day || 'Mon'} ${safeHHMM(primaryProtocol?.dose_time ?? form.injection_time) || '08:00'}`}
        </strong>
      </div>
    </div>
  </div>

  <div
    className={`${styles.statCard} ${styles.clickableCard}`}
    role="button"
    tabIndex={0}
    aria-label="Open protocol tracker"
    onClick={() => history.push('/protocols')}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        history.push('/protocols');
      }
    }}
  >
    <div className={styles.statTitle}>Primary Protocol</div>
    <div className={styles.mutedSmall}>Tap to manage protocol tracking</div>
    <div aria-hidden className={styles.endSpacer} />

    <div className={styles.glp1Row}>
      <div className={styles.protocolMiniBadge}>Track</div>

      <div className={styles.glp1Text}>
        <div>
          <strong>{form.medication_name || 'Peptide and GLP-1 tracking'}</strong>
        </div>

        <div className={styles.muted}>
          Record timing, dose labels, and observations in Protocols
        </div>
      </div>
    </div>
  </div>
</div>

<div className={styles.cardsGrid}>
  {/* 🥩 Protein */}
  {proteinMin && proteinMax && (
    <div className={styles.statCard}>
      <div className={styles.statTitle}>🥩 Protein</div>
      <div>
        <strong>Target:</strong> {proteinMin}–{proteinMax} g/day
      </div>
      <div className={styles.mt6}>
        <strong>Logged today:</strong> {proteinLoggedToday} g
      </div>
      <div className={styles.mt6}>
        <strong>Remaining:</strong> {proteinRemainingMin}–{proteinRemainingMax} g
      </div>
    </div>
  )}

  {carbsMin && carbsMax && (
    <div className={styles.statCard}>
      <div className={styles.statTitle}>🌾 Carbs</div>
      <div>
        <strong>Target:</strong> {carbsMin}–{carbsMax} g/day
      </div>
      <div className={styles.mt6}>
        <strong>Logged today:</strong> {carbsLoggedToday} g
      </div>
      <div className={styles.mt6}>
        <strong>Remaining:</strong> {carbsRemainingMin}–{carbsRemainingMax} g
      </div>
    </div>
  )}

  {fatMin && fatMax && (
    <div className={styles.statCard}>
      <div className={styles.statTitle}>🥑 Fat</div>
      <div>
        <strong>Target:</strong> {fatMin}–{fatMax} g/day
      </div>
      <div className={styles.mt6}>
        <strong>Logged today:</strong> {fatLoggedToday} g
      </div>
      <div className={styles.mt6}>
        <strong>Remaining:</strong> {fatRemainingMin}–{fatRemainingMax} g
      </div>
    </div>
  )}

  {caloriesMin && caloriesMax && (
    <div className={styles.statCard}>
      <div className={styles.statTitle}>🔥 Calories</div>
      <div>
        <strong>Target:</strong> {caloriesMin}–{caloriesMax} cal/day
      </div>
      <div className={styles.mt6}>
        <strong>Logged today:</strong> {caloriesLoggedToday} cal
      </div>
      <div className={styles.mt6}>
        <strong>Remaining:</strong> {caloriesRemainingMin}–{caloriesRemainingMax} cal
      </div>
    </div>
  )}

  {/* 💧 Hydration */}
  {hydrationMin && hydrationMax && (
    <div className={styles.statCard}>
      <div className={styles.statTitle}>💧 Hydration</div>
      <div>
        <strong>Goal:</strong> {hydrationMin}–{hydrationMax} mL/day
      </div>
      <div className={styles.mt6}>
        <strong>Logged today:</strong> {hydrationLoggedToday} mL
      </div>
      <div className={styles.mt6}>
        <strong>Remaining:</strong> {hydrationRemainingMin}–{hydrationRemainingMax} mL
      </div>
    </div>
  )}

  {/* 😴 Sleep */}
  <div className={styles.statCard}>
    <div className={styles.statTitle}>😴 Sleep</div>
    <div>
      <strong>Recommended:</strong> {SLEEP_RECOMMENDED.min}–{SLEEP_RECOMMENDED.max} h/night
    </div>

    <div className={`${styles.mt6} ${styles.rowCenterGap8}`}>
      <strong>Average (7d):</strong> {sleepAvgHours7d || 0} h

      {/* if you still need dynamic colors, convert sleepColor to classes later */}
      <span
  className={`${styles.sleepBadge} ${sleepBadgeClass}`}
  title={
    sleepColor === 'green'
      ? 'Within recommended range'
      : sleepColor === 'yellow'
      ? 'Borderline—keep an eye on it'
      : 'Outside healthy range'
  }
>
  {sleepColor}
</span>
    </div>

    <div className={`${styles.mt8} ${styles.sourceRow}`}>
      <strong>Source:</strong>{' '}
      <button
        type="button"
        onClick={() =>
          openExternal('https://www.sleepfoundation.org/how-sleep-works/how-much-sleep-do-we-really-need')
        }
        className={styles.linkButton}
        aria-label="Sleep Foundation: Recommended hours (opens external website)"
        title="Sleep Foundation — Recommended hours"
      >
        Sleep Foundation — Recommended hours
      </button>
    </div>

    <div className={styles.mt6}>
      <strong>Logged nights:</strong> {sleepLoggedNights7d}/7
    </div>
  </div>

  {/* 🏃 Exercise */}
  <div className={styles.statCard}>
    <div className={styles.statTitle}>🏃 Exercise</div>
    <div>
      <strong>Steps today:</strong> {(exerciseHealthSummary?.steps ?? 0).toLocaleString()}
    </div>
    <div className={styles.mt6}>
      <strong>Exercise:</strong> {Math.round(exerciseHealthSummary?.exerciseMinutes ?? 0)} min
    </div>
    <div className={styles.mt6}>
      <strong>Move:</strong>{' '}
      {Math.round(exerciseHealthSummary?.activeEnergyKcal ?? 0).toLocaleString()} kcal
    </div>
    {exerciseHealthSummary?.synced_at && (
      <div className={`${styles.mt6} ${styles.mutedSmall}`}>
        Last sync:{' '}
        {new Date(exerciseHealthSummary.synced_at).toLocaleString([], {
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>
    )}
    <IonButton
      className="custom-button"
      expand="block"
      onClick={() => void syncExerciseAppleHealth()}
      disabled={exerciseHealthSyncing}
    >
      {exerciseHealthSyncing ? 'Syncing Apple Health...' : 'Sync Apple Health'}
    </IonButton>
    {exerciseHealthMessage && (
      <div className={`${styles.mt6} ${styles.mutedSmall}`}>{exerciseHealthMessage}</div>
    )}
  </div>
</div>

<div className={styles.photoBox}>
  <div className={styles.photoSection}>
    {profilePhoto && previewUrl ? (
      <img
        src={previewUrl}
        alt="Profile Preview"
        className={styles.photo}
        onError={handleImgError}
        width={110}
        height={110}
      />
    ) : user?.profile_photo ? (
      !brokenImage && user.profile_photo.startsWith('data:') ? (
        <img
          src={user.profile_photo}
          alt="Profile"
          className={styles.photo}
          onError={handleImgError}
          width={96}
          height={96}
        />
      ) : (
        <div className={styles.placeholder}>Upload Photo</div>
      )
    ) : (
      <div className={styles.placeholder}>Upload Photo</div>
    )}

    <input
      aria-label="Choose photo from library"
      ref={fileRefLibrary}
      id="photoInputLibrary"
      type="file"
      accept="image/*"
      onChange={handlePhotoChange}
      hidden
    />
    <input
      aria-label="Take photo with camera"
      ref={fileRefCamera}
      id="photoInputCamera"
      type="file"
      accept="image/*"
      onChange={handlePhotoChange}
      hidden
    />
  </div>

  {/* Controls grid */}
  <div className={styles.controlsGrid}>
    <button
      type="button"
      className={`${styles.button} ${styles.secondaryButton}`}
      onClick={() => fileRefLibrary.current?.click()}
      aria-label="Select photo from library"
      title="Library"
    >
      Library
    </button>

    <button
      type="button"
      className={styles.button}
      onClick={handleTakePhoto}
      disabled={isCapturing}
      aria-label="Take photo with camera"
      title="Take Photo"
    >
      {isCapturing ? 'Opening…' : 'Take Photo'}
    </button>

    <button
      type="button"
      className={`${styles.button} ${styles.dangerOutline}`}
      onClick={() => setConfirmDeleteOpen(true)}
      disabled={deleting}
      aria-label="Delete account and all local data"
      title="Delete Account & Data"
    >
      {deleting ? 'Deleting…' : 'Delete Account & Data'}
    </button>

    <div aria-hidden="true" />

    <IonAlert
      isOpen={confirmDeleteOpen}
      onDidDismiss={() => setConfirmDeleteOpen(false)}
      header="Delete account?"
      message="This permanently deletes your account and all data stored on this device. This cannot be undone."
      buttons={[
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive', handler: handleDeleteAccount },
      ]}
    />
  </div>

  {bioResetSupported && (
    <button
      type="button"
      className={`${styles.button} ${styles.secondaryButton} ${styles.resetFaceIdBtn}`}
      onClick={handleResetFaceID}
      aria-label="Reset Face ID credentials"
      title="Reset Face ID Credentials"
    >
      Reset Face ID Credentials
    </button>
  )}
</div>

<div className={styles.fastingBox}>
  <label>Fasting Schedule</label>
  <select
    value={form.fasting_schedule}
    onChange={(e) => setForm({ ...form, fasting_schedule: e.target.value })}
    className={styles.input}
    aria-label="Fasting schedule"
    title="Fasting schedule"
  >
    <option value="">Select Fasting Window</option>
    <option value="12:12">12:12 (Standard)</option>
    <option value="14:10">14:10</option>
    <option value="16:8">16:8 (Popular)</option>
    <option value="18:6">18:6</option>
    <option value="20:4">20:4</option>
    <option value="23:1">23:1 (OMAD)</option>
  </select>

  <label>Fasting Start Time</label>
  <input
    type="time"
    value={safeHHMM(form.fasting_start)}
    onChange={(e) => setForm({ ...form, fasting_start: e.target.value })}
    className={styles.input}
    aria-label="Fasting start time"
    title="Fasting start time"
  />
</div>

        </div>

       <label className={styles.strongLabel} id="emailLoginLabel">
  EMAIL / Login Name
</label>

<input
  value={form.email}
  disabled
  className={styles.input}
  aria-label="Email login name"
  title="Email login name"
/>

<br />
<br />

<select
  name="timezone"
  disabled={tzSource === 'device'}
  value={form.timezone}
  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
  className={styles.input}
  aria-label="Timezone"
  title="Timezone"
>
  {timeZones
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((z) => (
      <option key={z.name} value={z.name}>
        {z.name}
      </option>
    ))}
</select>

<p>
  <label className="inline-flex items-center gap-1 text-sm" htmlFor="tzDeviceCheckbox">
    <input
      id="tzDeviceCheckbox"
      type="checkbox"
      className="rounded border-gray-300"
      checked={tzSource === 'device'}
      onChange={(e) => setTzSource(e.target.checked ? 'device' : 'manual')}
      aria-label="Use device timezone"
      title="Use device timezone"
    />
    Use TimeZone current location
  </label>
</p>

<p>
  <strong>{effectiveTimezone}</strong> ({tzSource === 'device' ? 'device' : 'manual'}).
</p>

<br />
<br />

<label className={styles.strongLabel} id="firstNameLabel">
  First Name
</label>
<input
  value={form.first_name}
  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
  className={styles.input}
  aria-label="First name"
  title="First name"
/>

<br />
<br />

<label className={styles.strongLabel} id="lastNameLabel">
  Last Name
</label>
<input
  value={form.last_name}
  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
  className={styles.input}
  aria-label="Last name"
  title="Last name"
/>

<br />
<br />

<label className={styles.strongLabel} id="medicationNameLabel">
  Primary Medication or Peptide
</label>
<select
  value={form.medication_name}
  onChange={(e) => setForm({ ...form, medication_name: e.target.value, medication_dose: '' })}
  className={styles.input}
  aria-label="Current medication"
  title="Current medication"
>
  <option value="">Select primary protocol</option>
  {MEDICATION_OPTIONS.map((option) => (
    <option key={option} value={option}>
      {option}
    </option>
  ))}
</select>

<br />
<br />

<label className={styles.strongLabel}>
  How do you take it?
</label>
<div className={styles.protocolRhythmGrid} role="radiogroup" aria-label="Primary protocol rhythm">
  <button
    type="button"
    className={selectedProtocolIsWeekly ? styles.protocolRhythmActive : ''}
    onClick={() => {
      setProfileProtocolRhythm('weekly_injection');
      setForm((prev) => ({
        ...prev,
        injection_day: prev.injection_day || 'Mon',
        injection_time: prev.injection_time || '08:00',
      }));
    }}
    role="radio"
    aria-checked={selectedProtocolIsWeekly}
  >
    <strong>Weekly injection</strong>
    <span>Uses injection day and time as the weekly anchor.</span>
  </button>
  <button
    type="button"
    className={selectedProtocolIsDaily ? styles.protocolRhythmActive : ''}
    onClick={() => {
      setProfileProtocolRhythm('daily_pill');
      setForm((prev) => ({
        ...prev,
        injection_day: '',
        injection_time: prev.injection_time || '08:00',
      }));
    }}
    role="radio"
    aria-checked={selectedProtocolIsDaily}
  >
    <strong>Daily pill</strong>
    <span>Uses dose time for 24-hour effectiveness and Monday-Sunday reviews.</span>
  </button>
</div>

<br />
<br />

<label className={styles.strongLabel} id="medicationDoseLabel">
  Dose Label
</label>
{visibleMedicationDoseOptions.length > 0 ? (
  <select
    value={form.medication_dose}
    onChange={(e) => setForm({ ...form, medication_dose: e.target.value })}
    className={styles.input}
    disabled={!form.medication_name}
    aria-label="Dose label"
    title="Dose label"
  >
    <option value="">Select Dose</option>
    {visibleMedicationDoseOptions.map((dose) => (
      <option key={dose} value={dose}>
        {dose}
      </option>
    ))}
  </select>
) : (
  <input
    value={form.medication_dose}
    onChange={(e) => setForm({ ...form, medication_dose: e.target.value })}
    className={styles.input}
    disabled={!form.medication_name}
    placeholder="As directed"
    aria-label="Dose label"
    title="Dose label"
  />
)}

<br />
<br />

{selectedProtocolIsDaily ? (
  <>
    <label className={styles.strongLabel}>Review Week</label>
    <input
      value="Monday to Sunday"
      className={styles.input}
      disabled
      aria-label="Daily pill review week"
      title="Daily pill review week"
    />
    <p className={styles.mutedSmall}>
      Daily pill protocols use your usual daily dose time and a Monday-Sunday review week.
    </p>
    <br />
  </>
) : (
  <>
    <label className={styles.strongLabel} id="injectionDayLabel">
      Injection Day / Once Weekly
    </label>
    <select
      value={form.injection_day}
      onChange={(e) => setForm({ ...form, injection_day: e.target.value })}
      className={styles.input}
      aria-label="Injection day"
      title="Injection day"
      disabled={!selectedProtocolIsWeekly}
    >
      <option value="">Select Day</option>
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dow) => (
        <option key={dow} value={dow}>
          {dow}
        </option>
      ))}
    </select>

    <br />
    <br />
  </>
)}

<label className={styles.strongLabel} id="injectionTimeLabel">
  {selectedProtocolIsDaily ? 'Daily Pill Time' : 'Injection Time'}
</label>
<input
  type="time"
  step={900}
  value={safeHHMM(form.injection_time)}
  onChange={(e) => setForm({ ...form, injection_time: e.target.value })}
  className={styles.input}
  aria-label={selectedProtocolIsDaily ? 'Daily pill time' : 'Injection time'}
  title={selectedProtocolIsDaily ? 'Daily pill time' : 'Injection time'}
/>

<button onClick={handleSubmit} disabled={isSubmitting} className={styles.button}>
  {isSubmitting ? 'Saving...' : 'Save Profile'}
</button>

{showToast && <p className={styles.success}>Profile saved successfully!</p>}

      </div>
     
    </div>
  );

  // Choose branch
  let content: React.ReactNode;
  if (authLoading) {
    dlog.debug('render: branch → loading');
    content = loadingView;
  } else if (!user) {
    dlog.debug('render: branch → no user');
    content = noUserView;
  } else {
    dlog.debug('render: branch → main UI');
    content = mainUIView;
  }

  // Render with guard
 
    dlog.debug('render: start', {
      authLoading,
      hasUser: !!user,
      tzSource,
      deviceTimezone,
      effectiveTimezone,
      height,
      weight,
      bmi: safeBmi,


   });

  return (
    <IonPage>
      <TopNav showWhenAnon />
      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.profileContainer}>
        {content}
        </div>
      </IonContent>
      <BottomNav showWhenAnon={false} />
    </IonPage>
  );
  
};

export default Profile;
