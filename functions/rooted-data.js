/**
 * House of Figs — Rooted Assessment data tables.
 *
 * Source of truth: the Developer Handoff Brief (July 2026) and the
 * Practitioner Companion. These tables ARE the method — edit only when
 * Bethany's source documents change.
 */

// ---- The nine color families ----------------------------------------
// Order matters: it is the canonical display order everywhere.
const COLOR_FAMILIES = [
  'red', 'orange', 'yellow', 'green', 'greenwhite',
  'white', 'blue', 'purple', 'brown'
];

const COLOR_LABELS = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  greenwhite: 'Green-White',
  white: 'White',
  blue: 'Blue',
  purple: 'Purple',
  brown: 'Brown'
};

// Intake field name (as stored on the Firestore intake doc) per family.
const COLOR_FIELDS = {
  red: 'Red symptoms',
  orange: 'Orange symptoms',
  yellow: 'Yellow symptoms',
  green: 'Green symptoms',
  greenwhite: 'Green-white symptoms',
  white: 'White symptoms',
  blue: 'Blue symptoms',
  purple: 'Purple symptoms',
  brown: 'Brown symptoms'
};

// ---- Full-intake symptom checklists (10–12 per family) ---------------
// Extracted from Forms/HOF Intake.docx (the authoritative full form).
const SYMPTOM_LISTS = {
  red: [
    'Persistent joint pain or body aches',
    'Chronic low-grade inflammation flares',
    'Skin redness, rosacea, or flushing',
    'Known fatty liver or elevated liver enzymes',
    'Elevated cholesterol or blood pressure history',
    'Poor exercise recovery',
    'Family history of heart disease or stroke',
    'Frequent headaches or migraines',
    'Slow wound healing or easy bruising',
    'Skin that damages easily in the sun'
  ],
  orange: [
    'More than 3–4 colds or infections per year',
    'Frequent respiratory or sinus issues',
    'Dry skin or keratosis pilaris (bumps on arms)',
    'Slow healing of minor cuts or rashes',
    'Dry or irritated eyes, poor night vision',
    'Easily catches what others have',
    'Acne, eczema, or skin barrier issues',
    'Weakened nails or hair',
    'Signs of leaky gut or food sensitivities',
    'Poor recovery after illness'
  ],
  yellow: [
    'Chronic stress, overwhelm, or burnout',
    'Energy crashes between 2–4 pm',
    'Bleeding gums or gum sensitivity',
    'Cravings for salty or sugary foods',
    'Easy bruising without clear cause',
    'Low iron despite supplementation',
    'Stretch marks or easily-tearing skin',
    'Frequent viral illnesses',
    'Morning fatigue despite adequate sleep',
    'Dizziness when standing quickly'
  ],
  green: [
    'Persistent fatigue or weakness',
    'Cold hands and feet',
    'Heavy or painful menstrual cycles',
    'Numbness or tingling in extremities',
    'Restless legs, especially at night',
    'Low mood, anxiety, or irritability',
    'Hair thinning or increased shedding',
    'Shortness of breath with mild exertion',
    'Pale skin, lips, or inner eyelids',
    'Poor bone density or family osteoporosis',
    'Brittle nails or ridging',
    'Muscle twitches or spasms'
  ],
  greenwhite: [
    'Heavy periods or severe PMS',
    'Slow to metabolize caffeine or alcohol',
    'Breast tenderness (cyclical or constant)',
    'Acne along jaw or chin',
    'Fibrocystic breasts',
    'Estrogen-dominance symptoms (bloat, mood swings)',
    'Uterine fibroids or endometriosis',
    'Long history of oral contraceptive use',
    'Family history of hormone-related cancers',
    'Difficulty detoxing from illness or medication',
    'Sensitivity to environmental chemicals/fragrances'
  ],
  white: [
    'Seasonal or environmental allergies',
    'Cold hands and feet, poor circulation',
    'Histamine reactions (flushing, hives, itching)',
    'Strong reactions to fermented foods or wine',
    'Food sensitivities that fluctuate',
    'Recurring UTIs or yeast infections',
    'Chronic sinus congestion or post-nasal drip',
    'Body odor changes or halitosis',
    'Bloating soon after eating',
    'Frequent need for antihistamines',
    'Signs of gut dysbiosis or yeast overgrowth'
  ],
  blue: [
    'Brain fog or difficulty concentrating',
    'Weight gain around the midsection',
    'Memory lapses or word-finding issues',
    'Family history of cognitive decline',
    'Blood sugar crashes or shakiness',
    'Mood swings tied to eating patterns',
    'Strong afternoon energy dip',
    'Poor recovery from mental fatigue',
    'Intense sugar or carb cravings',
    'Wakes between 2–4 am and cannot return to sleep',
    'Irritability when meals are delayed'
  ],
  purple: [
    'Irregular or absent menstrual cycles',
    'Puffiness, water retention, or poor lymphatic flow',
    'Symptoms of perimenopause or menopause',
    'Slow recovery from workouts or illness',
    'Low libido or hormonal shifts',
    'Premature aging signs (skin, hair, energy)',
    'Low energy despite adequate sleep',
    'Weight changes without dietary change',
    'Mood swings or emotional volatility',
    'Thinning or loss of outer eyebrow edge',
    'Temperature dysregulation (hot flashes, cold intolerance)'
  ],
  brown: [
    'Constipation (fewer than 1 bowel movement daily)',
    'Feeling heavy or sluggish after eating',
    'Muscle cramps, especially at night',
    'Poor tolerance of fats or dense foods',
    'Restless sleep or difficulty falling asleep',
    'Eye twitches or muscle tremors',
    'Anxiety or feeling "wired but tired"',
    'Heart palpitations (especially with stress)',
    'Tension headaches or tight jaw/shoulders',
    'Sluggish elimination or sense of "toxic buildup"',
    'Sugar cravings after meals',
    'Slow morning energy and digestion'
  ]
};

