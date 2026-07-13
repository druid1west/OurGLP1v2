export type CoachCategory =
  | 'Nausea & Appetite'
  | 'Constipation & Digestion'
  | 'Protein'
  | 'Hydration'
  | 'Injection Day'
  | 'Exercise & Energy'
  | 'Sleep & Fatigue'
  | 'Weight Trends'
  | 'Reminders & Habits'
  | 'Clinician Questions'
  | 'Missed Routines'
  | 'Weekly Review'
  | 'Emotional Eating'
  | 'Meal Prep'
  | 'Eating Out'
  | 'Side-Effect Tracking';

export type CoachReminderSuggestion = Readonly<{
  title: string;
  detail: string;
}>;

export type CoachEntry = Readonly<{
  id: string;
  category: CoachCategory;
  question: string;
  keywords: readonly string[];
  answer: string;
  followUps: readonly string[];
  reminder?: CoachReminderSuggestion;
}>;

type Seed = Readonly<{
  q: string;
  k: readonly string[];
  a: string;
  r?: CoachReminderSuggestion;
}>;

const followUpsByCategory: Record<CoachCategory, readonly string[]> = {
  'Nausea & Appetite': ['Protein when nauseous', 'Hydration tips', 'When should I call my clinician?'],
  'Constipation & Digestion': ['Gentle fiber ideas', 'Hydration reminder', 'Side-effect tracking'],
  Protein: ['Easy protein ideas', 'Protein reminder', 'Meal prep ideas'],
  Hydration: ['Electrolyte basics', 'Hydration reminder', 'Injection day routine'],
  'Injection Day': ['Injection day prep', 'Nausea after injection', 'Weekly review'],
  'Exercise & Energy': ['Low-energy movement', 'Fatigue tips', 'Weekly review'],
  'Sleep & Fatigue': ['Evening routine', 'Energy check-in', 'Clinician questions'],
  'Weight Trends': ['Plateau basics', 'Weekly review', 'Questions for clinician'],
  'Reminders & Habits': ['Create a habit cue', 'Missed routines', 'Weekly review'],
  'Clinician Questions': ['Prepare for appointment', 'Side-effect tracking', 'Medication boundaries'],
  'Missed Routines': ['Restart today', 'Reminder reset', 'Weekly review'],
  'Weekly Review': ['What to review weekly', 'Pattern spotting', 'Questions for clinician'],
  'Emotional Eating': ['Craving support', 'Stress routine', 'Meal prep ideas'],
  'Meal Prep': ['Protein prep', 'Eating out', 'Hydration tips'],
  'Eating Out': ['Restaurant choices', 'Portion pacing', 'Nausea tips'],
  'Side-Effect Tracking': ['Nausea tracking', 'Constipation tracking', 'Questions for clinician'],
};

