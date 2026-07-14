export type StrengthExperience = 'beginner' | 'some' | 'regular';
export type StrengthGoal = 'preserve' | 'stronger' | 'muscle' | 'mobility';
export type StrengthEquipment = 'none' | 'bands' | 'dumbbells' | 'gym';
export type StrengthLimitation = 'none' | 'knees' | 'back' | 'shoulders' | 'balance' | 'other';
export type StrengthDuration = 10 | 20 | 30 | 45;
export type StrengthFrequency = 1 | 2 | 3;
export type StrengthReadiness = 'low' | 'normal' | 'good';
export type StrengthStatus = 'planned' | 'in_progress' | 'completed' | 'partial' | 'skipped';

export type StrengthAnswers = {
  experience: StrengthExperience;
  goal: StrengthGoal;
  equipment: StrengthEquipment;
  limitation: StrengthLimitation;
  duration: StrengthDuration;
  frequency: StrengthFrequency;
  readiness: StrengthReadiness;
};

export type StrengthExercise = {
  id: string;
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  cue: string;
  area: 'legs' | 'push' | 'pull' | 'core' | 'balance';
};

export type StrengthPlan = {
  name: string;
  estimatedMinutes: number;
  estimatedRange: string;
  warmup: string;
  cooldown: string;
  rationale: string;
  exercises: StrengthExercise[];
};

type Template = Omit<StrengthExercise, 'sets' | 'restSeconds'> & {
  equipment: StrengthEquipment[];
  avoid?: StrengthLimitation[];
};

const EXERCISES: Template[] = [
  { id: 'chair-squat', name: 'Chair squat', reps: '8–12', cue: 'Tap the chair gently, then stand tall.', area: 'legs', equipment: ['none', 'bands'], avoid: ['knees'] },
  { id: 'sit-stand', name: 'Supported sit-to-stand', reps: '6–10', cue: 'Use your hands if needed and move within a comfortable range.', area: 'legs', equipment: ['none', 'bands'], avoid: ['knees'] },
  { id: 'glute-bridge', name: 'Glute bridge', reps: '10–15', cue: 'Press through your heels without arching your back.', area: 'legs', equipment: ['none', 'bands'], avoid: ['back'] },
  { id: 'wall-pushup', name: 'Wall push-up', reps: '8–12', cue: 'Keep one straight line from shoulders to ankles.', area: 'push', equipment: ['none', 'bands'] },
  { id: 'band-chest', name: 'Band chest press', reps: '10–15', cue: 'Use a secure anchor and keep your wrists straight.', area: 'push', equipment: ['bands'], avoid: ['shoulders'] },
  { id: 'db-floor', name: 'Dumbbell floor press', reps: '8–12', cue: 'Lower with control until your upper arms meet the floor.', area: 'push', equipment: ['dumbbells'], avoid: ['shoulders'] },
  { id: 'machine-chest', name: 'Chest press machine', reps: '8–12', cue: 'Set the handles around mid-chest height.', area: 'push', equipment: ['gym'], avoid: ['shoulders'] },
  { id: 'towel-row', name: 'Seated towel row isometric', reps: '20–30 sec', cue: 'Pull against the towel while keeping shoulders relaxed.', area: 'pull', equipment: ['none'] },
  { id: 'band-row', name: 'Seated band row', reps: '10–15', cue: 'Anchor securely and draw your elbows toward your sides.', area: 'pull', equipment: ['bands'] },
  { id: 'db-row', name: 'Supported dumbbell row', reps: '8–12 each side', cue: 'Brace on a chair and pull the weight toward your hip.', area: 'pull', equipment: ['dumbbells'], avoid: ['back'] },
  { id: 'machine-row', name: 'Seated row machine', reps: '8–12', cue: 'Keep your chest steady and avoid shrugging.', area: 'pull', equipment: ['gym'] },
  { id: 'hip-hinge', name: 'Supported hip hinge', reps: '8–12', cue: 'Push your hips back while keeping a long spine.', area: 'legs', equipment: ['none', 'bands'], avoid: ['back', 'balance'] },
  { id: 'db-rdl', name: 'Dumbbell Romanian deadlift', reps: '8–12', cue: 'Keep the weights close and hinge from your hips.', area: 'legs', equipment: ['dumbbells'], avoid: ['back', 'balance'] },
  { id: 'leg-press', name: 'Leg press', reps: '8–12', cue: 'Use a comfortable depth and do not lock your knees.', area: 'legs', equipment: ['gym'], avoid: ['knees'] },
  { id: 'bird-dog', name: 'Bird dog', reps: '6–8 each side', cue: 'Move slowly and keep your hips level.', area: 'core', equipment: ['none', 'bands'], avoid: ['back', 'balance'] },
  { id: 'dead-bug', name: 'Dead bug', reps: '6–8 each side', cue: 'Keep your lower back gently connected to the floor.', area: 'core', equipment: ['none', 'bands', 'dumbbells'], avoid: ['back'] },
  { id: 'suitcase-march', name: 'Suitcase march', reps: '30 sec each side', cue: 'Stand tall and resist leaning toward the weight.', area: 'core', equipment: ['dumbbells', 'gym'], avoid: ['balance'] },
  { id: 'calf-raise', name: 'Supported calf raise', reps: '12–15', cue: 'Hold a stable surface and lower slowly.', area: 'balance', equipment: ['none', 'bands', 'dumbbells', 'gym'] },
];