// ---- Multi-cluster pattern lookup (Companion §4 / Brief Q1 step 2) ----
const PATTERNS = [
  {
    key: 'cardiometabolic',
    name: 'Cardiometabolic / insulin resistance',
    colors: ['red', 'blue', 'brown'],
    whereToBegin: 'Stabilize blood sugar first, then layer anti-inflammatory color.'
  },
  {
    key: 'anemia-adrenal',
    name: 'Anemia + adrenal burnout',
    colors: ['green', 'yellow'],
    whereToBegin: 'Mineral repletion and cortisol-smoothing rhythm, treated in parallel.'
  },
  {
    key: 'estrogen-dominance',
    name: 'Estrogen dominance / hormonal overload',
    colors: ['greenwhite', 'purple'],
    whereToBegin: 'Cruciferous daily; hormone support only after labs.'
  },
  {
    key: 'gut-immune',
    name: 'Gut / immune / microbiome',
    colors: ['orange', 'white', 'brown'],
    whereToBegin: 'Gut repair first — before any hormone or detox work.'
  },
  {
    key: 'hpa-axis',
    name: 'HPA-axis dysregulation',
    colors: ['yellow', 'blue', 'brown'],
    whereToBegin: 'Protein breakfast within the hour; no caffeine after noon.'
  },
  {
    key: 'inflammation-detox',
    name: 'Inflammation + detox impairment',
    colors: ['red', 'greenwhite'],
    whereToBegin: 'Anti-inflammatory baseline plus cruciferous support.'
  },
  {
    key: 'brain-gut',
    name: 'Brain-gut axis',
    colors: ['blue', 'white', 'brown'],
    whereToBegin: 'Stable fuel every few hours, gut support, calming rhythms.'
  }
];

// ---- Color → juiceable ingredient map (Brief Q2) ----------------------
const POUR_MAP = {
  green: 'Spinach or kale, cucumber, celery',
  yellow: 'Lemon (light); a little pineapple — watch sugar',
  orange: 'Carrot, ginger, turmeric; a little mango — watch sugar',
  red: 'Tart cherry, a splash of pomegranate, tomato (savory), watermelon',
  purple: 'Beet, a little purple cabbage, a few black grapes',
  blue: 'Wild blueberries, blackberries (a small handful)',
  greenwhite: 'A little cabbage or broccoli — strong flavor, use sparingly',
  white: 'Minimal; skip raw entirely if histamine-reactive',
  brown: null // Brown never juices — stays on the plate
};

