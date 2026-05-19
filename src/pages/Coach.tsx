import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IonButton, IonContent, IonPage, useIonRouter, useIonViewWillLeave } from '@ionic/react';
import {
  BellPlus,
  CheckCircle2,
  ChevronRight,
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
  insertCoachCheckin,
  patchCoachProfile,
  stonesPoundsToKg,
  type CoachCheckinFrequency,
  type CoachProfile,
  type HeightUnit,
  type WeightUnit,
} from '@/db/CoachRepository';
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
  'units',
  'height',
  'current_weight',
  'start_weight',
  'goal_weight',
  'glp1_status',
  'medication_name',
  'main_reason',
  'biggest_challenge',
  'dob',
  'address',
  'checkin_frequency',
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

const introMessage: ChatMessage = {
  id: 'coach-intro',
  role: 'coach',
  text:
    'Hi, I am your GLP-1 Coach. I can answer common questions from a curated on-phone guidance library about routines, protein, hydration, side-effect tracking, missed routines, emotional eating, meal prep, eating out, and weekly reviews. I cannot diagnose, prescribe, or change medication dosing.',
};

const Coach: React.FC = () => {
  const router = useIonRouter();
  const { user, refreshUser } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([introMessage]);
  const [draft, setDraft] = useState('');
  const [activeCategory, setActiveCategory] = useState<CoachCategory | 'All'>('All');
  const [isResponding, setIsResponding] = useState(false);
  const [coachProfile, setCoachProfile] = useState<CoachProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [setupIndex, setSetupIndex] = useState(0);
  const [setupDraft, setSetupDraft] = useState('');
  const [setupAuxDraft, setSetupAuxDraft] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [heightUnit, setHeightUnit] = useState<HeightUnit>('cm');
  const [checkinMood, setCheckinMood] = useState<number | null>(null);
  const [checkinEnergy, setCheckinEnergy] = useState<number | null>(null);
  const [checkinAppetite, setCheckinAppetite] = useState<number | null>(null);
  const [checkinSaving, setCheckinSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseLockRef = useRef(false);
  const activeSetupStep: SetupStep = setupSteps[setupIndex] ?? 'finish';
  const setupComplete = Boolean(coachProfile?.coach_onboarding_completed_at);

  const resetCoach = (): void => {
    if (replyTimerRef.current) {
      clearTimeout(replyTimerRef.current);
      replyTimerRef.current = null;
    }
    setMessages([introMessage]);
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
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setProfileLoading(false);
      return;
    }

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

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
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
              'I could not match that to a confident curated answer yet. Try one of the topic buttons below, or ask about nausea, constipation, protein, hydration, injection day, missed routines, weekly review, emotional eating, meal prep, eating out, or side-effect tracking.',
            related: coachLibrary.slice(0, 4),
          };

    setMessages((prev) => [...prev, userMessage]);
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
    const reminderText = `Reminder draft: ${reminder.title}. ${reminder.detail} When reminder creation is wired in, this would open a confirmation card before anything is saved.`;
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

  const saveProfilePatch = async (patch: Parameters<typeof patchCoachProfile>[1]): Promise<void> => {
    if (!user?.id) return;
    const next = await patchCoachProfile(user.id, patch);
    setCoachProfile(next);
    setWeightUnit(next.weight_unit);
    setHeightUnit(next.height_unit);
    await refreshUser();
  };

  const nextSetupStep = (): void => {
    setSetupDraft('');
    setSetupAuxDraft('');
    setSetupIndex((prev) => Math.min(prev + 1, setupSteps.length - 1));
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

  const completeSetup = async (): Promise<void> => {
    await saveProfilePatch({ coach_onboarding_completed_at: new Date().toISOString() });
    setSetupIndex(setupSteps.length - 1);
  };

  const saveCheckin = async (): Promise<void> => {
    if (!user?.id || checkinMood == null || checkinEnergy == null || checkinAppetite == null) return;
    setCheckinSaving(true);
    try {
      await insertCoachCheckin({
        user_id: user.id,
        mood_score: checkinMood,
        energy_score: checkinEnergy,
        appetite_score: checkinAppetite,
      });
      setCheckinMood(null);
      setCheckinEnergy(null);
      setCheckinAppetite(null);
      setMessages((prev) => [
        ...prev,
        {
          id: `coach-checkin-${Date.now()}`,
          role: 'coach',
          text: 'Check-in saved. Tiny details like this help build a clearer picture for you and, if you choose, your clinic review later.',
        },
      ]);
    } finally {
      setCheckinSaving(false);
    }
  };

  return (
    <IonPage>
      <TopNav showWhenAnon={false} />
      <IonContent fullscreen className={styles.content}>
        <main className={styles.page}>
          <section className={styles.heroBand}>
            <div className={styles.heroCopy}>
              <div className={styles.eyebrow}>
                <MessageCircleHeart size={18} />
                <span>Local GLP-1 Coach</span>
              </div>
              <h1>Curated answers that feel conversational.</h1>
              <p>
                This coach works on the phone from 160 built-in guidance answers.
                It can suggest reminder drafts, but actions stay confirmation-first.
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
                <h2>What It Can Do</h2>
              </div>
              <ul>
                <li>Answer common GLP-1 wellness and routine questions.</li>
                <li>Match natural wording to curated coach guidance.</li>
                <li>Suggest follow-up questions and next steps.</li>
                <li>Draft reminders that require approval before saving.</li>
              </ul>
            </article>

            <article className={styles.infoPanel}>
              <div className={styles.panelHeader}>
                <ShieldAlert size={20} />
                <h2>What It Cannot Do</h2>
              </div>
              <ul>
                <li>Diagnose symptoms or medical conditions.</li>
                <li>Change, recommend, or interpret medication dosing.</li>
                <li>Replace emergency care or your prescribing clinician.</li>
                <li>Answer outside the built-in guidance library yet.</li>
              </ul>
            </article>
          </section>

          {!profileLoading && !setupComplete && (
            <section className={styles.setupShell} aria-label="Coach-led setup">
              <div className={styles.setupHeader}>
                <div>
                  <h2>Let’s set up your support profile</h2>
                  <p>
                    I’ll ask a few quick questions and save the answers locally. You can edit
                    everything later in Profile.
                  </p>
                </div>
                <span>{Math.min(setupIndex + 1, setupSteps.length)}/{setupSteps.length}</span>
              </div>

              {activeSetupStep === 'first_name' && (
                <div className={styles.setupCard}>
                  <h3>What should I call you?</h3>
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

              {activeSetupStep === 'units' && (
                <div className={styles.setupCard}>
                  <h3>Which units feel natural?</h3>
                  <div className={styles.choiceGrid}>
                    <button type="button" onClick={() => void saveUnits('kg', 'cm')}>kg + cm</button>
                    <button type="button" onClick={() => void saveUnits('st-lb', 'ft-in')}>stone/lb + ft/in</button>
                  </div>
                </div>
              )}

              {activeSetupStep === 'height' && (
                <div className={styles.setupCard}>
                  <h3>Your height helps calculate BMI.</h3>
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
                  <h3>Do you know your GLP-1 start weight?</h3>
                  <p>This helps with progress charts. You can add it later if you’re not sure.</p>
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
                  <p>Optional. Healthy progress matters more than any single number.</p>
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
                  <h3>Where are you in your GLP-1 journey?</h3>
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
                  <h3>Which GLP-1 medication are you using?</h3>
                  <p>Optional. This can help your clinic-ready summary later.</p>
                  <input
                    value={setupDraft}
                    placeholder="Medication name"
                    onChange={(event) => setSetupDraft(event.target.value)}
                  />
                  <div className={styles.actionRow}>
                    <IonButton className={styles.primarySetupAction} onClick={() => void saveSetupText('medication_name')}>
                      Save medication
                    </IonButton>
                    <button type="button" className={styles.textButton} onClick={nextSetupStep}>Add later</button>
                  </div>
                </div>
              )}

              {activeSetupStep === 'main_reason' && (
                <div className={styles.setupCard}>
                  <h3>What is your main reason for using GLP-1 support?</h3>
                  <input
                    value={setupDraft}
                    placeholder="Weight, health, appetite, confidence..."
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
                  <h3>What feels like your biggest challenge right now?</h3>
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
                  <p>Optional. This is only for reports you choose to share with a clinic.</p>
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
                  <p>Optional. It stays on this device unless you export or share a report.</p>
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
                  <h3>Would you like Coach check-ins?</h3>
                  <p>We’ll start by saving check-ins here. Scheduled notifications can be added next.</p>
                  <div className={styles.choiceGrid}>
                    {checkinFrequencyOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          void saveProfilePatch({ coach_checkin_frequency: option.value }).then(() => void completeSetup());
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeSetupStep === 'finish' && (
                <div className={styles.setupCard}>
                  <h3>You’re set up.</h3>
                  <p>Now the Coach can help with quick check-ins, support questions, and clinic-ready summaries later.</p>
                  <IonButton className={styles.primarySetupAction} onClick={() => void completeSetup()}>
                    Finish setup
                  </IonButton>
                </div>
              )}
            </section>
          )}

          {setupComplete && (
            <section className={styles.checkinShell} aria-label="Daily coach check-in">
              <div className={styles.sectionHeader}>
                <div>
                  <h2>Quick Coach Check-In</h2>
                  <p>Three taps now can make your monthly review much clearer later.</p>
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
                <p>{coachLibrary.length} built-in answers across {coachCategories.length} topics</p>
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
                  className={`${styles.message} ${message.role === 'user' ? styles.userMessage : styles.coachMessage}`}
                >
                  <div className={styles.messageRole}>
                    <span>{message.role === 'user' ? 'You' : 'Coach'}</span>
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
                placeholder="Ask about nausea, protein, missed routines, meal prep..."
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
                <h2 id="coachLibraryTitle">Browse the Library</h2>
                <p>Use this when you want to see exactly what the local coach can answer.</p>
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
