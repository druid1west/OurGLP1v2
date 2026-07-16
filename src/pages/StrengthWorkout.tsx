import React, { useEffect, useMemo, useState } from 'react';
import { IonButton, IonContent, IonPage, IonSpinner, useIonRouter } from '@ionic/react';
import { useLocation } from 'react-router-dom';
import { Activity, ArrowLeft, Check, ChevronRight, Dumbbell, Pause, Play, RefreshCw, ShieldCheck, Timer } from 'lucide-react';
import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';
import { useAuth } from '../context/useAuth';
import { getHealthDailySummaryByDay, initHealthTables, insertExerciseAndEmit } from '../db/HealthRepository';
import { getLatestValidStrengthWorkout, getStrengthWorkout, saveStrengthWorkout, updateStrengthWorkout, type StrengthWorkout } from '../db/StrengthWorkoutRepository';
import { buildStrengthPlan, DEFAULT_STRENGTH_ANSWERS, type StrengthAnswers, type StrengthPlan } from '../lib/strengthTraining';
import { logger } from '../utils/logger';
import styles from './StrengthWorkout.module.css';
import entitlementStyles from './StrengthWorkoutEntitlement.module.css';

type Step = keyof Pick<StrengthAnswers, 'experience' | 'goal' | 'equipment' | 'limitation' | 'duration' | 'frequency'> | 'readiness';
const STEPS: Step[] = ['experience', 'goal', 'equipment', 'limitation', 'duration', 'frequency', 'readiness'];
const OPTIONS: Record<Step, Array<{ value: string | number; label: string; detail?: string }>> = {
  experience: [{ value: 'beginner', label: 'Beginner', detail: 'New or returning' }, { value: 'some', label: 'Some experience' }, { value: 'regular', label: 'Regular lifter' }],
  goal: [{ value: 'preserve', label: 'Preserve muscle' }, { value: 'stronger', label: 'Get stronger' }, { value: 'muscle', label: 'Build muscle' }, { value: 'mobility', label: 'Everyday mobility' }],
  equipment: [{ value: 'none', label: 'No equipment' }, { value: 'bands', label: 'Resistance bands' }, { value: 'dumbbells', label: 'Dumbbells' }, { value: 'gym', label: 'Full gym' }],
  limitation: [{ value: 'none', label: 'No limitations' }, { value: 'knees', label: 'Knees' }, { value: 'back', label: 'Back' }, { value: 'shoulders', label: 'Shoulders' }, { value: 'balance', label: 'Balance' }, { value: 'other', label: 'Something else' }],
  duration: [{ value: 10, label: '10 min' }, { value: 20, label: '20 min' }, { value: 30, label: '30 min' }, { value: 45, label: '45 min' }],
  frequency: [{ value: 1, label: '1 day' }, { value: 2, label: '2 days' }, { value: 3, label: '3 days' }],
  readiness: [{ value: 'low', label: 'Low energy', detail: 'Fewer sets, more rest' }, { value: 'normal', label: 'Normal' }, { value: 'good', label: 'Feeling good' }],
};
const QUESTIONS: Record<Step, string> = {
  experience: 'What is your strength-training experience?', goal: 'What would you most like this to help with?',
  equipment: 'What equipment can you use?', limitation: 'Any movement limitations I should account for?',
  duration: 'How much time do you have?', frequency: 'How many strength days would fit your week?',
  readiness: 'How are your energy and symptoms today?',
};

function localDay(date = new Date()): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function localTime(date: Date): string { return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
function shortDay(date: Date): string { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()] ?? 'Mon'; }
function newId(): string { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `strength-${Date.now()}`; }