// ---- Client-facing Color Voice Library (Companion §8) -----------------
// Used to seed the plan-drafting prompt; never shown raw to the client.
const COLOR_VOICE = {
  red: {
    title: 'Restore & Protect',
    saying: 'Aches, inflammation, a heart and recovery that want tending',
    leanInto: 'Cooked tomato, watermelon, tart cherries, red pepper, pomegranate'
  },
  orange: {
    title: 'Strengthen & Defend',
    saying: 'Frequent colds, dry skin, a gut lining asking for support',
    leanInto: 'Sweet potato, cooked carrots, pumpkin, turmeric, mango'
  },
  yellow: {
    title: 'Cleanse & Energize',
    saying: 'Stress and burnout, the afternoon crash, mornings that start tired',
    leanInto: 'Lemon with zest, papaya, pineapple, yellow pepper, grapefruit'
  },
  green: {
    title: 'Build & Nourish',
    saying: 'Tiredness, low mood, a body asking to rebuild its blood and bones',
    leanInto: 'Spinach, kale, collards, chard, moringa'
  },
  greenwhite: {
    title: 'Detox & Shield',
    saying: 'Heavy or tender cycles, a body working to clear what it does not need',
    leanInto: 'Broccoli sprouts, Brussels sprouts, cabbage, bok choy, watercress'
  },
  white: {
    title: 'Purify & Heal',
    saying: 'Allergies, histamine flares, circulation and a gut wanting balance',
    leanInto: 'Garlic, onion, leek, asparagus, shallot (gentle/cooked first if reactive)'
  },
  blue: {
    title: 'Protect & Restore',
    saying: 'Brain fog, blood-sugar dips, a mind wanting steadiness',
    leanInto: 'Wild blueberries, blackberries, Concord grapes, plums'
  },
  purple: {
    title: 'Balance & Renew',
    saying: 'Hormonal shifts, low energy, rhythms that have dimmed',
    leanInto: 'Beets, red cabbage, figs, eggplant, black grapes'
  },
  brown: {
    title: 'Ground & Sustain',
    saying: 'Sluggish digestion, cramps, wired-but-tired nights',
    leanInto: 'Oats, lentils, black beans, quinoa, flax'
  }
};

// ---- The one food gift per color (Consult Talking Track) --------------
// Pre-written suggestions for the prep sheet — one small, genuinely
// useful shift tied to the loudest color. Bethany edits before the call.
const FOOD_GIFTS = {
  red: 'a small bowl of tart cherries alongside breakfast, most days this week',
  orange: 'roasted sweet potato with dinner a few nights this week',
  yellow: 'warm water with fresh lemon (zest and all) to start the morning',
  green: 'a generous handful of spinach blended into a morning glass, most days this week',
  greenwhite: 'a handful of broccoli or shredded cabbage added to one meal a day',
  white: 'cooked onions or garlic folded into dinner most nights this week',
  blue: 'a small handful of wild blueberries with breakfast, most days this week',
  purple: 'roasted beets alongside one meal, a few times this week',
  brown: 'a warm bowl of oats or a spoonful of lentils at one meal a day'
};

// ---- The fixed 30-day arc (Brief Q4) ----------------------------------
const WEEK_THEMES = [
  { week: 1, name: 'Roots', focus: 'Hydration + a real morning meal' },
  { week: 2, name: 'Steady Ground', focus: 'The steady plate; gentle movement' },
  { week: 3, name: 'Tending Rhythms', focus: 'Stress + sleep rhythms' },
  { week: 4, name: 'Fruit & Forward', focus: 'Integration into a keepable rhythm' }
];

