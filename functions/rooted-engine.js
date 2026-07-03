/**
 * House of Figs — Rooted Assessment rules engine.
 *
 * Deterministic implementation of the Developer Handoff Brief:
 *   tally → flags/tiers → pattern candidates → priority sequencing
 *   → safety screen → pour composition → four-week color emphases.
 *
 * The engine runs in a fixed order (tally, pattern, priority, safety per
 * the brief — with safety able to override or HALT everything). It is a
 * pure function of the intake document: no I/O, no clock, no randomness,
 * so it can be unit-tested and re-run idempotently.
 *
 * IMPORTANT (Tier boundaries, Brief Q5):
 *   - The output of this engine is PRACTITIONER-SIDE material (Tier 1).
 *   - Client-facing documents are drafted elsewhere and gated on review.
 *   - If `halted` is true, NOTHING client-facing may be generated.
 */

const {
  COLOR_FAMILIES,
  COLOR_LABELS,
  COLOR_FIELDS,
  PATTERNS,
  POUR_MAP,
  WEEK_THEMES,
  CONDITION_RULES,
  RED_FLAG_SYMPTOMS,
  EATING_SCREEN_QUESTIONS
} = require('./rooted-data');

// ======================================================================
// Helpers
// ======================================================================

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  // Firestore intake stores multi-checkbox fields as comma-joined strings
  // in some paths; split defensively.
  if (typeof v === 'string') return v.split(/\s*[;\n]\s*|,\s(?=[A-Z0-9])/).filter(Boolean);
  return [v];
}

function textOf(intake, keys) {
  for (const k of keys) {
    if (intake[k] != null && intake[k] !== '') return String(intake[k]);
  }
  return '';
}

// ======================================================================
// Step 1 — Tally each color family
// ======================================================================

/**
 * @param {object} intake  raw intake doc
 * @param {'full'|'quickstart'} formType
 * @returns {object} tally keyed by family:
 *   { checked, items, tier, flag, lean, anchored, selfId }
 */
function tallyColors(intake, formType, anchoredColors, selfIdColors) {
  const tally = {};
  for (const fam of COLOR_FAMILIES) {
    const items = asArray(intake[COLOR_FIELDS[fam]]);
    const n = items.length;
    let tier = 0;
    let flag = false;
    let lean = false;

    if (formType === 'full') {
      // Full intake: 3+ = flagged. Tier 1 = 3–4, Tier 2 = 5–7, Tier 3 = 8+.
      if (n >= 8) { tier = 3; flag = true; }
      else if (n >= 5) { tier = 2; flag = true; }
      else if (n >= 3) { tier = 1; flag = true; }
    } else {
      // Quick-Start (~4 items/color): 3-of-4 hard flag, 2-of-4 soft lean.
      // Tiers 2–3 unreachable; self-ID standout weighted heavily instead.
      if (n >= 3) { tier = 1; flag = true; }
      else if (n === 2) { lean = true; }
    }

    tally[fam] = {
      color: fam,
      label: COLOR_LABELS[fam],
      checked: n,
      items,
      tier,
      flag,
      lean,
      anchored: anchoredColors.has(fam),
      selfId: selfIdColors.has(fam)
    };
  }
  return tally;
}

// ======================================================================
// Step 2 — Pattern recognition (lookup table)
// ======================================================================

/**
 * A pattern component "qualifies" when its family is flagged, leaning,
 * anchored by a diagnosed condition, or self-identified. Candidates are
 * scored so Bethany sees the strongest picture first:
 *   flag = 2, anchored = 1.5, lean = 1, self-ID adds +0.5.
 *
 * Quick-scan nuance (Companion §2): with only ~4 items per color a single
 * checked item is real signal, so on a quick-scan it counts as a "trace"
 * (0.5) — but a candidate still needs at least one lean-or-better
 * component so traces alone never name a pattern. Emily Belt's worked
 * example (Green-White lean + Purple ×1 → estrogen-dominance lean) is the
 * calibration point for this rule.
 */
