import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IonButton, IonContent, IonPage, useIonRouter, useIonViewWillLeave } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import {
  BellPlus,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  MessageCircleHeart,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react';
import TopNav from '@/context/TopNav';
import BottomNav from '@/context/BottomNav';
import { useAuth } from '@/context/useAuth';
import {
  coachCategories,
  coachLibrary,
  type CoachCategory,
  type CoachEntry,
  type CoachReminderSuggestion,
} from '@/data/coachLibrary';
import {
  feetInchesToCm,
  getCoachProfile,
  hasCoachCheckinForDay,
  insertCoachCheckin,
  patchCoachProfile,
  stonesPoundsToKg,
  type CoachCheckinFrequency,
  type CoachProfile,
  type HeightUnit,
  type WeightUnit,
} from '@/db/CoachRepository';
import { insertHealthLog } from '@/db/HealthRepository';
import { upsertLocalAccount } from '@/db/LocalAccountRepository';
import {
  createProtocol,
  getPrimaryProtocol,
  logProtocolEvent,
  type Protocol,
} from '@/db/ProtocolRepository';
import { setFastingPlan, setInjectionSchedule, type WeekdayFull } from '@/db/SettingsRepository';
import {
  getProtocolPreset,
  PROTOCOL_PRESETS,
  type ProtocolPreset,
} from '@/lib/protocolCatalog';
import { getSetupStatus, type SetupStatus } from '@/lib/setupStatus';
import { getUserByEmail, markUserAsLoggedIn, registerLocalUser } from '@/services/localAuth';
import { hashPassword } from '@/utils/password';
import { logger } from '@/utils/logger';
import type { CelebrationContext } from '@/types/celebration';
import styles from './Coach.module.css';

type ChatMessage = Readonly<{
  id: string;
  role: 'user' | 'coach';
  text: string;
  entry?: CoachEntry;
  reminder?: CoachReminderSuggestion;
  related?: readonly CoachEntry[];
}>;

const starterQuestions = [
  'What can I eat when nausea shows up?',
  'I missed my routine. What now?',
  'How do I handle emotional eating?',
  'What should I review each week?',
  'Can you help me meal prep?',
  'What should I track for side effects?',
] as const;

const setupSteps = [
  'first_name',
  'account',
  'units',
  'height',
  'current_weight',
  'start_weight',
  'goal_weight',
  'glp1_status',
  'medication_name',
  'fasting_schedule',
  'injection_schedule',
  'main_reason',
  'biggest_challenge',
  'dob',
  'address',
  'checkin_frequency',
  'monthly_anchor',
  'finish',
] as const;

type SetupStep = (typeof setupSteps)[number];

const statusOptions = [
  { value: 'just_starting', label: 'Just starting' },
  { value: 'under_1_month', label: 'Less than 1 month' },
  { value: '1_3_months', label: '1-3 months' },
  { value: '3_6_months', label: '3-6 months' },
  { value: 'over_6_months', label: 'More than 6 months' },
] as const;

const challengeOptions = [
  'Nausea',
  'Constipation',
  'Emotional eating',
  'Cravings',
  'Low protein',
  'Low hydration',
  'Fatigue',
  'Poor sleep',
  'Motivation',
] as const;

const checkinFrequencyOptions: Array<{ value: CoachCheckinFrequency; label: string }> = [
  { value: 'morning_evening', label: 'Morning + evening' },
  { value: 'morning', label: 'Morning only' },
  { value: 'evening', label: 'Evening only' },
  { value: 'flexible', label: 'Flexible reminders' },
  { value: 'off', label: 'Not now' },
];

const medicationOptions = [
  'Semaglutide / Ozempic / Wegovy',
  'Tirzepatide / Mounjaro / Zepbound',
  'Liraglutide / Saxenda',
  'Ozempic',
  'Wegovy',
  'Mounjaro',
  'Zepbound',
  'Saxenda',
  'Other peptide',
] as const;

const weekdayOptions: WeekdayFull[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const primaryProtocolPresetIds = ['semaglutide', 'tirzepatide', 'liraglutide', 'daily-glp1-pill'] as const;

function medicationFamily(name: string): 'semaglutide' | 'tirzepatide' | 'liraglutide' | null {
  const normalized = name.trim().toLowerCase();
  if (normalized.includes('semaglutide') || normalized.includes('ozempic') || normalized.includes('wegovy')) return 'semaglutide';
  if (normalized.includes('tirzepatide') || normalized.includes('mounjaro') || normalized.includes('zepbound')) return 'tirzepatide';
  if (normalized.includes('liraglutide') || normalized.includes('saxenda')) return 'liraglutide';
  return null;
}

function doseOptionsForMedication(name: string): string[] {
  switch (medicationFamily(name)) {
    case 'semaglutide':
      return ['0.25 mg', '0.5 mg', '1 mg', '1.7 mg', '2 mg', '2.4 mg'];
    case 'tirzepatide':
      return ['2.5 mg', '5 mg', '7.5 mg', '10 mg', '12.5 mg', '15 mg'];
    case 'liraglutide':
      return ['0.6 mg', '1.2 mg', '1.8 mg', '2.4 mg', '3 mg'];
    default:
      return [];
  }
}

const stopWords = new Set([
  'a',
  'about',
  'and',
  'are',
  'can',
  'do',
  'for',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'should',
  'the',
  'to',
  'what',
  'when',
  'with',
]);

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ');
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !stopWords.has(term));
}

function scoreEntry(query: string, entry: CoachEntry): number {
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query);
  const questionTokens = new Set(tokenize(entry.question));
  const answerTokens = new Set(tokenize(entry.answer));

  let score = 0;
  for (const term of queryTokens) {
    if (questionTokens.has(term)) score += 4;
    if (answerTokens.has(term)) score += 1;
  }

  for (const keyword of entry.keywords) {
    const normalizedKeyword = normalizeText(keyword).trim();
    if (!normalizedKeyword) continue;
    if (normalizedQuery.includes(normalizedKeyword)) score += normalizedKeyword.includes(' ') ? 10 : 6;
  }

  if (normalizeText(entry.question).includes(normalizedQuery.trim()) && normalizedQuery.trim().length > 4) {
    score += 10;
  }

  return score;
}