// ---- Condition-aware adjustments (Brief Q1 step 4 / Companion §5) -----
// Matched against free-text conditions/medications/allergies fields.
const CONDITION_RULES = [
  {
    key: 'gallbladder',
    match: /gall\s?bladder|gallstone|cholecystectomy/i,
    adjustment: 'Gentle, spread-out fats; smaller regular meals; adequate fiber + water. No fasting, time-restricted eating, or rapid weight loss.'
  },
  {
    key: 'histamine',
    match: /histamine|hives|urticaria|mast cell/i,
    adjustment: 'Keep raw alliums (White) out of the pour; low-histamine start.'
  },
  {
    key: 'migraine',
    match: /migraine/i,
    adjustment: 'Hydration and regular-meal anchors; watch common trigger foods.'
  },
  {
    key: 'diabetes',
    match: /diabet|blood sugar|insulin|a1c|prediabet/i,
    adjustment: 'Vegetable-forward pour; cut liquid sugars first; blood-sugar-steady plate.'
  },
  {
    key: 'anemia',
    match: /anemi|low iron|iron deficien/i,
    adjustment: 'Diagnosed anemia anchors Green regardless of tally; iron-supportive foods with Vitamin C pairing.',
    anchorsColor: 'green'
  },
  {
    key: 'clotting',
    match: /clot|coagul|warfarin|coumadin|eliquis|xarelto/i,
    adjustment: 'MD sign-off; never frame food as a clotting intervention. If on anticoagulants, keep vitamin-K intake consistent — physician-led.'
  },
  {
    key: 'asthma',
    match: /asthma/i,
    adjustment: 'Awareness only; anti-inflammatory, gentle. No restriction needed.'
  },
  {
    key: 'thyroid',
    match: /thyroid|hashimoto|hypothyroid|hyperthyroid/i,
    adjustment: 'Physician-led condition; food supports but never replaces management. Note goitrogen moderation only if advised by their MD.'
  }
];

// ---- Hard stops (Brief Q5 Tier 3) --------------------------------------
// Any of these halts the pipeline: nothing client-facing may generate.
const RED_FLAG_SYMPTOMS = [
  'Chest pain or pressure',
  'Shortness of breath at rest',
  'Fainting or near-fainting',
  'Unexplained weight loss',
  'Blood in stool or urine',
  'Severe or progressive pain',
  'Abnormal or unusually heavy bleeding'
];

// SCOFF-style disordered-eating screen (Companion §5).
// Stored on the intake as 'Relationship with food' answers.
const EATING_SCREEN_QUESTIONS = [
  { key: 'sick', text: 'Do you ever feel uncomfortably full to the point of feeling sick after eating?' },
  { key: 'control', text: 'Do you ever feel a loss of control over how much you eat?' },
  { key: 'weightChange', text: 'Have you had a significant weight change (up or down) in the last 3 months?' },
  { key: 'bodyImage', text: 'Do you feel dissatisfied with your body even when others say you look fine?' },
  { key: 'dominates', text: 'Does food, eating, or your body occupy a large part of your daily thoughts?' }
];

// Two-audience leak check: none of these may appear in a client document.
const LEAK_TERMS = [
  // labs & panels
  'CBC', 'ferritin', 'TIBC', 'HbA1c', 'A1c', 'hs-CRP', 'CRP', 'TSH', 'ApoB',
  'Lp(a)', 'ALT', 'AST', 'DUTCH', 'estradiol', 'progesterone', 'FSH',
  'RBC magnesium', 'iron panel', 'lab panel', 'bloodwork panel', 'thyroid panel',
  'hormone panel', 'fasting glucose',
  // supplements & dosing
  'supplement', 'mg ', ' mcg', ' IU', 'dose', 'dosage', 'capsule',
  // clinical pattern terms
  'insulin resistance', 'estrogen dominance', 'HPA-axis', 'HPA axis',
  'dysregulation', 'cardiometabolic', 'microbiome', 'dysbiosis',
  'adrenal', 'cortisol', 'functional range', 'optimal range', 'referral',
  'disordered eating', 'SCOFF', 'diagnosis', 'clinical',
  // Gate C additions (Client Journey briefing): no calorie/macro targets
  // or appearance-based goal language in client-facing output.
  'calorie', 'calories', 'macro', 'macros', 'kcal', 'BMI',
  'weight target', 'goal weight', 'pounds to lose'
];

module.exports = {
  COLOR_FAMILIES,
  COLOR_LABELS,
  COLOR_FIELDS,
  SYMPTOM_LISTS,
  PATTERNS,
  POUR_MAP,
  COLOR_VOICE,
  FOOD_GIFTS,
  WEEK_THEMES,
  CONDITION_RULES,
  RED_FLAG_SYMPTOMS,
  EATING_SCREEN_QUESTIONS,
  LEAK_TERMS
};