function findPatterns(tally, formType) {
  const quick = formType === 'quickstart';
  const candidates = [];
  for (const p of PATTERNS) {
    let score = 0;
    let qualifies = true;
    let hasAnchorComponent = false;
    const evidence = [];
    for (const fam of p.colors) {
      const t = tally[fam];
      let famScore = Math.max(
        t.flag ? 2 : 0,
        t.anchored ? 1.5 : 0,
        t.lean ? 1 : 0
      );
      if (famScore >= 1) hasAnchorComponent = true;
      if (famScore === 0 && quick && t.checked >= 1) famScore = 0.5; // trace
      famScore += (t.selfId ? 0.5 : 0);
      if (famScore === 0) { qualifies = false; break; }
      score += famScore;
      const why = [];
      if (t.flag) why.push(`flagged (${t.checked} checked, Tier ${t.tier})`);
      else if (t.lean) why.push(`soft lean (${t.checked} checked)`);
      else if (t.checked >= 1) why.push(`trace (${t.checked} checked)`);
      if (t.anchored) why.push('anchored by diagnosed condition');
      if (t.selfId) why.push('self-identified standout');
      evidence.push(`${t.label}: ${why.join(', ')}`);
    }
    if (!qualifies || !hasAnchorComponent) continue;
    // Threshold: full intake must average lean-strength; quick-scan runs
    // at 0.75× so lean+trace combinations (the worked example) qualify.
    const threshold = p.colors.length * (quick ? 0.75 : 1);
    if (score < threshold) continue;
    const allFlagged = p.colors.every(f => tally[f].flag || tally[f].anchored);
    candidates.push({
      key: p.key,
      name: p.name,
      colors: p.colors,
      whereToBegin: p.whereToBegin,
      strength: allFlagged ? 'firm' : 'lean',
      score: Math.round(score * 10) / 10,
      evidence
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// ======================================================================
// Step 3 — Priority sequencing
// ======================================================================

/**
 * Orders the flagged/leaning families into 2–3 priority systems using the
 * brief's sequencing rules. Returns ordered priorities with rationale.
 */
function sequencePriorities(tally, patterns) {
  const active = COLOR_FAMILIES.filter(f =>
    tally[f].flag || tally[f].lean || tally[f].anchored || tally[f].selfId
  );

  // Scoring for initial order: strength first.
  const base = {};
  for (const f of active) {
    const t = tally[f];
    base[f] =
      (t.flag ? 4 : 0) + (t.anchored ? 3 : 0) + (t.lean ? 2 : 0) +
      (t.selfId ? 2 : 0) + t.checked * 0.1;
  }

  // Foundation-first: Green and Brown before specialty systems.
  for (const f of ['green', 'brown']) {
    if (base[f] != null) base[f] += 1.5;
  }

  let ordered = active.slice().sort((a, b) => base[b] - base[a]);

  const rules = [];

  // Digestion before hormones: White/Brown precede Green-White/Purple.
  const gut = ordered.filter(f => f === 'white' || f === 'brown');
  const hormonal = ordered.filter(f => f === 'greenwhite' || f === 'purple');
  if (gut.length && hormonal.length) {
    const firstGut = Math.min(...gut.map(f => ordered.indexOf(f)));
    const firstHorm = Math.min(...hormonal.map(f => ordered.indexOf(f)));
    if (firstHorm < firstGut) {
      ordered = ordered.filter(f => !hormonal.includes(f)).concat(hormonal);
      rules.push('Digestion before hormones — gut work precedes hormone work.');
    } else {
      rules.push('Digestion before hormones holds (gut already precedes hormonal colors).');
    }
  }

  // Inflammation first: Red/Blue quenched before detox or hormone work.
  const inflam = ordered.filter(f => f === 'red' || f === 'blue');
  const detoxHorm = ordered.filter(f => ['greenwhite', 'purple', 'white'].includes(f));
  if (inflam.length && detoxHorm.length) {
    const firstInf = Math.min(...inflam.map(f => ordered.indexOf(f)));
    const firstDH = Math.min(...detoxHorm.map(f => ordered.indexOf(f)));
    if (firstDH < firstInf) {
      // pull inflammation colors ahead of detox/hormone colors
      ordered = ordered.filter(f => !inflam.includes(f));
      ordered.splice(firstDH, 0, ...inflam);
      rules.push('Inflammation first — quench inflammation before detox or hormone work.');
    }
  }

  const priorities = ordered.map(f => ({
    color: f,
    label: COLOR_LABELS[f],
    why: [
      tally[f].anchored ? 'diagnosed-condition anchor' : null,
      tally[f].flag ? `hard flag (${tally[f].checked} checked)` : null,
      tally[f].lean ? `soft lean (${tally[f].checked} checked)` : null,
      tally[f].selfId ? 'self-identified standout' : null,
      (f === 'green' || f === 'brown') ? 'foundation-first weighting' : null
    ].filter(Boolean).join('; ')
  }));

  return { priorities, sequencingRules: rules };
}

// ======================================================================
// Step 4 — Safety screen (overrides everything; can HALT)
// ======================================================================

function runSafetyScreen(intake) {
  const conditionsText = [
    textOf(intake, ['Diagnosed conditions']),
    textOf(intake, ['Family health patterns']),
    textOf(intake, ['Medications and supplements']),
    textOf(intake, ['Food allergies and sensitivities']),
    textOf(intake, ['Anything else important'])
  ].join(' \n ');

  const adjustments = [];
  const anchoredColors = new Set();
  for (const rule of CONDITION_RULES) {
    // Family-history matches soften: only "anemia" style anchors need a
    // personal diagnosis, so match against personal conditions first.
    if (rule.match.test(conditionsText)) {
      adjustments.push({ key: rule.key, note: rule.adjustment });
      if (rule.anchorsColor &&
          rule.match.test(textOf(intake, ['Diagnosed conditions']))) {
        anchoredColors.add(rule.anchorsColor);
      }
    }
  }

  // ---- Hard stops (Tier 3) ----
  const haltReasons = [];

  // Pregnancy
  const pregnancyAnswer = textOf(intake, ['Pregnancy status', 'Pregnant']);
  if (/yes|pregnant|expecting|trying/i.test(pregnancyAnswer)) {
    haltReasons.push('Pregnancy (or trying) — physician-led care takes precedence.');
  }

  // Red-flag symptoms (from the intake's safety checklist)
  const redFlags = asArray(intake['Red flag symptoms']);
  if (redFlags.length > 0) {
    haltReasons.push(`Red-flag symptom(s) reported: ${redFlags.join('; ')}.`);
  }

  // Disordered-eating screen — positive OR incomplete halts the pipeline.
  const screen = {};
  let answered = 0;
  let concerning = 0;
  for (const q of EATING_SCREEN_QUESTIONS) {
    const v = textOf(intake, [`Relationship with food: ${q.key}`, q.key]);
    screen[q.key] = v || null;
    if (v) {
      answered++;
      if (/yes/i.test(v)) concerning++;
    }
  }
  if (answered < EATING_SCREEN_QUESTIONS.length) {
    haltReasons.push(
      `Relationship-with-food screen incomplete (${answered}/${EATING_SCREEN_QUESTIONS.length} answered) — complete at consult before any plan generates.`
    );
  } else if (concerning >= 2) {
    haltReasons.push(
      'Relationship-with-food screen positive — the outcome is a referral and a supportive conversation, never a restrictive plan.'
    );
  }

  return {
    adjustments,
    anchoredColors,
    eatingScreen: { answered, concerning, answers: screen },
    redFlags,
    halted: haltReasons.length > 0,
    haltReasons
  };
}

// ======================================================================
// Pour composition (Brief Q2)
// ======================================================================

function composePour(priorityColors, safety) {
  const histamine = safety.adjustments.some(a => a.key === 'histamine');
  const bloodSugar = safety.adjustments.some(a => a.key === 'diabetes');

  const colors = [];
  const ingredients = {};
  const notes = [];

  for (const f of priorityColors) {
    if (f === 'brown') { notes.push('Brown never juices — it stays on the plate (oats, lentils, quinoa at meals).'); continue; }
    if (f === 'white' && histamine) { notes.push('White skipped raw entirely — histamine-reactive.'); continue; }
    if (!POUR_MAP[f]) continue;
    colors.push(f);
    ingredients[f] = POUR_MAP[f];
  }

  notes.push('Vegetable-forward, blended not strained — the fiber stays in.');
  notes.push('Fruit kept modest — sweetness is an accent, never the base.');
  notes.push('Additive, with food — never framed as a cleanse, detox, or meal replacement.');
  if (bloodSugar) notes.push('Blood-sugar tune: extra vegetable-forward; cut liquid sugars first.');
  if (colors.includes('purple')) notes.push('Beet in the glass → include the friendly beeturia note in the client plan.');

  return { colors, ingredients, notes };
}

// ======================================================================
// Four-week color emphasis (Brief Q4 — fixed arc, per-client colors)
// ======================================================================

function planWeeks(priorities, tally) {
  const pri = priorities.map(p => p.color);
  const foundation = pri.filter(f => f === 'green' || f === 'brown');
  const nonFoundation = pri.filter(f => f !== 'green' && f !== 'brown');
  const hormonal = pri.filter(f => f === 'greenwhite' || f === 'purple');

  // Week 1: foundation (or top priorities if no foundation colors active)
  const w1 = foundation.length ? foundation.slice(0, 2) : pri.slice(0, 2);
  // Week 2: next strongest non-foundation colors (steady plate week)
  const w2src = nonFoundation.filter(f => !w1.includes(f));
  const w2 = (w2src.length ? w2src : pri.filter(f => !w1.includes(f))).slice(0, 2);
  // Week 3: rhythm/hormonal colors if present, else remaining priorities
  const w3src = hormonal.filter(f => !w1.includes(f) && !w2.includes(f));
  const w3rest = pri.filter(f => !w1.includes(f) && !w2.includes(f));
  const w3 = (w3src.length ? w3src : w3rest).slice(0, 2);

  const emphases = [w1, w2, w3, ['full rainbow']];
  return WEEK_THEMES.map((t, i) => ({
    week: t.week,
    name: t.name,
    focus: t.focus,
    colors: emphases[i].map(c => COLOR_LABELS[c] || c)
  }));
}

// ======================================================================
// Labs guidance (tier-driven, practitioner-side ONLY)
// ======================================================================

function labsGuidance(tally, formType) {
  const tiered = COLOR_FAMILIES.filter(f => tally[f].tier >= 2);
  if (formType !== 'full') {
    return {
      note: 'Quick-Start scan — Tiers 2–3 unreachable; confirm depth at the full intake or consult before lab recommendations.',
      recommendPrimary: [],
      referFullPanel: []
    };
  }
  return {
    note: tiered.length ? 'Tier-driven guidance below; anchor every range to the lab’s own reference range.' : 'No family reached Tier 2+; labs optional (Tier 1 = nutrition focus).',
    recommendPrimary: COLOR_FAMILIES.filter(f => tally[f].tier === 2).map(f => COLOR_LABELS[f]),
    referFullPanel: COLOR_FAMILIES.filter(f => tally[f].tier === 3).map(f => COLOR_LABELS[f])
  };
}

// ======================================================================
// Main entry
// ======================================================================

/**
 * Run the full Rooted Assessment engine over a raw intake document.
 *
 * @param {object} intake    the Firestore intake doc (raw field names)
 * @param {object} [opts]
 * @param {'full'|'quickstart'} [opts.formType='full']
 * @returns {object} assessment (practitioner-side, Tier 1)
 */
function runAssessment(intake, opts = {}) {
  const formType = opts.formType || 'full';

  // Safety first — it can anchor colors and it can halt everything.
  const safety = runSafetyScreen(intake);

  // Self-identified standout colors from "Rainbow patterns that stand out".
  const standoutText = textOf(intake, ['Rainbow patterns that stand out']).toLowerCase();
  const selfIdColors = new Set(
    COLOR_FAMILIES.filter(f => {
      const label = COLOR_LABELS[f].toLowerCase();
      return standoutText.includes(label) ||
        (f === 'greenwhite' && /green[\s-]?white/.test(standoutText));
    })
  );
  // Guard: plain "green" also matches "green-white" text; disambiguate.
  if (selfIdColors.has('green') && !/green(?![\s-]?white)/.test(standoutText)) {
    selfIdColors.delete('green');
  }

  const tally = tallyColors(intake, formType, safety.anchoredColors, selfIdColors);
  const patterns = findPatterns(tally, formType);
  const { priorities, sequencingRules } = sequencePriorities(tally, patterns);
  const topPriorities = priorities.slice(0, 4);
  const pour = composePour(topPriorities.map(p => p.color), safety);
  const weeks = planWeeks(topPriorities, tally);
  const labs = labsGuidance(tally, formType);

  return {
    formType,
    halted: safety.halted,
    haltReasons: safety.haltReasons,
    client: {
      name: textOf(intake, ['Full name', 'full-name']),
      preferredName: textOf(intake, ['Preferred name', 'preferred-name']),
      email: textOf(intake, ['email', 'Email']),
      age: textOf(intake, ['Age']),
      location: textOf(intake, ['City & state']),
      chiefComplaint: textOf(intake, ['Main reason for reaching out']),
      goals: textOf(intake, ['Top health goals']),
      sixMonthVision: textOf(intake, ['Six-month vision']),
      fears: textOf(intake, ['Fears or blocks']),
      hopes: textOf(intake, ['What you hope to walk away with'])
    },
    tally,
    patterns,
    priorities: topPriorities,
    sequencingRules,
    pour,
    weeks,
    labs,
    conditionAdjustments: safety.adjustments,
    eatingScreen: safety.eatingScreen,
    redFlags: safety.redFlags
  };
}

module.exports = { runAssessment, tallyColors, findPatterns, sequencePriorities, runSafetyScreen, composePour, planWeeks };