function findMatches(query: string): readonly CoachEntry[] {
  const ranked = coachLibrary
    .map((entry) => ({ entry, score: scoreEntry(query, entry) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return [];
  return ranked.slice(0, 4).map((item) => item.entry);
}

function buildCoachText(entry: CoachEntry): string {
  return `${entry.answer}\n\nThis is general wellness guidance, not medical advice. Medication, dosing, severe symptoms, or urgent concerns should go to your clinician.`;
}

function createCoachMessage(entry: CoachEntry, related: readonly CoachEntry[] = []): ChatMessage {
  return {
    id: `coach-${Date.now()}-${entry.id}`,
    role: 'coach',
    text: buildCoachText(entry),
    entry,
    reminder: entry.reminder,
    related,
  };
}

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const introMessage: ChatMessage = {
  id: 'coach-intro',
  role: 'coach',
  text:
    'Hi, I’m your GLP-1 Coach. I’m here for the day-to-day bit: food ideas, gentle routines, side-effect tracking, missed days, eating out, emotional eating, and getting back on track without beating yourself up. I can’t diagnose, prescribe, or change your dose, but I can help you feel more prepared and less on your own.',
};

const Coach: React.FC = () => {
  const router = useIonRouter();
  const history = useHistory();
  const { user, refreshUser, isPro } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([introMessage]);
  const [latestQuestionId, setLatestQuestionId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [activeCategory, setActiveCategory] = useState<CoachCategory | 'All'>('All');
  const [isResponding, setIsResponding] = useState(false);
  const [coachProfile, setCoachProfile] = useState<CoachProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [coachUserId, setCoachUserId] = useState<string | null>(null);
  const [setupIndex, setSetupIndex] = useState(0);
  const [setupDraft, setSetupDraft] = useState('');
  const [setupAuxDraft, setSetupAuxDraft] = useState('');
  const [accountConfirmDraft, setAccountConfirmDraft] = useState('');
  const [accountPasswordVisible, setAccountPasswordVisible] = useState(false);
  const [accountPromptOpen, setAccountPromptOpen] = useState(false);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [setupStatusLoading, setSetupStatusLoading] = useState(true);
  const [primaryProtocol, setPrimaryProtocol] = useState<Protocol | null>(null);
  const [protocolPresetId, setProtocolPresetId] = useState<string>('semaglutide');
  const [protocolDose, setProtocolDose] = useState<string>('');
  const [customProtocolDose, setCustomProtocolDose] = useState<string>('');
  const [protocolDoseTime, setProtocolDoseTime] = useState<string>('08:00');
  const [protocolAnchorDay, setProtocolAnchorDay] = useState<WeekdayFull>('Monday');
  const [protocolTakenToday, setProtocolTakenToday] = useState(false);
  const [protocolSaving, setProtocolSaving] = useState(false);
  const [protocolSetupMessage, setProtocolSetupMessage] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [heightUnit, setHeightUnit] = useState<HeightUnit>('cm');
  const [checkinMood, setCheckinMood] = useState<number | null>(null);
  const [checkinEnergy, setCheckinEnergy] = useState<number | null>(null);
  const [checkinAppetite, setCheckinAppetite] = useState<number | null>(null);
  const [checkinWeightDraft, setCheckinWeightDraft] = useState('');
  const [checkinWeightAuxDraft, setCheckinWeightAuxDraft] = useState('');
  const [checkinSaving, setCheckinSaving] = useState(false);
  const [checkedInToday, setCheckedInToday] = useState(false);
  const [addingExtraCheckin, setAddingExtraCheckin] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseLockRef = useRef(false);
  const activeSetupStep: SetupStep = setupSteps[setupIndex] ?? 'finish';
  const setupComplete = Boolean(coachProfile?.coach_onboarding_completed_at);
  const hasSavedLocalAccount = Boolean(user?.email && !user.email.endsWith('@local.ourglp1'));
  const needsLocalAccount = !hasSavedLocalAccount;
  const accountEmailValid = /\S+@\S+\.\S+/.test(setupDraft.trim());
  const accountPasswordValid = setupAuxDraft.length >= 8;
  const accountPasswordsMatch = setupAuxDraft === accountConfirmDraft && accountConfirmDraft.length > 0;
  const canCreateAccount = accountEmailValid && accountPasswordValid && accountPasswordsMatch;
  const selectedProtocolPreset: ProtocolPreset = getProtocolPreset(protocolPresetId);
  const selectedProtocolDose = protocolDose === 'Other' ? customProtocolDose.trim() : protocolDose.trim();
  const canSavePrimaryProtocol = Boolean(selectedProtocolDose && protocolDoseTime);

  const isSetupStepSatisfied = useCallback((step: SetupStep): boolean => {
    if (!coachProfile && step !== 'account') return false;

    switch (step) {
      case 'first_name':
        return Boolean(coachProfile?.first_name || user?.first_name);
      case 'account':
        return hasSavedLocalAccount;
      case 'units':
        return Boolean(coachProfile?.height || coachProfile?.weight);
      case 'height':
        return Boolean(coachProfile?.height);
      case 'current_weight':
        return Boolean(coachProfile?.weight);
      case 'start_weight':
      case 'goal_weight':
      case 'main_reason':
      case 'biggest_challenge':
      case 'dob':
      case 'address':
        return true;
      case 'glp1_status':
        return Boolean(coachProfile?.glp1_status);
      case 'medication_name':
        return Boolean(coachProfile?.medication_name);
      case 'fasting_schedule':
        return Boolean(coachProfile?.fasting_schedule);
      case 'injection_schedule':
        return Boolean(coachProfile?.injection_day && coachProfile?.injection_time);
      case 'checkin_frequency':
        return Boolean(coachProfile?.coach_checkin_frequency);
      case 'monthly_anchor':
        return Boolean(coachProfile?.monthly_anchor_day);
      case 'finish':
        return false;
      default:
        return false;
    }
  }, [coachProfile, hasSavedLocalAccount, user?.first_name]);

  const resetCoach = (): void => {
    if (replyTimerRef.current) {
      clearTimeout(replyTimerRef.current);
      replyTimerRef.current = null;
    }
    if (questionHighlightTimerRef.current) {
      clearTimeout(questionHighlightTimerRef.current);
      questionHighlightTimerRef.current = null;
    }
    setMessages([introMessage]);
    setLatestQuestionId(null);
    setDraft('');
    setActiveCategory('All');
    setIsResponding(false);
    responseLockRef.current = false;
  };

  useIonViewWillLeave(() => {
    resetCoach();
  });

  useEffect(() => {
    return () => {
      if (replyTimerRef.current) clearTimeout(replyTimerRef.current);
      if (questionHighlightTimerRef.current) clearTimeout(questionHighlightTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setCoachUserId(null);
      setProfileLoading(false);
      setPrimaryProtocol(null);
      return;
    }

    setCoachUserId(user.id);
    setProfileLoading(true);
    void getCoachProfile(user.id)
      .then((profile) => {
        if (cancelled) return;
        setCoachProfile(profile);
        setWeightUnit(profile.weight_unit);
        setHeightUnit(profile.height_unit);
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const refreshSetupStatus = useCallback(async (): Promise<void> => {
    setSetupStatusLoading(true);
    try {
      const status = await getSetupStatus(user);
      setSetupStatus(status);
      setPrimaryProtocol(status.primaryProtocol);
    } finally {
      setSetupStatusLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshSetupStatus();
  }, [refreshSetupStatus]);

  useEffect(() => {
    if (profileLoading || setupComplete || activeSetupStep === 'finish') return;
    if (!isSetupStepSatisfied(activeSetupStep)) return;

    setSetupDraft('');
    setSetupAuxDraft('');
    setSetupIndex((prev) => Math.min(prev + 1, setupSteps.length - 1));
  }, [activeSetupStep, profileLoading, setupComplete, isSetupStepSatisfied]);

  const categoryEntries = useMemo(
    () =>
      activeCategory === 'All'
        ? coachLibrary.slice(0, 12)
        : coachLibrary.filter((entry) => entry.category === activeCategory),
    [activeCategory]
  );

  const sendQuestion = (rawQuestion: string): void => {
    const question = rawQuestion.trim();
    if (!question || responseLockRef.current) return;
    responseLockRef.current = true;
    const userMessageId = `user-${Date.now()}`;

    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      text: question,
    };

    const matches = findMatches(question);
    const coachMessage: ChatMessage =
      matches[0]
        ? createCoachMessage(matches[0], matches.slice(1))
            : {
            id: `coach-fallback-${Date.now()}`,
            role: 'coach',
            text:
              'I don’t have a confident answer for that one yet. Try asking about nausea, constipation, protein, hydration, injection day, missed routines, weekly reviews, emotional eating, meal prep, eating out, or side-effect tracking. If it feels medical, worrying, severe, or unusual for you, it’s one for your clinician.',
            related: coachLibrary.slice(0, 4),
          };

    setMessages((prev) => [...prev, userMessage]);
    setLatestQuestionId(userMessageId);
    if (questionHighlightTimerRef.current) clearTimeout(questionHighlightTimerRef.current);
    questionHighlightTimerRef.current = setTimeout(() => {
      setLatestQuestionId((current) => (current === userMessageId ? null : current));
      questionHighlightTimerRef.current = null;
    }, 2400);
    setDraft('');
    setIsResponding(true);

    replyTimerRef.current = setTimeout(() => {
      setMessages((prev) => [...prev, coachMessage]);
      setIsResponding(false);
      responseLockRef.current = false;
      replyTimerRef.current = null;
    }, 420);
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    sendQuestion(draft);
  };

  const showReminderPreview = (reminder: CoachReminderSuggestion): void => {
    const reminderText = `I can draft that reminder for you: ${reminder.title}. ${reminder.detail} Before anything is saved, you’ll always get a chance to check it and confirm. You stay in control.`;
    if (responseLockRef.current) return;
    responseLockRef.current = true;
    setMessages((prev) => [
      ...prev,
      {
        id: `coach-reminder-${Date.now()}`,
        role: 'coach',
        text: reminderText,
      },
    ]);
    responseLockRef.current = false;
  };

  const deleteQuestionThread = (messageId: string): void => {
    setMessages((prev) => {
      const index = prev.findIndex((message) => message.id === messageId);
      if (index < 0) return prev;

      const nextMessage = prev[index + 1];
      const deleteCount = nextMessage?.role === 'coach' ? 2 : 1;
      return prev.filter((_, itemIndex) => itemIndex < index || itemIndex >= index + deleteCount);
    });
  };

  const ensureCoachUser = async (firstName?: string | null): Promise<string> => {
    if (user?.id) return user.id;
    if (coachUserId) return coachUserId;

    const id = createLocalId();
    const email = `coach-${id}@local.ourglp1`;
    const tz =
      (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';

    await registerLocalUser({
      id,
      email,
      first_name: firstName?.trim() || 'Friend',
      last_name: null,
      timezone: tz,
    });
    await markUserAsLoggedIn(id);
    setCoachUserId(id);
    await refreshUser();
    return id;
  };

  const saveProfilePatch = async (patch: Parameters<typeof patchCoachProfile>[1]): Promise<void> => {
    const userId = await ensureCoachUser(patch.first_name ?? coachProfile?.first_name ?? null);
    const next = await patchCoachProfile(userId, patch);
    setCoachProfile(next);
    setWeightUnit(next.weight_unit);
    setHeightUnit(next.height_unit);
    await refreshUser();
  };

  const nextSetupStep = (): void => {
    setSetupDraft('');
    setSetupAuxDraft('');
    setAccountConfirmDraft('');
    setSetupIndex((prev) => Math.min(prev + 1, setupSteps.length - 1));
  };

  const goToAccountStep = (): void => {
    setAccountPromptOpen(true);
    setSetupDraft(hasSavedLocalAccount ? (user?.email ?? '') : '');
    setSetupAuxDraft('');
    setAccountConfirmDraft('');
    setSetupIndex(setupSteps.indexOf('account'));
  };

  const saveAccountLogin = async (): Promise<void> => {
    const email = setupDraft.trim().toLowerCase();
    const passphrase = setupAuxDraft;
    if (!/\S+@\S+\.\S+/.test(email)) {
      setMessages((prev) => [
        ...prev,
        {
          id: `coach-account-email-${Date.now()}`,
          role: 'coach',
          text: 'Please enter a valid email address so I can save this account on your phone.',
        },
      ]);
      return;
    }
    if (passphrase.length < 8) {
      setMessages((prev) => [
        ...prev,
        {
          id: `coach-account-password-${Date.now()}`,
          role: 'coach',
          text: 'Please use a password of at least 8 characters so you can come back to this account later.',
        },
      ]);
      return;
    }
    if (passphrase !== accountConfirmDraft) {
      setMessages((prev) => [
        ...prev,
        {
          id: `coach-account-password-match-${Date.now()}`,
          role: 'coach',
          text: 'Those two passwords do not match yet. Please check them and try again.',
        },
      ]);
      return;
    }

    const userId = user?.id ?? coachUserId ?? createLocalId();
    const existing = await getUserByEmail(email);
    if (existing?.id && existing.id !== userId) {
      setMessages((prev) => [
        ...prev,
        {
          id: `coach-account-existing-${Date.now()}`,
          role: 'coach',
          text: 'That email already has an account on this phone. Please log in with it, or use a different email for this setup.',
        },
      ]);
      return;
    }

    const passwordHash = await hashPassword(passphrase);
    if (!user?.id && !coachUserId) {
      const tz =
        (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
      await registerLocalUser({
        id: userId,
        email,
        first_name: coachProfile?.first_name ?? null,
        last_name: coachProfile?.last_name ?? null,
        timezone: tz,
      });
    }
    await upsertLocalAccount({
      id: userId,
      email,
      first_name: coachProfile?.first_name ?? null,
      last_name: coachProfile?.last_name ?? null,
      password_hash: passwordHash,
      last_login_at: new Date().toISOString(),
    });
    await markUserAsLoggedIn(userId);
    setCoachUserId(userId);
    await refreshUser();
    setAccountPromptOpen(false);
    setAccountConfirmDraft('');
    setSetupStatus((current) => ({
      hasAccount: true,
      hasPrimaryProtocol: Boolean(current?.hasPrimaryProtocol),
      primaryProtocol: current?.primaryProtocol ?? null,
      complete: Boolean(current?.hasPrimaryProtocol),
      nextStep: current?.hasPrimaryProtocol ? 'complete' : 'protocol',
    }));
    setMessages((prev) => [
      ...prev,
      {
        id: `coach-account-saved-${Date.now()}`,
        role: 'coach',
        text: 'Account saved. Your profile setup is now attached to that email on this phone.',
      },
    ]);
    nextSetupStep();
  };

  const savePrimaryProtocol = async (): Promise<void> => {
    const userId = user?.id ?? coachUserId;
    if (!userId || protocolSaving) return;
    if (!canSavePrimaryProtocol) {
      setProtocolSetupMessage('Choose the medication, dose, and dose time first.');
      return;
    }

    setProtocolSaving(true);
    setProtocolSetupMessage('');
    try {
      const preset = selectedProtocolPreset;
      const isWeekly = preset.cadenceType === 'weekly';
      const reviewAnchorDay = isWeekly ? protocolAnchorDay : 'Monday';
      const anchorDay = isWeekly ? protocolAnchorDay : null;

      await createProtocol({
        userId,
        kind: preset.kind,
        name: preset.name,
        doseLabel: selectedProtocolDose,
        cadenceLabel: preset.defaultCadence,
        routeLabel: preset.routeLabel,
        routeType: preset.routeType,
        cadenceType: preset.cadenceType,
        doseTime: protocolDoseTime,
        anchorDay,
        reviewAnchorDay,
        effectivenessModel: preset.effectivenessModel,
        trackingFocus: preset.trackingFocus,
        notes: preset.note,
        isPrimary: true,
      });

      const createdPrimary = await getPrimaryProtocol(userId);
      if (protocolTakenToday && createdPrimary) {
        await logProtocolEvent(createdPrimary, 'Logged during setup');
      }

      if (isWeekly && anchorDay) {
        await setInjectionSchedule(anchorDay, protocolDoseTime);
      }

      window.dispatchEvent(new Event('protocols:changed'));
      window.dispatchEvent(new Event('profile:saved'));
      await refreshSetupStatus();
      await refreshUser();
      setProtocolSetupMessage('Primary protocol saved. The app can now match your rhythm.');
      router.push('/today', 'forward');
    } catch (error) {
      logger.warn('[Coach] primary protocol setup failed', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setProtocolSetupMessage('Could not save that protocol yet.');
    } finally {
      setProtocolSaving(false);
    }
  };

  const saveSetupText = async (field: 'first_name' | 'medication_name' | 'main_reason' | 'date_of_birth'): Promise<void> => {
    const value = setupDraft.trim();
    if (!value && field === 'first_name') return;
    await saveProfilePatch({ [field]: value || null });
    nextSetupStep();
  };

  const saveUnits = async (nextWeightUnit: WeightUnit, nextHeightUnit: HeightUnit): Promise<void> => {
    setWeightUnit(nextWeightUnit);
    setHeightUnit(nextHeightUnit);
    await saveProfilePatch({ weight_unit: nextWeightUnit, height_unit: nextHeightUnit });
    nextSetupStep();
  };

  const saveHeight = async (): Promise<void> => {
    const primary = Number(setupDraft);
    const secondary = Number(setupAuxDraft);
    const heightCm = heightUnit === 'cm' ? primary : feetInchesToCm(primary, Number.isFinite(secondary) ? secondary : 0);
    if (!Number.isFinite(heightCm) || heightCm <= 0) return;
    await saveProfilePatch({ height: heightCm });
    nextSetupStep();
  };

  const weightFromDraft = (): number | null => {
    const primary = Number(setupDraft);
    const secondary = Number(setupAuxDraft);
    if (!Number.isFinite(primary) || primary <= 0) return null;
    if (weightUnit === 'kg') return Number(primary.toFixed(1));
    return stonesPoundsToKg(primary, Number.isFinite(secondary) ? secondary : 0);
  };

  const weightFromValues = (primaryRaw: string, secondaryRaw: string): number | null => {
    const primary = Number(primaryRaw);
    const secondary = Number(secondaryRaw);
    if (!Number.isFinite(primary) || primary <= 0) return null;
    if (weightUnit === 'kg') return Number(primary.toFixed(1));
    return stonesPoundsToKg(primary, Number.isFinite(secondary) ? secondary : 0);
  };

  const todayLocalYmd = (): string => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const refreshCheckedInToday = useCallback(async (userId: string): Promise<void> => {
    const hasCheckin = await hasCoachCheckinForDay(userId, todayLocalYmd());
    setCheckedInToday(hasCheckin);
    if (!hasCheckin) setAddingExtraCheckin(false);
  }, []);

  useEffect(() => {
    const userId = user?.id ?? coachUserId;
    if (!userId || !setupComplete) {
      setCheckedInToday(false);
      setAddingExtraCheckin(false);
      return;
    }

    void refreshCheckedInToday(userId);
  }, [coachUserId, refreshCheckedInToday, setupComplete, user?.id]);

  const navigateToCelebration = (ctx: CelebrationContext): void => {
    try {
      window.sessionStorage.setItem('lastCelebrationCtx', JSON.stringify(ctx));
    } catch {
      // Navigation still carries state when storage is unavailable.
    }
    history.push('/celebrate', ctx);
  };

  const saveWeightField = async (field: 'weight' | 'start_weight' | 'goal_weight', optional = false): Promise<void> => {
    const kg = weightFromDraft();
    if (kg == null && !optional) return;
    await saveProfilePatch({ [field]: kg });
    nextSetupStep();
  };

  const saveAddress = async (): Promise<void> => {
    const lines = setupDraft.split('\n').map((line) => line.trim()).filter(Boolean);
    await saveProfilePatch({
      address1: lines[0] ?? null,
      address2: lines[1] ?? null,
      city: lines[2] ?? null,
      postcode: setupAuxDraft.trim() || null,
    });
    nextSetupStep();
  };

  const saveInjectionAnchor = async (): Promise<void> => {
    if (!setupDraft || !setupAuxDraft) return;
    const day = setupDraft as WeekdayFull;
    const time = setupAuxDraft;
    await setInjectionSchedule(day, time);
    await saveProfilePatch({ injection_day: day, injection_time: time });
    nextSetupStep();
  };

  const completeSetup = async (): Promise<void> => {
    await saveProfilePatch({ coach_onboarding_completed_at: new Date().toISOString() });
    setSetupIndex(setupSteps.length - 1);
    router.push('/profile', 'forward');
  };

  const saveCheckin = async (): Promise<void> => {
    if (checkinMood == null || checkinEnergy == null || checkinAppetite == null) return;
    setCheckinSaving(true);
    try {
      const userId = await ensureCoachUser(coachProfile?.first_name ?? null);
      await insertCoachCheckin({
        user_id: userId,
        mood_score: checkinMood,
        energy_score: checkinEnergy,
        appetite_score: checkinAppetite,
      });
      setCheckedInToday(true);
      setAddingExtraCheckin(false);

      const previousWeight = coachProfile?.weight ?? null;
      const currentWeight = weightFromValues(checkinWeightDraft, checkinWeightAuxDraft);
      if (currentWeight != null) {
        const recordedAt = new Date().toISOString();
        await insertHealthLog({
          entry_type: 'weight',
          recorded_at: recordedAt,
          data_json: JSON.stringify({ kg: currentWeight, source: 'coach_checkin' }),
        });
        await saveProfilePatch({ weight: currentWeight });
      }

      setCheckinMood(null);
      setCheckinEnergy(null);
      setCheckinAppetite(null);
      setCheckinWeightDraft('');
      setCheckinWeightAuxDraft('');
      setMessages((prev) => [
        ...prev,
        {
          id: `coach-checkin-${Date.now()}`,
          role: 'coach',
          text: currentWeight != null
            ? 'Check-in and weight saved. Tiny details like this help build a clearer picture for you and, if you choose, your clinic review later.'
            : 'Check-in saved. Tiny details like this help build a clearer picture for you and, if you choose, your clinic review later.',
        },
      ]);

      if (previousWeight != null && currentWeight != null && currentWeight < previousWeight) {
        navigateToCelebration({
          metric: 'weight',
          kind: 'single_entry',
          dateYmd: todayLocalYmd(),
          value: currentWeight,
          goal: previousWeight,
        });
        return;
      }

      router.push('/profile', 'forward');
    } finally {
      setCheckinSaving(false);
    }
  };

  const handleProtocolPresetChange = (presetId: string): void => {
    const preset = getProtocolPreset(presetId);
    setProtocolPresetId(presetId);
    setProtocolDose('');
    setCustomProtocolDose('');
    setProtocolDoseTime('08:00');
    setProtocolAnchorDay('Monday');
    setProtocolTakenToday(false);
    setProtocolSetupMessage(preset.cadenceType === 'daily' ? 'Daily routines use Monday-Sunday review weeks by default.' : '');
  };

  if (setupStatusLoading) {
    return (
      <IonPage>
        <TopNav showWhenAnon={false} />
        <IonContent fullscreen className={styles.content}>
          <main className={styles.page}>
            <section className={styles.setupShell} aria-label="Preparing setup">
              <div className={styles.setupHeader}>
                <div>
                  <h2>Preparing setup...</h2>
                  <p>Checking your local account and primary protocol.</p>
                </div>
              </div>
            </section>
          </main>
        </IonContent>
        <BottomNav showWhenAnon={false} />
      </IonPage>
    );
  }

  if (!setupStatus?.complete) {
    const needsAccount = !setupStatus?.hasAccount;
    const needsProtocol = setupStatus?.hasAccount && !setupStatus.hasPrimaryProtocol;
    const doseOptions = selectedProtocolPreset.doseOptions ?? ['Other'];
    const weeklyProtocol = selectedProtocolPreset.cadenceType === 'weekly';

    return (
      <IonPage>
        <TopNav showWhenAnon={false} />
        <IonContent fullscreen className={styles.content}>
          <main className={styles.page}>
            <section className={styles.heroBand}>
              <div className={styles.heroCopy}>
                <div className={styles.eyebrow}>
                  <MessageCircleHeart size={18} />
                  <span>Setup Coach</span>
                </div>
                <h1>Let’s set the app up before you go in.</h1>
                <p>
                  The app needs a local account to keep your private data secure on this phone,
                  and a primary protocol so Today, reminders, and effectiveness match your routine.
                </p>
              </div>
              <div className={styles.heroBadge} aria-hidden="true">
                <ShieldAlert size={26} />
              </div>
            </section>

            <section className={styles.setupShell} aria-label="Required app setup">
              <div className={styles.setupHeader}>
                <div>
                  <h2>Required setup</h2>
                  <p>Complete these two steps to unlock the rest of the app.</p>
                </div>
              </div>

              <div className={styles.setupCard}>
                <h3>1. Create your local account</h3>
                <p>
                  This secures your app on this phone and connects your Coach, Today, Profile,
                  reminders, and tracking data.
                </p>
                {needsAccount ? (
                  <>
                    <input
                      type="email"
                      inputMode="email"
                      value={setupDraft}
                      placeholder="Email"
                      onChange={(event) => setSetupDraft(event.target.value)}
                    />
                    <div className={styles.passwordField}>
                      <input
                        type={accountPasswordVisible ? 'text' : 'password'}
                        value={setupAuxDraft}
                        placeholder="Password, 8+ characters"
                        onChange={(event) => setSetupAuxDraft(event.target.value)}
                      />
                      <button
                        type="button"
                        className={styles.passwordToggle}
                        onClick={() => setAccountPasswordVisible((visible) => !visible)}
                        aria-label={accountPasswordVisible ? 'Hide password' : 'Show password'}
                      >
                        {accountPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <div className={styles.passwordField}>
                      <input
                        type={accountPasswordVisible ? 'text' : 'password'}
                        value={accountConfirmDraft}
                        placeholder="Confirm password"
                        onChange={(event) => setAccountConfirmDraft(event.target.value)}
                      />
                      <button
                        type="button"
                        className={styles.passwordToggle}
                        onClick={() => setAccountPasswordVisible((visible) => !visible)}
                        aria-label={accountPasswordVisible ? 'Hide password' : 'Show password'}
                      >
                        {accountPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {accountConfirmDraft && !accountPasswordsMatch && (
                      <p className={styles.formHint}>Passwords do not match yet.</p>
                    )}
                    <IonButton
                      className={styles.primarySetupAction}
                      onClick={() => void saveAccountLogin()}
                      disabled={!canCreateAccount}
                    >
                      Create account
                    </IonButton>
                  </>
                ) : (
                  <div className={styles.completeNotice}>
                    <CheckCircle2 size={18} />
                    <span>Account created.</span>
                  </div>
                )}
              </div>

              <div className={styles.setupCard}>
                <h3>2. Select your primary protocol</h3>
                <p>
                  This tells the app whether to use a weekly injection rhythm or a daily pill rhythm.
                  Secondary protocols can still be tracked later.
                </p>
                {needsAccount ? (
                  <div className={styles.pendingNotice}>
                    <ShieldAlert size={18} />
                    <span>Create your local account first, then the protocol choices will unlock.</span>
                  </div>
                ) : needsProtocol ? (
                  <>
                    <label className={styles.setupLabel} htmlFor="primaryProtocol">
                      Medication
                    </label>
                    <select
                      id="primaryProtocol"
                      value={protocolPresetId}
                      onChange={(event) => handleProtocolPresetChange(event.target.value)}
                    >
                      {PROTOCOL_PRESETS.filter((preset) =>
                        primaryProtocolPresetIds.some((id) => id === preset.id)
                      ).map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                    </select>

                    <label className={styles.setupLabel} htmlFor="primaryProtocolDose">
                      Dose label
                    </label>
                    <select
                      id="primaryProtocolDose"
                      value={protocolDose}
                      onChange={(event) => setProtocolDose(event.target.value)}
                    >
                      <option value="">Select dose</option>
                      {doseOptions.map((dose) => (
                        <option key={dose} value={dose}>
                          {dose}
                        </option>
                      ))}
                    </select>
                    {protocolDose === 'Other' && (
                      <input
                        value={customProtocolDose}
                        placeholder="Enter dose label"
                        onChange={(event) => setCustomProtocolDose(event.target.value)}
                      />
                    )}

                    <label className={styles.setupLabel} htmlFor="primaryProtocolTime">
                      {weeklyProtocol ? 'Injection time' : 'Daily pill time'}
                    </label>
                    <input
                      id="primaryProtocolTime"
                      type="time"
                      value={protocolDoseTime}
                      onChange={(event) => setProtocolDoseTime(event.target.value)}
                    />

                    {weeklyProtocol ? (
                      <>
                        <label className={styles.setupLabel} htmlFor="primaryProtocolAnchor">
                          Injection day / weekly anchor
                        </label>
                        <select
                          id="primaryProtocolAnchor"
                          value={protocolAnchorDay}
                          onChange={(event) => setProtocolAnchorDay(event.target.value as WeekdayFull)}
                        >
                          {weekdayOptions.map((day) => (
                            <option key={day} value={day}>{day}</option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <p className={styles.formHint}>
                        Daily pill review weeks run Monday-Sunday by default.
                      </p>
                    )}

                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={protocolTakenToday}
                        onChange={(event) => setProtocolTakenToday(event.target.checked)}
                      />
                      <span>I have already taken/logged today’s dose.</span>
                    </label>

                    <IonButton
                      className={styles.primarySetupAction}
                      onClick={() => void savePrimaryProtocol()}
                      disabled={!canSavePrimaryProtocol || protocolSaving}
                    >
                      {protocolSaving ? 'Saving...' : 'Save primary protocol'}
                    </IonButton>
                    {protocolSetupMessage && <p className={styles.formHint}>{protocolSetupMessage}</p>}
                  </>
                ) : (
                  <div className={styles.completeNotice}>
                    <CheckCircle2 size={18} />
                    <span>{primaryProtocol?.name ?? 'Primary protocol'} selected.</span>
                  </div>
                )}
              </div>
            </section>
          </main>
        </IonContent>
        <BottomNav showWhenAnon={false} />
      </IonPage>
    );
  }

  return (
    <IonPage>
      <TopNav showWhenAnon={false} />
      <IonContent fullscreen className={styles.content}>
        <main className={styles.page}>
          <section className={styles.heroBand}>
            <div className={styles.heroCopy}>
              <div className={styles.eyebrow}>
                <MessageCircleHeart size={18} />
                <span>Your GLP-1 Coach</span>
              </div>
              <h1>Small steps. Calm support. No lectures.</h1>
              <p>
                I’ll help you with the everyday moments that make weight loss feel hard:
                what to eat, what to track, how to handle rough days, and when to ask your
                clinic for advice.
              </p>
            </div>
            <div className={styles.heroBadge} aria-hidden="true">
              <Sparkles size={26} />
            </div>
          </section>

          <section className={styles.boundaryGrid} aria-label="Coach boundaries">
            <article className={styles.infoPanel}>
              <div className={styles.panelHeader}>
                <CheckCircle2 size={20} />
                <h2>How I Can Help</h2>
              </div>
              <ul>
                <li>Give practical support for common GLP-1 routines and side effects.</li>
                <li>Help you plan protein, hydration, meals, check-ins, and reset days.</li>
                <li>Suggest gentle next steps when motivation or appetite dips.</li>
                <li>Draft reminders, but only save them after you confirm.</li>
              </ul>
            </article>

            <article className={styles.infoPanel}>
              <div className={styles.panelHeader}>
                <ShieldAlert size={20} />
                <h2>When To Use Your Clinic</h2>
              </div>
              <ul>
                <li>I can’t diagnose symptoms or medical conditions.</li>
                <li>I can’t recommend, change, or interpret medication doses.</li>
                <li>I’m not a replacement for emergency care or your prescriber.</li>
                <li>If something feels severe, unusual, or worrying, contact your clinician.</li>
              </ul>
            </article>
          </section>

          {!isPro && (
            <section className={styles.freeIntroShell} aria-label="Free intro and Pro guidance">
              <div className={styles.freeIntroCopy}>
                <div className={styles.eyebrowDark}>Free intro</div>
                <h2>Pro is the full tracking experience.</h2>
                <p>
                  Free is enough to create your local account, set up your profile, ask common
                  Coach questions, and try quick check-ins. Pro is better if you want to track
                  everything properly: personal plans, fuller history, archives, and clearer
                  reviews for appointments.
                </p>
              </div>
              <div className={styles.freeIntroGrid}>
                <div>
                  <strong>Free</strong>
                  <span>Local account, profile setup, basic Coach guidance, and quick check-ins.</span>
                </div>
                <div>
                  <strong>Pro</strong>
                  <span>Track more, unlock personal plans, save history, keep archives, and build clinic-ready reviews.</span>
                </div>
              </div>
              <div className={styles.actionRow}>
                <IonButton
                  className={styles.primarySetupAction}
                  onClick={() => router.push('/paywall?returnTo=/coach', 'forward')}
                >
                  See Pro options
                </IonButton>
              </div>
            </section>
          )}

          {needsLocalAccount && (
            <section className={styles.accountNotice} aria-label="Account status">
              <div>
                <strong>No saved account yet</strong>
                <p>
                  Adding your name starts a temporary Coach setup on this phone. Create a local
                  account with email and password so Profile, Today, and your setup stay connected.
                </p>
              </div>
              {accountPromptOpen ? (
                <div className={styles.accountNoticeForm}>
                  <input
                    type="email"
                    inputMode="email"
                    value={setupDraft}
                    placeholder="Email"
                    onChange={(event) => setSetupDraft(event.target.value)}
                  />
                  <div className={styles.passwordField}>
                    <input
                      type={accountPasswordVisible ? 'text' : 'password'}
                      value={setupAuxDraft}
                      placeholder="Password, 8+ characters"
                      onChange={(event) => setSetupAuxDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setAccountPasswordVisible((visible) => !visible)}
                      aria-label={accountPasswordVisible ? 'Hide password' : 'Show password'}
                    >
                      {accountPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <div className={styles.passwordField}>
                    <input
                      type={accountPasswordVisible ? 'text' : 'password'}
                      value={accountConfirmDraft}
                      placeholder="Confirm password"
                      onChange={(event) => setAccountConfirmDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setAccountPasswordVisible((visible) => !visible)}
                      aria-label={accountPasswordVisible ? 'Hide password' : 'Show password'}
                    >
                      {accountPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    className={styles.inlinePrimaryButton}
                    onClick={() => void saveAccountLogin()}
                    disabled={!canCreateAccount}
                  >
                    Create account
                  </button>
                </div>
              ) : (
                <button type="button" className={styles.inlinePrimaryButton} onClick={goToAccountStep}>
                  Create account
                </button>
              )}
            </section>
          )}

          {!profileLoading && !setupComplete && (
            <section className={styles.setupShell} aria-label="Coach-led setup">
              <div className={styles.setupHeader}>
                <div>
                  <h2>Let’s get you set up</h2>
                  <p>
                    I’ll ask a few simple questions so the app can support you properly.
                    Your answers stay on this phone, and you can change them later.
                  </p>
                </div>
                <span>{Math.min(setupIndex + 1, setupSteps.length)}/{setupSteps.length}</span>
              </div>

              {activeSetupStep === 'first_name' && (
                <div className={styles.setupCard}>
                  <h3>What should I call you?</h3>
                  <p>This starts setup only. I’ll ask for email and password next to save an account.</p>
                  <input
                    value={setupDraft}
                    placeholder={coachProfile?.first_name ?? 'First name'}
                    onChange={(event) => setSetupDraft(event.target.value)}
                  />
                  <IonButton className={styles.primarySetupAction} onClick={() => void saveSetupText('first_name')}>
                    Save name
                  </IonButton>
                </div>
              )}

              {activeSetupStep === 'account' && (
                <div className={styles.setupCard}>
                  <h3>Create your local account</h3>
                  <p>
                    This saves your Coach setup, Profile, Today, and tracking on this phone.
                    It does not start Pro or charge anything.
                  </p>
                  <input
                    type="email"
                    inputMode="email"
                    value={setupDraft}
                    placeholder="Email / username"
                    onChange={(event) => setSetupDraft(event.target.value)}
                  />
                  <div className={styles.passwordField}>
                    <input
                      type={accountPasswordVisible ? 'text' : 'password'}
                      value={setupAuxDraft}
                      placeholder="Password, 8+ characters"
                      onChange={(event) => setSetupAuxDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setAccountPasswordVisible((visible) => !visible)}
                      aria-label={accountPasswordVisible ? 'Hide password' : 'Show password'}
                    >
                      {accountPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <div className={styles.passwordField}>
                    <input
                      type={accountPasswordVisible ? 'text' : 'password'}
                      value={accountConfirmDraft}
                      placeholder="Confirm password"
                      onChange={(event) => setAccountConfirmDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setAccountPasswordVisible((visible) => !visible)}
                      aria-label={accountPasswordVisible ? 'Hide password' : 'Show password'}
                    >
                      {accountPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {accountConfirmDraft && !accountPasswordsMatch && (
                    <p className={styles.formHint}>Passwords do not match yet.</p>
                  )}
                  <IonButton
                    className={styles.primarySetupAction}
                    onClick={() => void saveAccountLogin()}
                    disabled={!canCreateAccount}
                  >
                    Create account
                  </IonButton>
                  {user?.id && (
                    <button type="button" className={styles.textButton} onClick={nextSetupStep}>
                      Skip for now
                    </button>
                  )}
                </div>
              )}

              {activeSetupStep === 'units' && (
                <div className={styles.setupCard}>
                  <h3>Which measurements feel natural?</h3>
                  <div className={styles.choiceGrid}>
                    <button type="button" onClick={() => void saveUnits('kg', 'cm')}>kg + cm</button>
                    <button type="button" onClick={() => void saveUnits('st-lb', 'ft-in')}>stone/lb + ft/in</button>
                  </div>
                </div>
              )}

              {activeSetupStep === 'height' && (
                <div className={styles.setupCard}>
                  <h3>Your height helps me work out your BMI.</h3>
                  <div className={styles.inlineFields}>
                    <input
                      inputMode="decimal"
                      value={setupDraft}
                      placeholder={heightUnit === 'cm' ? 'Height in cm' : 'Feet'}
                      onChange={(event) => setSetupDraft(event.target.value)}
                    />
                    {heightUnit === 'ft-in' && (
                      <input
                        inputMode="decimal"
                        value={setupAuxDraft}
                        placeholder="Inches"
                        onChange={(event) => setSetupAuxDraft(event.target.value)}
                      />
                    )}
                  </div>
                  <IonButton className={styles.primarySetupAction} onClick={() => void saveHeight()}>
                    Save height
                  </IonButton>
                </div>
              )}

              {activeSetupStep === 'current_weight' && (
                <div className={styles.setupCard}>
                  <h3>What is your current weight?</h3>
                  <div className={styles.inlineFields}>
                    <input
                      inputMode="decimal"
                      value={setupDraft}
                      placeholder={weightUnit === 'kg' ? 'Weight in kg' : 'Stone'}
                      onChange={(event) => setSetupDraft(event.target.value)}
                    />
                    {weightUnit === 'st-lb' && (
                      <input
                        inputMode="decimal"
                        value={setupAuxDraft}
                        placeholder="Pounds"
                        onChange={(event) => setSetupAuxDraft(event.target.value)}
                      />
                    )}
                  </div>
                  <IonButton className={styles.primarySetupAction} onClick={() => void saveWeightField('weight')}>
                    Save current weight
                  </IonButton>
                </div>
              )}

              {activeSetupStep === 'start_weight' && (
                <div className={styles.setupCard}>
                  <h3>Do you know your starting weight?</h3>
                  <p>It helps show progress over time. If you’re not sure, we can leave it for now.</p>
                  <div className={styles.inlineFields}>
                    <input
                      inputMode="decimal"
                      value={setupDraft}
                      placeholder={weightUnit === 'kg' ? 'Start weight in kg' : 'Stone'}
                      onChange={(event) => setSetupDraft(event.target.value)}
                    />
                    {weightUnit === 'st-lb' && (
                      <input
                        inputMode="decimal"
                        value={setupAuxDraft}
                        placeholder="Pounds"
                        onChange={(event) => setSetupAuxDraft(event.target.value)}
                      />
                    )}
                  </div>
                  <div className={styles.actionRow}>
                    <IonButton className={styles.primarySetupAction} onClick={() => void saveWeightField('start_weight', true)}>
                      Save start weight
                    </IonButton>
                    <button type="button" className={styles.textButton} onClick={nextSetupStep}>Add later</button>
                  </div>
                </div>
              )}

              {activeSetupStep === 'goal_weight' && (
                <div className={styles.setupCard}>
                  <h3>Do you have a goal weight?</h3>
                  <p>This is optional. Health, confidence, and consistency matter more than one number.</p>
                  <div className={styles.inlineFields}>
                    <input
                      inputMode="decimal"
                      value={setupDraft}
                      placeholder={weightUnit === 'kg' ? 'Goal weight in kg' : 'Stone'}
                      onChange={(event) => setSetupDraft(event.target.value)}
                    />
                    {weightUnit === 'st-lb' && (
                      <input
                        inputMode="decimal"
                        value={setupAuxDraft}
                        placeholder="Pounds"
                        onChange={(event) => setSetupAuxDraft(event.target.value)}
                      />
                    )}
                  </div>
                  <div className={styles.actionRow}>
                    <IonButton className={styles.primarySetupAction} onClick={() => void saveWeightField('goal_weight', true)}>
                      Save goal
                    </IonButton>
                    <button type="button" className={styles.textButton} onClick={nextSetupStep}>Skip</button>
                  </div>
                </div>
              )}

              {activeSetupStep === 'glp1_status' && (
                <div className={styles.setupCard}>
                  <h3>Where are you right now?</h3>
                  <div className={styles.choiceGrid}>
                    {statusOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          void saveProfilePatch({ glp1_status: option.value }).then(nextSetupStep);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeSetupStep === 'medication_name' && (
                <div className={styles.setupCard}>
                  <h3>Which medication are you using?</h3>
                  <p>This keeps your profile, reminders, and weekly rhythm lined up.</p>
                  <select
                    value={setupDraft}
                    onChange={(event) => setSetupDraft(event.target.value)}
                  >
                    <option value="">Select medication</option>
                    {medicationOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  {doseOptionsForMedication(setupDraft).length > 0 ? (
                    <select
                      value={setupAuxDraft}
                      onChange={(event) => setSetupAuxDraft(event.target.value)}
                    >
                      <option value="">Select dose</option>
                      {doseOptionsForMedication(setupDraft).map((dose) => (
                        <option key={dose} value={dose}>{dose}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={setupAuxDraft}
                      placeholder="Dose label, optional"
                      onChange={(event) => setSetupAuxDraft(event.target.value)}
                    />
                  )}
                  <div className={styles.actionRow}>
                    <IonButton
                      className={styles.primarySetupAction}
                      onClick={() => {
                        void saveProfilePatch({
                          medication_name: setupDraft.trim() || null,
                          medication_dose: setupAuxDraft.trim() || null,
                        }).then(nextSetupStep);
                      }}
                    >
                      Save medication
                    </IonButton>
                    <button type="button" className={styles.textButton} onClick={nextSetupStep}>Add later</button>
                  </div>
                </div>
              )}

              {activeSetupStep === 'fasting_schedule' && (
                <div className={styles.setupCard}>
                  <h3>Fasting schedule</h3>
                  <p>If you use a fasting window, I’ll add it to your daily rhythm.</p>
                  <select value={setupDraft} onChange={(event) => setSetupDraft(event.target.value)}>
                    <option value="">Select fasting window</option>
                    <option value="12:12">12:12</option>
                    <option value="14:10">14:10</option>
                    <option value="16:8">16:8</option>
                    <option value="18:6">18:6</option>
                    <option value="none">No fasting schedule</option>
                  </select>
                  <input
                    type="time"
                    value={setupAuxDraft}
                    onChange={(event) => setSetupAuxDraft(event.target.value)}
                    aria-label="Fasting start time"
                  />
                  <div className={styles.actionRow}>
                    <IonButton
                      className={styles.primarySetupAction}
                      onClick={() => {
                        const schedule = setupDraft || 'none';
                        const start = setupAuxDraft || '20:00';
                        void setFastingPlan(schedule, start)
                          .then(() => saveProfilePatch({ fasting_schedule: schedule, fasting_start: start }))
                          .then(nextSetupStep);
                      }}
                    >
                      Save fasting
                    </IonButton>
                    <button type="button" className={styles.textButton} onClick={nextSetupStep}>Add later</button>
                  </div>
                </div>
              )}

              {activeSetupStep === 'injection_schedule' && (
                <div className={styles.setupCard}>
                  <h3>Injection Day / Once Weekly</h3>
                  <p>
                    Choose the day of the week and usual time your dose starts. This becomes the
                    anchor for Today, reminders, and weekly reviews.
                  </p>
                  <label className={styles.setupLabel} htmlFor="coachInjectionDay">
                    Anchor day of week
                  </label>
                  <select
                    id="coachInjectionDay"
                    value={setupDraft}
                    onChange={(event) => setSetupDraft(event.target.value)}
                  >
                    <option value="">Select day</option>
                    {weekdayOptions.map((day) => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                  <label className={styles.setupLabel} htmlFor="coachInjectionTime">
                    Injection time
                  </label>
                  <input
                    id="coachInjectionTime"
                    type="time"
                    value={setupAuxDraft}
                    onChange={(event) => setSetupAuxDraft(event.target.value)}
                    aria-label="Injection time"
                  />
                  <div className={styles.actionRow}>
                    <IonButton
                      className={styles.primarySetupAction}
                      onClick={() => void saveInjectionAnchor()}
                      disabled={!setupDraft || !setupAuxDraft}
                    >
                      Save injection anchor
                    </IonButton>
                    <button type="button" className={styles.textButton} onClick={nextSetupStep}>Add later</button>
                  </div>
                </div>
              )}

              {activeSetupStep === 'main_reason' && (
                <div className={styles.setupCard}>
                  <h3>What matters most to you right now?</h3>
                  <input
                    value={setupDraft}
                    placeholder="Health, weight, appetite, confidence..."
                    onChange={(event) => setSetupDraft(event.target.value)}
                  />
                  <div className={styles.actionRow}>
                    <IonButton className={styles.primarySetupAction} onClick={() => void saveSetupText('main_reason')}>
                      Save reason
                    </IonButton>
                    <button type="button" className={styles.textButton} onClick={nextSetupStep}>Skip</button>
                  </div>
                </div>
              )}

              {activeSetupStep === 'biggest_challenge' && (
                <div className={styles.setupCard}>
                  <h3>What feels hardest at the moment?</h3>
                  <div className={styles.choiceGrid}>
                    {challengeOptions.map((challenge) => (
                      <button
                        key={challenge}
                        type="button"
                        onClick={() => {
                          void saveProfilePatch({ biggest_challenge: challenge }).then(nextSetupStep);
                        }}
                      >
                        {challenge}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeSetupStep === 'dob' && (
                <div className={styles.setupCard}>
                  <h3>Date of birth</h3>
                  <p>Optional. This is only used if you choose to prepare a clinic report.</p>
                  <input
                    type="date"
                    value={setupDraft}
                    onChange={(event) => setSetupDraft(event.target.value)}
                  />
                  <div className={styles.actionRow}>
                    <IonButton className={styles.primarySetupAction} onClick={() => void saveSetupText('date_of_birth')}>
                      Save DOB
                    </IonButton>
                    <button type="button" className={styles.textButton} onClick={nextSetupStep}>Add later</button>
                  </div>
                </div>
              )}

              {activeSetupStep === 'address' && (
                <div className={styles.setupCard}>
                  <h3>Address for clinic reports</h3>
                  <p>Optional. It stays on this phone unless you choose to share a report.</p>
                  <textarea
                    value={setupDraft}
                    rows={3}
                    placeholder="Address lines"
                    onChange={(event) => setSetupDraft(event.target.value)}
                  />
                  <input
                    value={setupAuxDraft}
                    placeholder="Postcode"
                    onChange={(event) => setSetupAuxDraft(event.target.value)}
                  />
                  <div className={styles.actionRow}>
                    <IonButton className={styles.primarySetupAction} onClick={() => void saveAddress()}>
                      Save address
                    </IonButton>
                    <button type="button" className={styles.textButton} onClick={nextSetupStep}>Add later</button>
                  </div>
                </div>
              )}

              {activeSetupStep === 'checkin_frequency' && (
                <div className={styles.setupCard}>
                  <h3>Would check-ins help?</h3>
                  <p>A quick mood, energy, and appetite check can make your patterns clearer over time.</p>
                  <div className={styles.choiceGrid}>
                    {checkinFrequencyOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          void saveProfilePatch({ coach_checkin_frequency: option.value }).then(nextSetupStep);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeSetupStep === 'monthly_anchor' && (
                <div className={styles.setupCard}>
                  <h3>Monthly medication anchor</h3>
                  <p>
                    Many people manage GLP-1s in monthly packs. Pick a day for your refill,
                    prescription, or review reminder.
                  </p>
                  <input
                    inputMode="numeric"
                    value={setupDraft}
                    placeholder="Day of month, e.g. 1"
                    onChange={(event) => setSetupDraft(event.target.value)}
                  />
                  <div className={styles.actionRow}>
                    <IonButton
                      className={styles.primarySetupAction}
                      onClick={() => {
                        const day = Math.max(1, Math.min(28, Math.round(Number(setupDraft) || 1)));
                        void saveProfilePatch({ monthly_anchor_day: day, monthly_dose_count: 4 }).then(() => void completeSetup());
                      }}
                    >
                      Save monthly anchor
                    </IonButton>
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => {
                        void saveProfilePatch({ monthly_dose_count: 4 }).then(() => void completeSetup());
                      }}
                    >
                      Use default
                    </button>
                  </div>
                </div>
              )}

              {activeSetupStep === 'finish' && (
                <div className={styles.setupCard}>
                  <h3>You’re set up.</h3>
                  <p>Lovely. Now we can keep things simple: small check-ins, steady support, and clearer notes if you need your clinic.</p>
                  <IonButton className={styles.primarySetupAction} onClick={() => void completeSetup()}>
                    Finish setup
                  </IonButton>
                </div>
              )}
            </section>
          )}

          {setupComplete && checkedInToday && !addingExtraCheckin && (
            <section className={styles.checkinShell} aria-label="Daily coach check-in saved">
              <div className={styles.sectionHeader}>
                <div>
                  <h2>Today’s check-in is saved</h2>
                  <p>Nice work. I’ll keep the quick questions tucked away now so the page feels calmer.</p>
                </div>
              </div>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => setAddingExtraCheckin(true)}
              >
                Add another check-in
              </button>
            </section>
          )}

          {setupComplete && (!checkedInToday || addingExtraCheckin) && (
            <section className={styles.checkinShell} aria-label="Daily coach check-in">
              <div className={styles.sectionHeader}>
                <div>
                  <h2>{addingExtraCheckin ? 'Add another check-in' : 'Quick check-in'}</h2>
                  <p>
                    {addingExtraCheckin
                      ? 'Use this if something changed today and you want a fresh note saved.'
                      : 'Three taps. No judgment. Just a clearer picture of how you’re doing.'}
                  </p>
                </div>
              </div>
              <div className={styles.scaleRows}>
                {[
                  { label: 'How are you feeling right now?', value: checkinMood, setter: setCheckinMood },
                  { label: 'Energy right now', value: checkinEnergy, setter: setCheckinEnergy },
                  { label: 'Appetite right now', value: checkinAppetite, setter: setCheckinAppetite },
                ].map((row) => (
                  <div className={styles.scaleRow} key={row.label}>
                    <span>{row.label}</span>
                    <div>
                      {[1, 2, 3, 4, 5].map((score) => (
                        <button
                          key={score}
                          type="button"
                          className={row.value === score ? styles.scoreActive : ''}
                          onClick={() => row.setter(score)}
                        >
                          {score}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.weightCheckinRow}>
                <div>
                  <span>Current weight</span>
                  <small>Optional. If it has moved down, I’ll celebrate the win.</small>
                </div>
                <div className={styles.weightInputs}>
                  <input
                    inputMode="decimal"
                    value={checkinWeightDraft}
                    placeholder={weightUnit === 'kg' ? 'kg' : 'st'}
                    onChange={(event) => setCheckinWeightDraft(event.target.value)}
                    aria-label={weightUnit === 'kg' ? 'Current weight in kg' : 'Current weight in stone'}
                  />
                  {weightUnit === 'st-lb' && (
                    <input
                      inputMode="decimal"
                      value={checkinWeightAuxDraft}
                      placeholder="lb"
                      onChange={(event) => setCheckinWeightAuxDraft(event.target.value)}
                      aria-label="Current weight pounds"
                    />
                  )}
                </div>
              </div>
              <IonButton
                className={styles.primarySetupAction}
                onClick={() => void saveCheckin()}
                disabled={checkinSaving || checkinMood == null || checkinEnergy == null || checkinAppetite == null}
              >
                {checkinSaving ? 'Saving...' : 'Save check-in'}
              </IonButton>
            </section>
          )}

          <section className={styles.chatShell} aria-label="GLP-1 Coach chat">
            <div className={styles.chatHeader}>
              <div>
                <h2>Ask the Coach</h2>
                <p>Ask about food, side effects, routines, motivation, or getting back on track.</p>
              </div>
              <IonButton
                className={styles.secondaryAction}
                fill="outline"
                onClick={() => router.push('/reminders', 'forward')}
              >
                Reminders
                <ChevronRight size={17} />
              </IonButton>
            </div>

            <div className={styles.starterGrid} aria-label="Starter questions">
              {starterQuestions.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => sendQuestion(question)}
                  disabled={isResponding}
                >
                  {question}
                </button>
              ))}
            </div>

            <div className={styles.chatLog} aria-live="polite">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`${styles.message} ${message.role === 'user' ? styles.userMessage : styles.coachMessage} ${
                    message.id === latestQuestionId ? styles.latestUserMessage : ''
                  }`}
                >
                  <div className={styles.messageRole}>
                    <span>{message.role === 'user' ? 'You' : 'Coach'}</span>
                    {message.id === latestQuestionId && <span className={styles.sentBadge}>Question sent</span>}
                    {message.entry && <span>{message.entry.category}</span>}
                    {message.role === 'user' && (
                      <button
                        type="button"
                        className={styles.deleteMessageButton}
                        onClick={() => deleteQuestionThread(message.id)}
                        aria-label="Delete this question and coach answer"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  {message.text.split('\n').map((line) => (
                    <p key={line}>{line}</p>
                  ))}

                  {message.reminder && (
                    <button
                      type="button"
                      className={styles.reminderCard}
                      onClick={() => showReminderPreview(message.reminder as CoachReminderSuggestion)}
                      disabled={isResponding}
                    >
                      <BellPlus size={17} />
                      <span>
                        <strong>{message.reminder.title}</strong>
                        {message.reminder.detail}
                      </span>
                    </button>
                  )}

                  {message.related && message.related.length > 0 && (
                    <div className={styles.relatedQuestions}>
                      {message.related.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => sendQuestion(entry.question)}
                          disabled={isResponding}
                        >
                          {entry.question}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
              {isResponding && (
                <article className={`${styles.message} ${styles.coachMessage} ${styles.typingMessage}`}>
                  <div className={styles.messageRole}>
                    <span>Coach</span>
                  </div>
                  <div className={styles.typingDots} aria-label="Coach is replying">
                    <i />
                    <i />
                    <i />
                  </div>
                </article>
              )}
            </div>

            <form className={styles.composer} onSubmit={handleSubmit}>
              <textarea
                ref={inputRef}
                value={draft}
                rows={2}
                placeholder="What do you need help with today?"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendQuestion(draft);
                  }
                }}
                disabled={isResponding}
              />
              <IonButton
                className={styles.sendButton}
                type="submit"
                aria-label="Send coach question"
                disabled={isResponding || draft.trim().length === 0}
              >
                <Send size={18} />
              </IonButton>
            </form>
          </section>

          <section className={styles.librarySection} aria-labelledby="coachLibraryTitle">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="coachLibraryTitle">Helpful topics</h2>
                <p>Not sure what to ask? Start with one of these.</p>
              </div>
            </div>

            <div className={styles.categoryScroller} aria-label="Coach categories">
              <button
                type="button"
                  className={activeCategory === 'All' ? styles.categoryActive : ''}
                  onClick={() => setActiveCategory('All')}
                  disabled={isResponding}
                >
                All
              </button>
              {coachCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={activeCategory === category ? styles.categoryActive : ''}
                  onClick={() => setActiveCategory(category)}
                  disabled={isResponding}
                >
                  {category}
                </button>
              ))}
            </div>

            <div className={styles.questionList} role="list">
              {categoryEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => sendQuestion(entry.question)}
                  disabled={isResponding}
                >
                  <span>{entry.question}</span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          </section>
        </main>
      </IonContent>
      <BottomNav showWhenAnon={false} />
    </IonPage>
  );
};

export default Coach;
