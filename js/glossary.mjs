/**
 * House of Figs glossary.
 *
 * Each entry has:
 *   - term:        the canonical word/phrase (used as the data-term attr)
 *   - definition:  plain-language explanation, House of Figs voice
 *   - illustration: (optional) URL to an image — leave empty until added
 *
 * To add a new term:
 *   1. Add an entry here
 *   2. In the page HTML, wrap the word: <button class="define-term" data-term="key">word</button>
 *
 * The tooltip system handles the rest. Keep definitions short, warm, and
 * jargon-free — these are seen by people who are likely overwhelmed.
 */

export const GLOSSARY = {

  'inflammation': {
    term: 'Inflammation',
    definition: "Your body's natural response to injury, infection, or irritation. Short-term (acute) inflammation is healing. When it becomes chronic — always running in the background — it can show up as fatigue, joint pain, skin issues, digestive problems, or brain fog.",
    illustration: ''
  },

  'hormonal': {
    term: 'Hormonal',
    definition: "Anything related to your hormones — the body's chemical messengers that control mood, energy, sleep, metabolism, fertility, and stress response. \"Hormonal shifts\" often refer to changes during menstruation, pregnancy, perimenopause, or stressful seasons.",
    illustration: ''
  },

  'gut-health': {
    term: 'Gut health',
    definition: 'The overall function of your digestive system — how well you break down food, absorb nutrients, and eliminate waste. It also includes the trillions of microbes (the microbiome) living in your gut, which influence everything from your immune system to your mood.',
    illustration: ''
  },

  'microbiome': {
    term: 'Microbiome',
    definition: "The trillions of bacteria, fungi, and other tiny organisms that live primarily in your gut. A balanced microbiome supports digestion, immunity, mood, and even hormone metabolism. It's like a garden — what you feed it shapes how it grows.",
    illustration: ''
  },

  'adrenal': {
    term: 'Adrenal',
    definition: "Your adrenal glands sit on top of your kidneys and produce stress hormones like cortisol. When you're constantly under stress, the adrenals work overtime, which can lead to feeling \"wired but tired,\" energy crashes, poor sleep, and difficulty handling pressure.",
    illustration: ''
  },

  'cortisol': {
    term: 'Cortisol',
    definition: 'Your primary stress hormone. It naturally rises in the morning (waking you up) and falls at night (helping you sleep). Chronic stress keeps cortisol elevated, which can disrupt sleep, blood sugar, weight, and immune function.',
    illustration: ''
  },

  'detox': {
    term: 'Detox / detoxification',
    definition: "Your body's natural process of neutralizing and removing waste, primarily through the liver, kidneys, gut, lungs, and skin. \"Supporting detox\" doesn't mean a juice cleanse — it means giving these systems the nutrients and rest they need to do their job.",
    illustration: ''
  },

  'estrogen-metabolism': {
    term: 'Estrogen metabolism',
    definition: "How your body processes and clears estrogen, primarily through the liver and gut. When this process is sluggish, estrogen can recirculate and contribute to PMS, painful periods, breast tenderness, mood swings, or other hormone-related symptoms.",
    illustration: ''
  },

  'functional-nutrition': {
    term: 'Functional nutrition',
    definition: "An approach to food and health that looks at the whole picture — your body, your story, your environment — and uses nutrition to support the root cause of how you feel, not just the symptoms.",
    illustration: ''
  },

  'whole-foods': {
    term: 'Whole foods',
    definition: "Foods that are as close to their natural state as possible — fruits, vegetables, whole grains, beans, nuts, seeds, eggs, fish, meat — rather than packaged, processed, or refined products.",
    illustration: ''
  },

  'blood-sugar': {
    term: 'Blood sugar',
    definition: "The amount of glucose (sugar) in your blood at any given time. It rises after you eat and falls between meals. When blood sugar swings dramatically — high then low — you can feel shaky, irritable, exhausted, or crave sweets and caffeine.",
    illustration: ''
  },

  'autoimmune': {
    term: 'Autoimmune',
    definition: "A condition where your immune system mistakenly attacks your own tissues. Examples include Hashimoto's (thyroid), rheumatoid arthritis (joints), and celiac disease (gut). They often run in families and can be influenced by stress, diet, and gut health.",
    illustration: ''
  },

  'pcos': {
    term: 'PCOS',
    definition: 'Polycystic Ovary Syndrome — a common hormonal condition that can cause irregular periods, weight changes, acne, excess hair growth, or fertility challenges. It often involves insulin and androgen imbalances.',
    illustration: ''
  },

  'ibs': {
    term: 'IBS',
    definition: "Irritable Bowel Syndrome — a group of digestive symptoms (bloating, cramping, diarrhea, constipation, or both) that don't show structural damage on tests. Often linked to stress, food sensitivities, and gut microbiome imbalances.",
    illustration: ''
  },

  'thyroid': {
    term: 'Thyroid',
    definition: 'A butterfly-shaped gland in your neck that regulates your metabolism — how fast you burn energy. When it\'s underactive (hypothyroid), you may feel cold, tired, or gain weight. Overactive (hyperthyroid) can cause anxiety, racing heart, or weight loss.',
    illustration: ''
  },

  'nervous-system': {
    term: 'Nervous system',
    definition: "Your body's communication and control network. The part most relevant to wellness is the autonomic nervous system, which has a \"fight or flight\" mode (sympathetic) and a \"rest and digest\" mode (parasympathetic). Modern life often keeps us stuck in fight-or-flight.",
    illustration: ''
  },

  'parasympathetic': {
    term: 'Parasympathetic',
    definition: "The \"rest, digest, and heal\" branch of your nervous system. It's what allows your body to recover, digest food properly, sleep deeply, and feel calm. Practices like deep breathing, slow meals, time in nature, and gentle movement activate it.",
    illustration: ''
  },

  'cycle': {
    term: 'Cycle',
    definition: 'Short for menstrual cycle — the recurring hormonal pattern that includes menstruation, follicular phase, ovulation, and luteal phase. A "regular" cycle is anywhere from 21 to 35 days. Tracking it can reveal patterns in energy, mood, sleep, and skin.',
    illustration: ''
  },

  'perimenopause': {
    term: 'Perimenopause',
    definition: 'The transition into menopause, often starting in the late 30s or 40s. Hormones fluctuate dramatically, which can cause irregular periods, sleep changes, mood shifts, hot flashes, brain fog, or weight changes — sometimes years before periods actually stop.',
    illustration: ''
  },

  'whole-person': {
    term: 'Whole-person',
    definition: 'An approach to wellness that considers not just what you eat, but how you sleep, move, manage stress, connect with others, and feel emotionally and spiritually — because all of these shape your health together.',
    illustration: ''
  }

};