export const DEFAULT_STRENGTH_ANSWERS: StrengthAnswers = {
  experience: 'beginner', goal: 'preserve', equipment: 'none', limitation: 'none',
  duration: 20, frequency: 2, readiness: 'normal',
};

export function buildStrengthPlan(answers: StrengthAnswers, variation = 0): StrengthPlan {
  const count = answers.duration === 10 ? 3 : answers.duration === 20 ? 4 : answers.duration === 30 ? 5 : 6;
  const baseSets = answers.duration <= 20 ? 2 : 3;
  const sets = Math.max(1, baseSets + (answers.readiness === 'low' ? -1 : answers.experience === 'regular' && answers.readiness === 'good' ? 1 : 0));
  const restSeconds = answers.readiness === 'low' ? 75 : answers.readiness === 'good' ? 45 : 60;
  let candidates = EXERCISES.filter((exercise) => exercise.equipment.includes(answers.equipment));
  if (answers.limitation !== 'none') {
    const filtered = candidates.filter((exercise) => !exercise.avoid?.includes(answers.limitation));
    if (filtered.length >= count) candidates = filtered;
  }
  const offset = candidates.length ? variation % candidates.length : 0;
  candidates = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  const order: StrengthExercise['area'][] = ['legs', 'push', 'pull', 'core', 'balance'];
  const selected: Template[] = [];
  for (const area of order) {
    const exercise = candidates.find((item) => item.area === area && !selected.includes(item));
    if (exercise) selected.push(exercise);
  }
  for (const exercise of candidates) {
    if (selected.length >= count) break;
    if (!selected.includes(exercise)) selected.push(exercise);
  }
  const limitationText = answers.limitation === 'none' ? '' : ` It avoids movements commonly uncomfortable for ${answers.limitation}.`;
  const energyText = answers.readiness === 'low' ? ' Today uses fewer sets and longer rests for lower energy.' : '';
  return {
    name: `${answers.duration}-minute full-body strength`,
    estimatedMinutes: answers.duration,
    estimatedRange: `${Math.max(5, answers.duration - 3)}–${answers.duration + 5} min`,
    warmup: 'Easy march, shoulder rolls and gentle hip hinges · 3 min',
    cooldown: 'Slow breathing and comfortable stretches · 2 min',
    rationale: `Built for ${answers.experience === 'beginner' ? 'a newer lifter' : 'your experience'}, ${answers.equipment === 'none' ? 'without equipment' : `using ${answers.equipment}`}.${limitationText}${energyText}`,
    exercises: selected.slice(0, count).map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      reps: exercise.reps,
      cue: exercise.cue,
      area: exercise.area,
      sets,
      restSeconds,
    })),
  };
}