const StrengthWorkoutPage: React.FC = () => {
  const router = useIonRouter();
  const location = useLocation();
  const { user, isPro } = useAuth();
  const workoutId = useMemo(() => new URLSearchParams(location.search).get('id'), [location.search]);
  const [loading, setLoading] = useState(Boolean(workoutId));
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<StrengthAnswers>(DEFAULT_STRENGTH_ANSWERS);
  const [plan, setPlan] = useState<StrengthPlan | null>(null);
  const [workout, setWorkout] = useState<StrengthWorkout | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [variation, setVariation] = useState(0);
  const [saving, setSaving] = useState(false);
  const [activity, setActivity] = useState({ steps: 0, minutes: 0 });
  const [starterWorkout, setStarterWorkout] = useState<StrengthWorkout | null>(null);

  useEffect(() => {
    void initHealthTables().then(() => getHealthDailySummaryByDay(localDay())).then((summary) => {
      setActivity({ steps: Math.round(summary?.steps ?? 0), minutes: Math.round(summary?.exerciseMinutes ?? 0) });
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!workoutId) return;
    setLoading(true);
    void getStrengthWorkout(workoutId).then((row) => {
      if (!row) return;
      setWorkout(row); setAnswers(row.answers); setPlan(row.plan); setCompleted(new Set(row.completedExerciseIds));
    }).finally(() => setLoading(false));
  }, [workoutId]);

  useEffect(() => {
    if (workoutId || !user?.id || isPro) {
      setStarterWorkout(null);
      return;
    }
    setLoading(true);
    void getLatestValidStrengthWorkout(user.id)
      .then(setStarterWorkout)
      .catch(() => setStarterWorkout(null))
      .finally(() => setLoading(false));
  }, [isPro, user?.id, workoutId]);

  const choose = (value: string | number): void => {
    const step = STEPS[stepIndex];
    const next = { ...answers, [step]: value } as StrengthAnswers;
    setAnswers(next);
    if (stepIndex < STEPS.length - 1) setStepIndex((index) => index + 1);
    else setPlan(buildStrengthPlan(next, variation));
  };

  const savePlan = async (): Promise<void> => {
    if (!user?.id || !plan) return;
    setSaving(true);
    try {
      if (!isPro) {
        const existing = await getLatestValidStrengthWorkout(user.id);
        if (existing && !workout) {
          setStarterWorkout(existing);
          setPlan(null);
          return;
        }
      }
      const id = workout?.id ?? newId();
      await saveStrengthWorkout({ id, userId: user.id, scheduledDay: localDay(), answers, plan });
      const saved = await getStrengthWorkout(id);
      setWorkout(saved);
      router.push(`/strength-workout?id=${encodeURIComponent(id)}`, 'root');
    } finally { setSaving(false); }
  };

  const startWorkout = async (): Promise<void> => {
    if (!workout) return;
    const now = new Date().toISOString();
    await updateStrengthWorkout(workout.id, { status: 'in_progress', startedAt: workout.startedAt ?? now });
    setWorkout({ ...workout, status: 'in_progress', startedAt: workout.startedAt ?? now });
  };

  const toggle = (id: string): void => {
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (workout) void updateStrengthWorkout(workout.id, { completedExerciseIds: [...next] });
      return next;
    });
  };

  const finishWorkout = async (): Promise<void> => {
    if (!workout || !plan || !completed.size) return;
    setSaving(true);
    try {
      const end = new Date();
      const start = workout.startedAt ? new Date(workout.startedAt) : new Date(end.getTime() - plan.estimatedMinutes * 60000);
      const elapsed = Math.max(1, Math.min(plan.estimatedMinutes + 20, Math.round((end.getTime() - start.getTime()) / 60000)));
      const status = completed.size === plan.exercises.length ? 'completed' : 'partial';
      const ratio = completed.size / plan.exercises.length;
      const calories = Math.max(1, Math.round(elapsed * 4 * ratio));
      await updateStrengthWorkout(workout.id, { status, completedAt: end.toISOString(), completedExerciseIds: [...completed], actualMinutes: elapsed, calories, caloriesSource: 'estimate' });
      await insertExerciseAndEmit({ exercise_date: localDay(end), day_of_week: shortDay(end), start_time: localTime(start), end_time: localTime(end), exercise_type: `Coach strength: ${plan.name} [${workout.id}]`, calories_burned: calories });
      setWorkout({ ...workout, status, completedAt: end.toISOString(), completedExerciseIds: [...completed], actualMinutes: elapsed, calories, caloriesSource: 'estimate' });
    } catch (error) { logger.warn('[StrengthWorkout] completion failed', { error: String(error) }); }
    finally { setSaving(false); }
  };

  const rate = async (difficulty: StrengthWorkout['difficulty']): Promise<void> => {
    if (!workout) return;
    await updateStrengthWorkout(workout.id, { difficulty });
    setWorkout({ ...workout, difficulty });
  };

  const restartWorkout = async (): Promise<void> => {
    if (!workout || (workout.status !== 'completed' && workout.status !== 'partial')) return;
    const startedAt = new Date().toISOString();
    const reset = {
      status: 'in_progress' as const,
      startedAt,
      completedAt: null,
      completedExerciseIds: [],
      actualMinutes: null,
      calories: null,
      caloriesSource: null,
      difficulty: null,
    };
    setSaving(true);
    try {
      await updateStrengthWorkout(workout.id, reset);
      setCompleted(new Set());
      setWorkout({ ...workout, ...reset });
    } finally { setSaving(false); }
  };

  if (loading) return <IonPage><TopNav showWhenAnon={false} /><IonContent className={styles.content}><div className={styles.loading}><IonSpinner /> Loading workout…</div></IonContent><BottomNav showWhenAnon={false} /></IonPage>;
  const finished = workout?.status === 'completed' || workout?.status === 'partial';
  const needsProForNewWorkout = !isPro && !workoutId && Boolean(starterWorkout);
  const paywallPath = '/paywall?returnTo=%2Fstrength-workout';
  const starterActionLabel = starterWorkout?.status === 'in_progress'
    ? 'Continue my free workout'
    : starterWorkout?.status === 'planned'
      ? 'Start my free workout'
      : 'View my free workout';

  return <IonPage>
    <TopNav showWhenAnon={false} />
    <IonContent fullscreen className={styles.content}>
      <main className={styles.page}>
        <button className={styles.back} type="button" onClick={() => router.push('/coach', 'back')}><ArrowLeft size={17} /> Coach</button>
        <section className={styles.hero}>
          <div><span><Dumbbell size={17} /> Stay Strong with Coach · {isPro ? 'Pro' : 'Free starter'}</span><h1>{needsProForNewWorkout ? 'Keep building your strength' : plan ? plan.name : 'Let’s build your workout'}</h1><p>{needsProForNewWorkout ? 'Your complete starter workout stays available. Pro adds the ongoing programme.' : plan ? 'Quality repetitions matter more than racing the clock.' : 'Seven quick answers create a workout that fits your day.'}</p></div>
          <div className={styles.heroStat}><strong>{plan?.estimatedRange ?? '6 + 1'}</strong><small>{plan ? 'time range' : 'questions'}</small></div>
        </section>

        {needsProForNewWorkout && <section className={entitlementStyles.upgradeCard}>
          <span className={styles.kicker}>Your free workout is yours to keep</span>
          <h2>Continue with a personalised strength programme</h2>
          <p>Pro unlocks unlimited new workouts, exercise swaps, weekly scheduling, progression using your feedback, and detailed strength summaries.</p>
          <div className={entitlementStyles.upgradeGrid}>
            <div><strong>Always available</strong><span>Reopen, complete and log your existing starter workout.</span></div>
            <div><strong>With Pro</strong><span>Build the next workout and let Coach adapt the programme over time.</span></div>
          </div>
          <div className={entitlementStyles.upgradeActions}>
            <IonButton onClick={() => router.push(`/strength-workout?id=${encodeURIComponent(starterWorkout!.id)}`, 'forward')}>
              {starterActionLabel} <ChevronRight size={17} />
            </IonButton>
            <IonButton fill="outline" onClick={() => router.push(paywallPath, 'forward')}>See Pro options</IonButton>
          </div>
          <button type="button" className={styles.textButton} onClick={() => router.push('/today', 'back')}>Back to Today</button>
        </section>}

        {!needsProForNewWorkout && !plan && <section className={styles.questionCard}>
          <div className={styles.progress}><i style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} /></div>
          <span className={styles.kicker}>Question {stepIndex + 1} of {STEPS.length}</span>
          <h2>{QUESTIONS[STEPS[stepIndex]]}</h2>
          {STEPS[stepIndex] === 'limitation' && <p className={styles.hint}>This is not medical screening. Pain, recent surgery or a health restriction needs professional guidance.</p>}
          <div className={styles.options}>{OPTIONS[STEPS[stepIndex]].map((option) => <button key={String(option.value)} type="button" onClick={() => choose(option.value)}><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}<ChevronRight size={17} /></button>)}</div>
          {stepIndex > 0 && <button type="button" className={styles.textButton} onClick={() => setStepIndex((index) => index - 1)}>Previous question</button>}
        </section>}

        {plan && <>
          <section className={styles.contextStrip}>
            <div><Activity size={18} /><span>Steps today</span><strong>{activity.steps.toLocaleString()}</strong></div>
            <div><Timer size={18} /><span>Exercise today</span><strong>{activity.minutes} min</strong></div>
            <div><ShieldCheck size={18} /><span>Session</span><strong>{workout ? workout.status.replace('_', ' ') : 'not saved'}</strong></div>
          </section>
          <section className={styles.planCard}>
            <div className={styles.planHeader}><div><span className={styles.kicker}>Coach’s recommendation</span><h2>{plan.name}</h2><p>{plan.rationale}</p></div>{!workout && <button className={styles.swap} type="button" onClick={() => {
              if (!isPro) { router.push(paywallPath, 'forward'); return; }
              const next = variation + 1; setVariation(next); setPlan(buildStrengthPlan(answers, next));
            }}><RefreshCw size={16} /> {isPro ? 'Swap exercises' : 'Swap with Pro'}</button>}</div>
            <div className={styles.prep}><strong>Warm up</strong><span>{plan.warmup}</span></div>
            <div className={styles.exerciseList}>{plan.exercises.map((exercise, index) => {
              const done = completed.has(exercise.id);
              return <article key={exercise.id} className={done ? styles.done : ''}>
                <button type="button" disabled={!workout || workout.status === 'planned' || finished} onClick={() => toggle(exercise.id)}>{done ? <Check size={20} /> : index + 1}</button>
                <div><h3>{exercise.name}</h3><strong>{exercise.sets} sets · {exercise.reps} · {exercise.restSeconds}s rest</strong><p>{exercise.cue}</p></div>
              </article>;
            })}</div>
            <div className={styles.prep}><strong>Cool down</strong><span>{plan.cooldown}</span></div>
            {!workout && <div className={styles.actions}><IonButton onClick={() => void savePlan()} disabled={saving}>Accept & save for today</IonButton><button type="button" onClick={() => { setPlan(null); setStepIndex(0); }}>Change my answers</button></div>}
            {workout?.status === 'planned' && <div className={styles.actions}><IonButton onClick={() => void startWorkout()}><Play size={17} /> Start workout</IonButton><span>Calories are added only after you finish or log a partial workout.</span></div>}
            {workout?.status === 'in_progress' && <div className={styles.actions}><IonButton onClick={() => void finishWorkout()} disabled={!completed.size || saving}><Pause size={17} /> {completed.size === plan.exercises.length ? 'Complete workout' : 'Finish & log partial'}</IonButton><span>{completed.size}/{plan.exercises.length} exercises completed</span></div>}
            {finished && <div className={styles.completedBox}><Check size={24} /><div><h3>{workout.status === 'completed' ? 'Workout complete' : 'Partial workout saved'}</h3><p>{workout.actualMinutes} min · approximately {workout.calories} kcal · {workout.completedExerciseIds.length}/{plan.exercises.length} exercises</p><small>Calories are estimated unless a matching Apple Health workout supplies them.</small></div></div>}
            {finished && <div className={styles.rating}><strong>How did it feel?</strong>{(['easy', 'right', 'hard', 'pain'] as const).map((value) => <button className={workout.difficulty === value ? styles.selected : ''} key={value} type="button" onClick={() => void rate(value)}>{value === 'pain' ? 'Something hurt' : value === 'right' ? 'About right' : `Too ${value}`}</button>)}</div>}
            {finished && !isPro && <div className={entitlementStyles.proFollowUp}><div><strong>Your free workout is yours to repeat</strong><span>Restart this saved plan whenever you like. Pro is only needed for additional newly tailored workouts.</span></div><div className={entitlementStyles.followUpActions}><IonButton size="small" onClick={() => void restartWorkout()} disabled={saving}>Restart my free workout</IonButton><IonButton size="small" fill="outline" onClick={() => router.push(paywallPath, 'forward')}>See Pro options</IonButton></div></div>}
          </section>
          <aside className={styles.safety}><ShieldCheck size={20} /><p>Stop for sharp pain, chest pain, faintness or feeling unusually unwell. This is general fitness guidance, not rehabilitation or medical clearance.</p></aside>
        </>}
      </main>
    </IonContent>
    <BottomNav showWhenAnon={false} />
  </IonPage>;
};

export default StrengthWorkoutPage;