const seeds: Record<CoachCategory, readonly Seed[]> = {
  'Nausea & Appetite': [
    { q: 'What can I eat when nausea shows up?', k: ['nausea', 'sick', 'queasy', 'food'], a: 'Keep the next meal small, slow, and simple. Many people tolerate lean protein, bland carbohydrates, soups, yogurt, or crackers better than greasy, spicy, or very sweet foods. Sip fluids steadily. If nausea is severe, persistent, or paired with dehydration, severe pain, or repeated vomiting, contact your clinician.' },
    { q: 'Why do large meals feel harder now?', k: ['large meal', 'full', 'overeating', 'portion'], a: 'GLP-1 medicines can slow digestion and reduce appetite, so a meal that used to feel normal may now feel heavy. Try smaller portions, pause halfway through, and stop at comfortable fullness. You can always add a small protein snack later.' },
    { q: 'What should I do if I have no appetite?', k: ['no appetite', 'not hungry', 'skip food'], a: 'Low appetite can make nutrition harder. Aim for small, protein-forward bites across the day instead of one large meal. Smooth textures like yogurt, eggs, cottage cheese, tofu, soup, or a protein shake may be easier. If you cannot keep food or fluids down, seek medical advice.' },
    { q: 'Are greasy foods a problem on GLP-1s?', k: ['greasy', 'fried', 'fatty', 'fast food'], a: 'Some people notice greasy or fried meals feel heavier or trigger nausea while on GLP-1s. You do not have to be perfect, but it may help to choose grilled, baked, steamed, or broth-based options more often and eat slowly.' },
    { q: 'How can I handle morning nausea?', k: ['morning nausea', 'wake', 'breakfast'], a: 'Try starting with a few sips of water and a small bland bite before coffee or a full meal. A light protein option may help once your stomach settles. Track whether morning nausea clusters near injection day or after late meals.' },
    { q: 'Can eating too fast make nausea worse?', k: ['eat fast', 'too fast', 'pace'], a: 'Yes, eating quickly can overshoot fullness before your body catches up. Try smaller bites, put utensils down between bites, and pause halfway. The goal is comfortable enough, not stuffed.' },
    { q: 'What if I feel full after only a few bites?', k: ['full quickly', 'early fullness', 'few bites'], a: 'Early fullness can happen. Prioritize protein and fluids across the day, use smaller plates, and keep easy mini-meals available. If fullness is extreme, worsening, or prevents hydration, check in with your clinician.' },
    { q: 'Should I skip meals when I feel nauseous?', k: ['skip meals', 'nauseous', 'meal'], a: 'Skipping may feel tempting, but long gaps can sometimes make nausea or low energy worse. Try a small, gentle option instead: a few bites of protein, soup, yogurt, or toast. If you cannot keep anything down, seek medical guidance.' },
    { q: 'How do I prevent nausea on injection day?', k: ['injection nausea', 'shot nausea', 'prevent nausea'], a: 'The day before and day of injection, keep meals moderate, hydrate, and avoid unusually heavy or rich foods. Some users like a simple protein plan and a hydration check-in. Track what works so your routine gets easier over time.', r: { title: 'Injection day hydration check', detail: 'Draft a hydration reminder for the morning of injection day.' } },
    { q: 'When is nausea a red flag?', k: ['red flag', 'vomiting', 'dehydration', 'severe nausea'], a: 'Contact your clinician promptly if nausea is severe, persistent, prevents fluids, causes repeated vomiting, or comes with severe abdominal pain, fainting, confusion, signs of dehydration, or symptoms that feel unusual for you.' },
  ],
  'Constipation & Digestion': [
    { q: 'What can help constipation?', k: ['constipation', 'constipated', 'bowel'], a: 'Start with basics: fluids, gentle movement, regular meals, and fiber from foods you tolerate. Add fiber gradually so you do not create more bloating. If constipation is severe, painful, or prolonged, ask your clinician what is safe for you.' },
    { q: 'How do I add fiber without feeling bloated?', k: ['fiber', 'bloating', 'gas'], a: 'Increase fiber slowly and pair it with fluids. Soft options like oatmeal, chia pudding, beans in small portions, berries, vegetables, or psyllium may help some people, but tolerance varies. Track what your body accepts.' },
    { q: 'Does hydration affect bowel habits?', k: ['hydration', 'bowel', 'water constipation'], a: 'Yes. Lower food intake plus low fluids can make stools harder. A steady hydration rhythm through the day often helps more than trying to catch up all at once.', r: { title: 'Hydration rhythm', detail: 'Draft a daily water check-in reminder.' } },
    { q: 'Can walking help digestion?', k: ['walking', 'digestion', 'movement'], a: 'Gentle movement can support digestion and bowel regularity. Even 5 to 10 minutes after a meal can be useful if it feels comfortable. Keep it easy when nausea or fatigue is active.' },
    { q: 'What should I track for constipation?', k: ['track constipation', 'bowel movement', 'stool'], a: 'Track date, comfort, stool pattern, hydration, fiber changes, movement, and any medicines or supplements your clinician recommended. Patterns are more useful than one isolated day.' },
    { q: 'Are smaller meals better for reflux?', k: ['reflux', 'heartburn', 'acid'], a: 'Smaller meals, slower eating, and avoiding late heavy meals may reduce reflux for some people. If reflux is frequent, painful, or new, talk with your clinician about safe options.' },
    { q: 'What if I have diarrhea instead?', k: ['diarrhea', 'loose stool'], a: 'Focus on fluids and gentle foods while symptoms are active. Track timing, foods, and injection schedule. Contact your clinician if diarrhea is severe, persistent, bloody, or linked with dehydration or fever.' },
    { q: 'Can I use over-the-counter constipation medicine?', k: ['laxative', 'medicine constipation', 'otc'], a: 'Ask your clinician or pharmacist what is safe for you, especially if you have other conditions or medicines. The coach can help you prepare a clear symptom summary, but it should not choose medication for you.' },
    { q: 'How often should bowel movements happen?', k: ['how often', 'bowel frequency'], a: 'Normal varies. The important signals are change from your baseline, comfort, straining, pain, and how long symptoms persist. Track your pattern and share concerns with your care team.' },
    { q: 'When is constipation urgent?', k: ['urgent constipation', 'severe constipation', 'pain'], a: 'Seek medical advice promptly for severe abdominal pain, vomiting, inability to pass gas, blood in stool, fever, or constipation that is prolonged or very different from your usual pattern.' },
  ],
  Protein: [
    { q: 'How can I get more protein when I feel full?', k: ['protein', 'full', 'hard to eat'], a: 'Use small protein moments instead of one big target: yogurt, eggs, cottage cheese, fish, chicken, tofu, beans, protein shakes, or soup with added protein. Start with protein first when appetite is low.', r: { title: 'Protein check-in', detail: 'Draft a daily protein reminder after lunch.' } },
    { q: 'What are easy protein snacks?', k: ['protein snack', 'snacks'], a: 'Easy choices include Greek yogurt, cheese sticks, eggs, tuna packs, edamame, turkey roll-ups, cottage cheese, protein shakes, tofu bites, or hummus with vegetables. Pick what feels gentle on your stomach.' },
    { q: 'Should I eat protein first?', k: ['protein first', 'meal order'], a: 'Protein first can help when appetite is limited because it protects the most useful part of the meal. Then add fiber-rich carbs, vegetables, and healthy fats as tolerated.' },
    { q: 'What if meat feels unappealing?', k: ['meat', 'chicken', 'unappealing'], a: 'Try softer or cooler proteins: yogurt, cottage cheese, eggs, tofu, beans, fish, protein smoothies, or soups. Texture matters a lot when appetite changes.' },
    { q: 'Can protein shakes help?', k: ['protein shake', 'smoothie'], a: 'Protein shakes can be convenient when appetite is low, but they are not required. Choose one that sits well and does not crowd out all whole foods. Sip slowly to avoid feeling overly full.' },
    { q: 'How do I avoid losing muscle?', k: ['muscle', 'strength', 'lean mass'], a: 'Protein plus resistance-style movement helps support muscle during weight loss. Start with gentle strength work that fits your ability, and ask a clinician or trainer for personalized guidance if needed.' },
    { q: 'What protein works for breakfast?', k: ['breakfast protein', 'morning protein'], a: 'Try eggs, Greek yogurt, cottage cheese, smoked salmon, tofu scramble, protein oats, or a small smoothie. Keep portions modest if mornings are nauseous.' },
    { q: 'How do I track protein without obsessing?', k: ['track protein', 'obsess', 'logging'], a: 'Use ranges and patterns rather than perfection. A simple check like “protein with each meal” can be enough for many users. Detailed grams are useful only if they help you.' },
    { q: 'Can I split protein into mini meals?', k: ['mini meals', 'split protein'], a: 'Yes. Mini meals can work very well on GLP-1s. Think 15 to 25 grams at a time if that fits your plan, instead of trying to force a large meal.' },
    { q: 'What if protein makes nausea worse?', k: ['protein nausea', 'protein sick'], a: 'Try cooler, softer, or milder proteins and smaller portions. Greasy or dense proteins may feel harder. If nausea keeps you from eating enough, bring that pattern to your clinician.' },
  ],
  Hydration: [
    { q: 'How much water should I drink?', k: ['water', 'hydration', 'drink'], a: 'Hydration needs vary, so use your clinician’s guidance if you have fluid restrictions. A practical goal is steady sipping across the day and watching urine color, thirst, dizziness, and constipation patterns.' },
    { q: 'Do electrolytes help?', k: ['electrolytes', 'salt', 'hydration'], a: 'Electrolytes can help some people, especially with lower food intake, sweating, or lightheadedness. Choose options that fit your health needs. If you manage blood pressure, kidney, or heart conditions, ask your clinician first.' },
    { q: 'How do I remember to drink water?', k: ['remember water', 'drink reminder'], a: 'Attach water to routines you already do: wake-up, medication time, meals, commute, or evening wind-down. Small reminders work better than guilt.', r: { title: 'Water check-in', detail: 'Draft a daily hydration reminder.' } },
    { q: 'What if plain water feels hard?', k: ['plain water', 'flavor', 'hard drink'], a: 'Try cold water, herbal tea, diluted electrolyte drinks, broth, sparkling water if tolerated, or fruit-infused water. The best option is the one you will actually drink.' },
    { q: 'Can dehydration make side effects worse?', k: ['dehydration', 'side effects', 'dizzy'], a: 'Low fluids can worsen constipation, headaches, dizziness, and fatigue for some people. If you have signs of dehydration or cannot keep fluids down, contact a clinician promptly.' },
    { q: 'Should I drink more on injection day?', k: ['injection day water', 'shot hydration'], a: 'A steady hydration rhythm around injection day may help you feel more prepared. Avoid trying to force a huge amount at once. Small, regular sips are often easier.' },
    { q: 'How can I hydrate when nauseous?', k: ['hydrate nausea', 'sip'], a: 'Use tiny sips, ice chips, or cold fluids. Avoid chugging. If nausea prevents fluids or you notice dizziness, very dark urine, or weakness, seek medical advice.' },
    { q: 'Does coffee count as hydration?', k: ['coffee', 'caffeine', 'hydration'], a: 'Coffee contributes fluid, but caffeine can bother reflux, nausea, or sleep for some people. Pair coffee with water and notice how it affects your stomach and energy.' },
    { q: 'What are signs I need more fluids?', k: ['signs dehydration', 'dark urine', 'thirst'], a: 'Thirst, darker urine, dry mouth, headache, dizziness, constipation, and low energy can be clues. Severe symptoms, confusion, fainting, or inability to keep fluids down need medical attention.' },
    { q: 'How do I build a hydration routine?', k: ['hydration routine', 'water habit'], a: 'Pick three anchors: morning, midday, and evening. Keep a bottle visible, choose a realistic amount, and use reminders only where they reduce friction.' },
  ],
  'Injection Day': [
    { q: 'How should I prepare for injection day?', k: ['injection day', 'shot day', 'prepare'], a: 'Keep the day simple: hydrate, eat moderate meals, avoid unusual heavy foods, and note how you feel before and after. Follow your prescription instructions exactly and ask your clinician about any medication questions.' },
    { q: 'What should I eat before my injection?', k: ['before injection', 'eat before shot'], a: 'Many people prefer a normal, moderate meal with protein and fluids. Avoid making injection day the day for very rich, large, or unfamiliar foods if those tend to bother you.' },
    { q: 'What should I track after injection?', k: ['after injection', 'track shot'], a: 'Track time, location if useful, appetite, nausea, bowel habits, hydration, energy, and any symptoms you want to discuss. Trends over several weeks are more helpful than one day.' },
    { q: 'Can the coach remind me about injection day?', k: ['injection reminder', 'shot reminder'], a: 'Yes. The coach can draft a reminder, but the app should show the exact day and time first. Nothing should be saved until you confirm.', r: { title: 'Injection reminder', detail: 'Draft a weekly injection reminder for your selected day and time.' } },
    { q: 'What if I am anxious about the shot?', k: ['anxious injection', 'needle', 'shot fear'], a: 'Use a repeatable routine: prepare supplies, breathe slowly, follow your prescribed instructions, and reward the completed step. If anxiety is strong, ask your care team for injection coaching.' },
    { q: 'Should I rotate injection sites?', k: ['rotate site', 'injection site'], a: 'Follow the instructions from your medication guide and clinician. Many injectable medicines recommend rotating sites, but your care team’s guidance should lead.' },
    { q: 'What if I miss my injection?', k: ['miss injection', 'forgot shot'], a: 'Follow the missed-dose instructions from your prescription label or clinician. The coach should not decide dosing timing. It can help you write down what happened and prepare a question for your care team.' },
    { q: 'How do I make injection day easier?', k: ['easier injection', 'routine'], a: 'Create a small ritual: supplies ready, reminder set, simple meal plan, hydration cue, and a short check-in afterward. Predictable routines reduce mental load.' },
    { q: 'Can symptoms peak after injection?', k: ['symptoms after injection', 'peak'], a: 'Some users notice appetite or digestive changes cluster around certain days in the week. Track your pattern and share severe or concerning symptoms with your clinician.' },
    { q: 'What should I ask my clinician about injection reactions?', k: ['injection reaction', 'clinician'], a: 'Ask what reactions are expected, what needs urgent care, how to handle missed doses, and whether your site reactions or symptoms fit your medication plan.' },
  ],
  'Exercise & Energy': [
    { q: 'What exercise is good when energy is low?', k: ['exercise', 'low energy', 'tired'], a: 'Choose the smallest useful version: a short walk, gentle stretching, light bands, or a few bodyweight movements. Consistency matters more than intensity when energy is limited.' },
    { q: 'Should I exercise if I feel nauseous?', k: ['nausea exercise', 'workout sick'], a: 'Keep it gentle or rest if nausea is active. A slow walk may help some people, but pushing hard can backfire. Severe symptoms, dizziness, chest pain, or faintness need medical attention.' },
    { q: 'How do I start strength training?', k: ['strength', 'weights', 'resistance'], a: 'Start with simple movements two or three times weekly if appropriate: sit-to-stand, wall pushups, heel raises, knee lifts, mini squats, or light bands. Keep it comfortable and progress slowly.' },
    { q: 'Why do I feel weaker while losing weight?', k: ['weak', 'muscle', 'weight loss'], a: 'Lower calories, low protein, dehydration, and reduced activity can all affect strength. Protein plus gentle resistance work can help. If weakness is sudden or severe, contact your clinician.' },
    { q: 'Can walking after meals help?', k: ['walk after meal', 'post meal'], a: 'A short easy walk after meals may support digestion, blood sugar patterns, and routine consistency. Even 5 minutes counts.' },
    { q: 'How do I avoid overdoing workouts?', k: ['overdo', 'sore', 'too much exercise'], a: 'Use a “finish feeling able to continue” rule. Increase time or intensity gradually, and watch recovery, sleep, hunger, and soreness.' },
    { q: 'What if I am too tired to work out?', k: ['too tired', 'fatigue exercise'], a: 'Try a two-minute start. If you still feel drained, choose recovery: hydration, protein, sleep, and a plan for tomorrow. Missing one workout does not erase progress.' },
    { q: 'Should I track steps?', k: ['steps', 'walking goal'], a: 'Steps can be useful if they motivate you, but they are only one marker. Watch trends and choose a goal that supports consistency without turning into pressure.' },
    { q: 'Can exercise help a plateau?', k: ['plateau exercise', 'stuck weight'], a: 'Movement can help health, strength, and body composition even when scale changes slow. For a plateau, use 7 honest days of food calories, protein, water, movement minutes, and estimated movement calories. These numbers are estimates, but they help show whether your current routine may be maintaining your weight.' },
    { q: 'How can I make exercise a habit?', k: ['exercise habit', 'routine'], a: 'Pair movement with an existing anchor: after coffee, after lunch, before shower, or during a favorite podcast. Start smaller than you think you need.', r: { title: 'Movement check-in', detail: 'Draft a short daily walk reminder.' } },
    { q: 'Give me a beginner exercise routine.', k: ['beginner routine', 'stay strong', 'easy exercise', 'chair exercise', 'novice exercise'], a: 'Try the 10 to 15 minute Stay Strong routine if it feels safe for you. Warm up for 2 minutes by walking around, rolling shoulders, gentle arm circles, and marching on the spot. Then do: sit-to-stand 8 to 12 reps, wall push-ups 8 to 12 reps, heel raises 10 to 15 reps, standing knee lifts 10 each side, mini squats 8 to 10 reps, single-leg balance 20 to 30 seconds each side while holding support if needed, and wall angels 8 reps within a comfortable range. Finish with 2 minutes of easy walking and gentle calf, chest, and shoulder stretches. Stop if you feel dizzy, unwell, or pain. If you have surgery history, balance concerns, or activity limits, check with your clinician first.' },
  ],
  'Sleep & Fatigue': [
    { q: 'Why am I tired on GLP-1s?', k: ['tired', 'fatigue', 'sleepy'], a: 'Fatigue can come from lower food intake, dehydration, poor sleep, rapid routine changes, or other causes. Track timing, meals, hydration, sleep, and symptoms. Persistent or severe fatigue deserves a clinician check-in.' },
    { q: 'How can I support sleep?', k: ['sleep', 'insomnia', 'bedtime'], a: 'Use a steady wind-down: dim lights, reduce late caffeine, keep heavy meals earlier if reflux is an issue, and set a consistent sleep window. Track what changes help.' },
    { q: 'Can eating too little affect energy?', k: ['eating too little', 'low calories', 'energy'], a: 'Yes. Very low intake can show up as fatigue, dizziness, irritability, or poor workouts. Prioritize protein, fluids, and balanced small meals. Ask your clinician if intake feels too low.' },
    { q: 'Should I nap when fatigued?', k: ['nap', 'fatigue'], a: 'A short nap can help some people, but long or late naps may disrupt nighttime sleep. If fatigue is frequent, look at hydration, food, sleep timing, and symptoms.' },
    { q: 'Can dehydration make me tired?', k: ['dehydration tired', 'fatigue water'], a: 'Yes, low fluid intake can contribute to fatigue or headaches. Try a steady hydration plan and track whether energy improves.' },
    { q: 'What if fatigue hits after injection?', k: ['fatigue injection', 'shot tired'], a: 'Track whether fatigue clusters after injection day and how long it lasts. Plan lighter tasks and simple meals if you know that window is harder. Share recurring patterns with your clinician.' },
    { q: 'How do I plan meals when tired?', k: ['tired meal', 'low energy food'], a: 'Keep backup meals ready: yogurt, eggs, soup, rotisserie chicken, tofu, tuna packs, frozen vegetables, or protein shakes. Lower the effort, not the care.' },
    { q: 'Could low protein affect fatigue?', k: ['protein fatigue', 'low protein tired'], a: 'Low protein can contribute to low energy and poor recovery. Look at your weekly pattern rather than one day, then add one easy protein anchor.' },
    { q: 'When should fatigue be checked?', k: ['fatigue clinician', 'severe tired'], a: 'Contact your clinician if fatigue is severe, sudden, persistent, linked with dizziness/fainting, chest pain, shortness of breath, dehydration, or anything that feels unusual for you.' },
    { q: 'Can the coach help with an evening routine?', k: ['evening routine', 'bedtime reminder'], a: 'Yes. It can suggest a simple wind-down reminder, such as hydration check, tomorrow’s protein plan, or screen-off time, and you confirm before it is saved.', r: { title: 'Evening reset', detail: 'Draft a nightly wind-down reminder.' } },
  ],
  'Weight Trends': [
    { q: 'Why did my weight go up today?', k: ['weight up', 'gain', 'scale'], a: 'Daily weight can shift from water, salt, bowel habits, hormones, workouts, travel, and timing. Look at weekly trends rather than one weigh-in.' },
    { q: 'What is a plateau?', k: ['plateau', 'stuck', 'not losing'], a: 'A plateau is a period where trend weight changes slow or pause. It often means your current food, movement, sleep, stress, bowel habits, and medication routine are adding up to maintenance for now. Start with a 7-day reset: log food honestly, include calories where you can, track protein and water, add repeatable movement, and review the weekly trend. Ask your clinician before changing medication plans.' },
    { q: 'How often should I weigh myself?', k: ['weigh', 'scale frequency'], a: 'Choose a rhythm that supports you mentally. Some people like daily trend averages; others prefer weekly. Consistency of time and context matters more than frequency.' },
    { q: 'What if the scale affects my mood?', k: ['scale mood', 'discouraged'], a: 'Use non-scale markers too: energy, symptoms, strength, clothing fit, labs, appetite patterns, and consistency. If weighing triggers distress, reduce frequency and discuss support options.' },
    { q: 'Can constipation affect weight?', k: ['constipation weight', 'bowel weight'], a: 'Yes, bowel patterns and water retention can move the scale temporarily. Track digestion and hydration alongside weight so the story is clearer.' },
    { q: 'How do I review weight weekly?', k: ['weekly weight', 'weight review'], a: 'Compare averages, not single days. Note injection timing, protein, hydration, movement, sleep, symptoms, and unusual events like travel or restaurant meals.' },
    { q: 'What if I lose too fast?', k: ['lose too fast', 'rapid weight loss'], a: 'Rapid loss can increase risk of nutrition gaps or muscle loss for some people. Contact your clinician if loss feels too fast, you feel weak, or you struggle to eat and hydrate.' },
    { q: 'What if I am not losing at all?', k: ['not losing', 'no loss', 'stuck at', 'not losing weight', 'wegovy not working', 'mounjaro not working'], a: 'First, do not assume you are failing. If weight is stuck, your body may be maintaining on the current routine. For the next 7 days, log food as honestly as possible, include calories where you can, check protein at each meal, track water, log movement minutes and estimated movement calories, and note constipation, sleep, stress, and medication timing. The calories-in and movement-out numbers are estimates, not a promise, but they help spot patterns. If the trend is still stuck for several weeks, take the logs to your clinician and do not change dose on your own.' },
    { q: 'How do calories in and movement calories help?', k: ['calories in', 'calories out', 'energy balance', 'calorie deficit', 'food calories', 'exercise calories'], a: 'Food calories and movement calories are estimates, but they can make a plateau less mysterious. If food is logged and movement is low, start by adding a short walk or beginner strength routine. If movement is logged but weight is still stuck, check portion estimates, drinks, snacks, sauces, constipation, sleep, and stress. Use the numbers to spot patterns, not to punish yourself.' },
    { q: 'Can strength improve while weight stalls?', k: ['strength improve', 'body composition'], a: 'Yes. Body composition and health habits can improve even when scale movement slows. Track strength, steps, energy, waist/clothing fit, and weekly consistency.' },
    { q: 'How can the coach help with trends?', k: ['trend', 'pattern', 'weight chart'], a: 'The coach can help summarize local tracking patterns and suggest what to review, while leaving medication decisions to your clinician.' },
  ],
  'Reminders & Habits': [
    { q: 'What can I use for free?', k: ['free', 'pro', 'pay', 'cost', 'options'], a: 'You can start with the free Coach setup, common GLP-1 guidance, quick mood check-ins, and support around what to track. Pro is for deeper tracking, personal plans, saved summaries, archives, and clinic-ready review tools. Start free, see what helps, then upgrade only if the deeper tracking is useful for you.' },
    { q: 'Can the coach create reminders?', k: ['create reminder', 'set reminder'], a: 'The coach can draft reminder details, but you stay in control. It should show the title, timing, and type first, then save only after you confirm.' },
    { q: 'What reminders are useful for GLP-1s?', k: ['useful reminders', 'glp1 reminders'], a: 'Common reminders include injection day, hydration, protein, bowel tracking, movement, weekly review, refill planning, and clinician questions.' },
    { q: 'How many reminders should I use?', k: ['too many reminders', 'notification'], a: 'Use the fewest reminders that reduce friction. Too many alerts become background noise. Start with one or two high-value cues.' },
    { q: 'How do I make habits stick?', k: ['habit', 'stick', 'routine'], a: 'Make the habit small, attach it to something you already do, and track completion gently. A habit should feel like a cue, not a scolding.' },
    { q: 'Can I make an injection reminder?', k: ['injection reminder', 'weekly shot'], a: 'Yes. The app can draft a weekly injection reminder. You should verify day, time, and label before it is saved.', r: { title: 'Weekly injection', detail: 'Draft a weekly injection reminder.' } },
    { q: 'Can I make a protein reminder?', k: ['protein reminder'], a: 'Yes. A protein reminder works best around a meal you often miss, such as lunch or afternoon. Confirm timing before it is saved.', r: { title: 'Protein check-in', detail: 'Draft a protein reminder around lunch.' } },
    { q: 'Can I make a hydration reminder?', k: ['hydration reminder', 'water reminder'], a: 'Yes. A simple morning or midday hydration cue can help, especially near injection day or if constipation is active.', r: { title: 'Hydration check-in', detail: 'Draft a daily hydration reminder.' } },
    { q: 'What is a weekly review reminder?', k: ['weekly review reminder'], a: 'A weekly review reminder nudges you to check trends: symptoms, protein, hydration, movement, sleep, weight, and questions for your clinician.', r: { title: 'Weekly GLP-1 review', detail: 'Draft a weekly review reminder.' } },
    { q: 'How do I avoid notification guilt?', k: ['guilt', 'notifications', 'missed reminder'], a: 'Treat reminders as support, not judgment. If one keeps getting ignored, change the timing, make it smaller, or remove it.' },
    { q: 'Can reminders adapt to my routine?', k: ['adapt reminder', 'routine'], a: 'In this local coach version, reminders can be suggested from your chosen routines, but you approve changes. Future versions could use more local pattern matching.' },
  ],
  'Clinician Questions': [
    { q: 'What should I ask my clinician before starting?', k: ['clinician', 'start', 'questions'], a: 'Ask about dosing instructions, missed-dose rules, side effects, red flags, nutrition goals, activity guidance, other medications, and when to follow up.' },
    { q: 'Can the coach give medical advice?', k: ['medical advice', 'doctor'], a: 'No. The coach gives general education and tracking support. It cannot diagnose, prescribe, change dose, or replace your clinician.' },
    { q: 'What symptoms should I report?', k: ['report symptoms', 'side effects'], a: 'Report symptoms that are severe, persistent, new, or concerning, including repeated vomiting, severe abdominal pain, dehydration, fainting, allergic reactions, or major changes from your baseline.' },
    { q: 'How do I prepare for an appointment?', k: ['appointment', 'prepare'], a: 'Bring your current dose schedule, symptom pattern, weight trend, hydration/protein notes, bowel changes, medications/supplements, and your top three questions.' },
    { q: 'Should I ask about dose changes?', k: ['dose change', 'increase dose'], a: 'Yes, ask your prescriber if you have concerns. Do not change dose yourself. Share your side effects, appetite, weight trend, and routine consistency.' },
    { q: 'What should I ask about nausea?', k: ['ask nausea', 'clinician nausea'], a: 'Ask what nausea level is expected, when to seek care, what foods or medicines are safe for you, and whether your timing pattern matters.' },
    { q: 'What should I ask about constipation?', k: ['ask constipation'], a: 'Ask what bowel pattern is acceptable for you, which over-the-counter options are safe, and when constipation becomes urgent.' },
    { q: 'Can I discuss emotional eating?', k: ['emotional eating clinician'], a: 'Yes. Emotional eating, cravings, stress, and body image are valid care topics. Ask about behavioral support, nutrition counseling, or mental health resources if needed.' },
    { q: 'What if I have other medical conditions?', k: ['medical conditions', 'other conditions'], a: 'Use your clinician’s guidance first. Conditions involving digestion, kidneys, heart, diabetes, gallbladder, pancreas, pregnancy, or mental health may change what advice is appropriate.' },
    { q: 'Can the coach make a question list?', k: ['question list', 'doctor list'], a: 'Yes. It can help organize questions from your logs so your appointment is clearer and more efficient.' },
  ],
  'Missed Routines': [
    { q: 'I missed my protein goal. What now?', k: ['missed protein', 'forgot protein'], a: 'Reset at the next meal. One missed goal is data, not failure. Add a simple protein option now or plan one easy anchor for tomorrow.' },
    { q: 'I forgot to drink water all day.', k: ['forgot water', 'missed hydration'], a: 'Start gently now instead of chugging. Take steady sips, choose an easy fluid, and set one realistic cue for tomorrow if it would help.' },
    { q: 'I missed logging yesterday.', k: ['missed logging', 'forgot log'], a: 'You can either add a quick note from memory or let it go. The trend matters more than a perfect record.' },
    { q: 'I missed my exercise routine.', k: ['missed exercise', 'missed workout'], a: 'Restart with the smallest version: two minutes, a short walk, or one set. Momentum beats making up for it.' },
    { q: 'I missed a reminder.', k: ['missed reminder', 'ignored reminder'], a: 'Ask whether the reminder was too early, too late, too vague, or no longer useful. Adjusting it is a win.' },
    { q: 'I had a chaotic week.', k: ['chaotic week', 'bad week'], a: 'Pick one anchor for the next 24 hours: hydration, protein, sleep, or injection routine. A reset does not need to be dramatic.' },
    { q: 'I missed meal prep.', k: ['missed meal prep'], a: 'Use a backup plan: protein shake, eggs, yogurt, soup, rotisserie chicken, tofu, or a simple grocery pickup. Meal prep can restart with one item.' },
    { q: 'I forgot my weekly review.', k: ['missed weekly review'], a: 'Do a two-minute review now: best win, hardest symptom, one habit to keep, one question for your clinician. That is enough.' },
    { q: 'I feel like I failed my routine.', k: ['failed', 'off track'], a: 'Being off routine is normal. The coach approach is to reduce the next step until it is doable. Choose one supportive action, not a punishment.' },
    { q: 'How do I restart after travel?', k: ['restart travel', 'routine after travel'], a: 'Unpack the routine in pieces: hydration today, protein tomorrow, reminders checked, then weekly review. Avoid trying to fix everything at once.' },
  ],
  'Weekly Review': [
    { q: 'What should I review each week?', k: ['weekly review', 'review week'], a: 'Review injection timing, weight trend, protein, hydration, symptoms, bowel habits, movement, sleep, missed routines, wins, and questions for your clinician.' },
    { q: 'How do I spot patterns?', k: ['patterns', 'spot trends'], a: 'Look for repeated links: symptoms after injection, constipation after low fluids, fatigue after low protein, or better days after sleep and movement. Patterns guide experiments.' },
    { q: 'What is a good weekly win?', k: ['weekly win', 'progress'], a: 'A win can be a reminder used, a symptom tracked, a protein anchor added, a walk taken, or a question prepared. It does not have to be scale-based.' },
    { q: 'How do I review side effects?', k: ['weekly side effects'], a: 'Note frequency, intensity, timing, possible triggers, and what helped. Escalate severe or persistent symptoms to your clinician.' },
    { q: 'How do I review protein?', k: ['weekly protein'], a: 'Look for how many days included protein anchors and which meals were hardest. Then choose one simple improvement for the coming week.' },
    { q: 'How do I review hydration?', k: ['weekly hydration'], a: 'Look at fluids, constipation, headaches, dizziness, and injection day. If hydration was low, add one reminder or visible bottle cue.' },
    { q: 'How do I review emotional eating?', k: ['weekly emotional eating'], a: 'Notice triggers without judgment: stress, restriction, fatigue, social meals, or skipped meals. Plan one supportive response for the next similar moment.' },
    { q: 'Should I review restaurant meals?', k: ['weekly eating out'], a: 'Yes if eating out affects symptoms or confidence. Note what felt good, what was too heavy, and what you would order again.' },
    { q: 'Can the coach create a weekly review reminder?', k: ['weekly reminder', 'review reminder'], a: 'Yes. A weekly review reminder can prompt you to check patterns and prepare care-team questions. You confirm before it is saved.', r: { title: 'Weekly review', detail: 'Draft a weekly review reminder.' } },
    { q: 'What should I do after a weekly review?', k: ['after review', 'next week plan'], a: 'Choose one habit to continue, one small adjustment, and one question if needed. Keep next week’s plan light enough to actually do.' },
  ],
  'Emotional Eating': [
    { q: 'What if I eat when stressed?', k: ['stress eating', 'emotional eating'], a: 'Pause and name the need: comfort, rest, distraction, connection, or food. If you still want to eat, choose intentionally and slowly. The goal is awareness, not shame.' },
    { q: 'How do I handle cravings?', k: ['cravings', 'crave'], a: 'Try the delay-and-decide method: wait 10 minutes, drink something, add protein if hungry, then choose a portion intentionally. Cravings often give useful information about stress or restriction.' },
    { q: 'What if I feel guilty after eating?', k: ['guilt eating', 'shame'], a: 'Guilt rarely improves the next choice. Log what happened neutrally, notice the trigger, and pick one supportive action like water, a walk, or a balanced next meal.' },
    { q: 'Can GLP-1s change food noise?', k: ['food noise', 'thoughts food'], a: 'Some people notice less food noise, but stress, sleep, habits, and emotions still matter. Track what situations bring it back.' },
    { q: 'How do I avoid restriction cycles?', k: ['restriction', 'binge', 'cycle'], a: 'Over-restricting can increase cravings or rebound eating. Aim for regular protein, satisfying meals, and flexible choices. If cycles feel intense, consider professional support.' },
    { q: 'What can I do instead of snacking at night?', k: ['night snacking', 'evening eating'], a: 'Check whether you are hungry, tired, stressed, or underfed. A planned protein snack, tea, brushing teeth, or a wind-down routine can help, depending on the cause.' },
    { q: 'How do I manage social pressure around food?', k: ['social pressure', 'family food'], a: 'Use simple scripts: “I’m pacing myself,” “That looks good, I’ll start small,” or “I’m listening to my stomach tonight.” You do not owe a medication explanation.' },
    { q: 'What if I miss comfort foods?', k: ['comfort food', 'miss foods'], a: 'You can keep favorite foods in smaller, more comfortable portions if they fit your plan. Pair them with protein, eat slowly, and notice tolerance.' },
    { q: 'Can the coach help me plan for triggers?', k: ['trigger plan', 'emotional trigger'], a: 'Yes. Pick a likely trigger, a supportive response, and a backup meal or reminder. Planning ahead reduces decision fatigue.' },
    { q: 'When should I get support for emotional eating?', k: ['support emotional eating', 'therapy'], a: 'Seek support if eating feels out of control, causes distress, leads to restriction cycles, or affects daily life. A dietitian, therapist, or clinician can help without judgment.' },
  ],
  'Meal Prep': [
    { q: 'What should I meal prep on GLP-1s?', k: ['meal prep', 'prep food'], a: 'Prep flexible protein anchors, easy vegetables, and gentle carbs. Think chicken, tofu, eggs, yogurt, soup, beans, rice, potatoes, chopped vegetables, and small containers.' },
    { q: 'How do I prep when appetite changes?', k: ['appetite changes', 'prep'], a: 'Avoid huge batches of one meal. Prep mix-and-match pieces so you can build small meals based on how your stomach feels.' },
    { q: 'What are easy protein prep ideas?', k: ['protein prep'], a: 'Cook chicken, boil eggs, portion yogurt, bake tofu, prep tuna packs, make turkey roll-ups, or keep cottage cheese and shakes ready. Convenience matters.' },
    { q: 'How do I prep for nausea days?', k: ['nausea prep'], a: 'Keep gentle options ready: broth, soup, crackers, rice, bananas, yogurt, applesauce, eggs, and electrolyte options if appropriate for you.' },
    { q: 'How do I prep lunches?', k: ['lunch prep'], a: 'Use small lunch boxes with protein first, then a comfortable carb and vegetable. Keep sauces separate if rich flavors trigger nausea.' },
    { q: 'How do I prep breakfast?', k: ['breakfast prep'], a: 'Try overnight oats with protein, egg bites, yogurt cups, cottage cheese bowls, tofu scramble, or smoothie packs. Keep portions modest.' },
    { q: 'What backup foods should I keep?', k: ['backup food', 'pantry'], a: 'Helpful backups include soups, tuna, beans, protein shakes, eggs, yogurt, frozen vegetables, rice cups, tofu, and electrolyte packets if suitable.' },
    { q: 'How do I avoid wasting food?', k: ['waste food', 'leftovers'], a: 'Prep smaller amounts and freeze portions. GLP-1 appetite can vary, so flexible ingredients often waste less than full plated meals.' },
    { q: 'Can meal prep help with side effects?', k: ['meal prep side effects'], a: 'Yes. Having gentle, protein-forward options ready can reduce the chance of skipping meals, overeating later, or choosing foods that trigger symptoms.' },
    { q: 'Can I set a meal prep reminder?', k: ['meal prep reminder'], a: 'Yes. A weekly meal prep reminder can be useful, especially before busy weeks. Confirm the day and time before saving.', r: { title: 'Meal prep reset', detail: 'Draft a weekly meal prep reminder.' } },
  ],
  'Eating Out': [
    { q: 'What should I order at a restaurant?', k: ['restaurant', 'eating out', 'order'], a: 'Look for protein-forward meals with comfortable portions: grilled fish/chicken, tofu, eggs, soups, salads with protein, bowls, or simple sides. Eat slowly and stop at comfortable fullness.' },
    { q: 'How do I avoid overeating out?', k: ['overeating restaurant', 'portion'], a: 'Decide a pace before the meal: start with protein, pause halfway, box leftovers early, and choose what you truly want rather than sampling everything automatically.' },
    { q: 'Are appetizers better than entrees?', k: ['appetizer', 'entree'], a: 'Sometimes. Smaller plates can fit GLP-1 appetite better. Add protein if the appetizer is mostly carbs or fried foods.' },
    { q: 'How do I handle fried food out?', k: ['fried restaurant', 'greasy'], a: 'If fried foods trigger symptoms, choose grilled, steamed, baked, or broth-based options. If you want fried food, try a smaller portion and eat slowly.' },
    { q: 'What about alcohol?', k: ['alcohol', 'drink'], a: 'Alcohol tolerance can change with lower intake and medication routines. Ask your clinician what is safe for you, especially with other conditions or medicines. Avoid alcohol if it worsens nausea, reflux, or judgment around food.' },
    { q: 'How do I eat out with nausea?', k: ['restaurant nausea'], a: 'Keep it simple: soup, lean protein, plain sides, or smaller portions. Avoid arriving overly hungry, and do not feel obligated to finish.' },
    { q: 'Can I eat dessert?', k: ['dessert', 'sweet'], a: 'You can choose dessert intentionally if it fits your plan and tolerance. Smaller portions, sharing, and slow pacing may prevent discomfort.' },
    { q: 'How do I explain eating less?', k: ['explain eating less', 'social'], a: 'Simple phrases work: “I’m pacing myself,” “I’m full but it was good,” or “I’ll take the rest home.” No medical explanation required.' },
    { q: 'What fast food choices are easier?', k: ['fast food'], a: 'Look for grilled protein, chili, salads with protein, broth soups, egg options, or smaller sandwiches. Skip or reduce items that reliably trigger nausea.' },
    { q: 'How do I recover after a heavy meal?', k: ['heavy meal', 'too full'], a: 'Avoid punishment. Sip fluids, take a gentle walk if comfortable, and make the next meal simple. Track what felt too heavy for next time.' },
  ],
  'Side-Effect Tracking': [
    { q: 'What side effects should I track?', k: ['side effects', 'track symptoms'], a: 'Track nausea, vomiting, constipation, diarrhea, reflux, appetite, fatigue, headache, dizziness, injection-site reactions, mood changes, and anything unusual for you.' },
    { q: 'How do I rate nausea?', k: ['rate nausea', 'nausea scale'], a: 'Use a simple 0 to 10 scale, plus timing, food context, injection day, hydration, and what helped. Keep it easy enough to repeat.' },
    { q: 'How do I track constipation?', k: ['track constipation', 'bowel track'], a: 'Track date, comfort, stool pattern, straining, hydration, fiber, movement, and any clinician-approved remedies. Patterns help guide the next conversation.' },
    { q: 'How do I track reflux?', k: ['track reflux', 'heartburn'], a: 'Note timing, meal size, trigger foods, bedtime, symptoms, and what helped. Frequent or painful reflux should be discussed with your clinician.' },
    { q: 'How do I track fatigue?', k: ['track fatigue', 'energy log'], a: 'Log energy level, sleep, protein, hydration, exercise, injection timing, and stress. Repeated fatigue patterns are worth sharing.' },
    { q: 'How do I know if a symptom is serious?', k: ['serious symptom', 'red flag'], a: 'Severe abdominal pain, repeated vomiting, dehydration, fainting, allergic reaction signs, chest pain, shortness of breath, confusion, or symptoms that feel alarming need prompt medical attention.' },
    { q: 'Can the coach summarize side effects?', k: ['summarize side effects'], a: 'A local coach can help organize what you logged into a clear summary for your clinician: what happened, when, how intense, and what helped.' },
    { q: 'Should I track injection-site reactions?', k: ['injection site reaction', 'redness'], a: 'Yes. Note location, size, redness, pain, itching, timing, and whether it improves. Ask your clinician what reactions are expected versus concerning.' },
    { q: 'What if side effects affect eating?', k: ['side effects eating', 'cannot eat'], a: 'Track how side effects change intake and hydration. If you cannot eat or drink enough, or symptoms persist, contact your clinician.' },
    { q: 'Can I set a symptom check reminder?', k: ['symptom reminder', 'side effect reminder'], a: 'Yes. A simple daily or post-injection symptom check can make clinician conversations clearer. You confirm before saving.', r: { title: 'Symptom check', detail: 'Draft a side-effect tracking reminder.' } },
  ],
};

function toId(category: CoachCategory, index: number): string {
  return `${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index + 1}`;
}

export const coachLibrary: readonly CoachEntry[] = Object.entries(seeds).flatMap(
  ([category, entries]) =>
    entries.map((entry, index) => ({
      id: toId(category as CoachCategory, index),
      category: category as CoachCategory,
      question: entry.q,
      keywords: entry.k,
      answer: entry.a,
      followUps: followUpsByCategory[category as CoachCategory],
      reminder: entry.r,
    }))
);

export const coachCategories = Object.keys(seeds) as CoachCategory[];
