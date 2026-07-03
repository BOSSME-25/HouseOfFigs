/**
 * Rooted engine tests — run with: node rooted-engine.test.js
 *
 * Ground truth: the Emily Belt per-client assessment worksheet (May 2026)
 * from the Practitioner Companion, plus the Tier-3 hard-stop rules from
 * the Developer Handoff Brief.
 */

const assert = require('assert');
const { runAssessment } = require('./rooted-engine');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.error('  ✗', name, '\n    ', e.message); }
}

// ---------------------------------------------------------------------
// The Emily Belt quick-scan intake, reconstructed from her worksheet.
// ---------------------------------------------------------------------
const screenAllNo = {
  'Relationship with food: sick': 'No',
  'Relationship with food: control': 'No',
  'Relationship with food: weightChange': 'No',
  'Relationship with food: bodyImage': 'No',
  'Relationship with food: dominates': 'No'
};

const emily = {
  'Full name': 'Emily Belt',
  'Age': '43',
  'City & state': 'Laveen, AZ',
  'email': 'emily@example.com',
  'Main reason for reaching out': 'Live the healthiest life possible — the best version of myself.',
  'Top health goals': 'Lose weight; strengthen and tone.',
  'Six-month vision': 'Weight loss',
  'Fears or blocks': 'Doing everything and still not losing weight.',
  'Diagnosed conditions': 'Chronic anemia; asthma; blood clots quickly',
  'Family health patterns': 'Blood-clotting disorder, diabetes, high blood pressure',
  'Medications and supplements': 'None',
  'Recent bloodwork': 'None in 12 months',
  'Food allergies and sensitivities': 'Emerging gluten sensitivity',
  'Rainbow patterns that stand out': 'Brown — recently cut oats & grains',
  'Red symptoms': ['Persistent joint pain or body aches'],
  'Orange symptoms': ['Signs of leaky gut or food sensitivities'],
  'Yellow symptoms': ['Energy crashes between 2–4 pm'],
  'Green symptoms': ['Hair thinning or increased shedding'],
  'Green-white symptoms': ['Breast tenderness (cyclical or constant)', 'Estrogen-dominance symptoms (bloat, mood swings)'],
  'White symptoms': ['Seasonal or environmental allergies'],
  'Blue symptoms': ['Brain fog or difficulty concentrating', 'Wakes between 2–4 am and cannot return to sleep'],
  'Purple symptoms': ['Irregular or absent menstrual cycles'],
  'Brown symptoms': ['Sugar cravings after meals', 'Muscle cramps, especially at night'],
  ...screenAllNo
};

console.log('\nEmily Belt quick-scan (worked example):');
const a = runAssessment(emily, { formType: 'quickstart' });

test('pipeline is NOT halted (screen complete, nothing positive)', () => {
  assert.strictEqual(a.halted, false, a.haltReasons.join(' | '));
});

test('quick-scan leans: Green-White, Blue, Brown at 2-of-4', () => {
  assert.strictEqual(a.tally.greenwhite.lean, true);
  assert.strictEqual(a.tally.blue.lean, true);
  assert.strictEqual(a.tally.brown.lean, true);
  assert.strictEqual(a.tally.greenwhite.flag, false);
});

test('no hard flags anywhere (all tallies < 3)', () => {
  for (const fam of Object.keys(a.tally)) {
    assert.strictEqual(a.tally[fam].flag, false, fam);
  }
});

test('diagnosed anemia anchors Green regardless of tally', () => {
  assert.strictEqual(a.tally.green.anchored, true);
});

test('Brown carries the self-identified standout', () => {
  assert.strictEqual(a.tally.brown.selfId, true);
});

test('estrogen-dominance pattern surfaces as a lean candidate', () => {
  const p = a.patterns.find(p => p.key === 'estrogen-dominance');
  assert.ok(p, 'pattern missing: ' + a.patterns.map(p => p.key).join(','));
  assert.strictEqual(p.strength, 'lean');
});

test('foundation colors (Green + Brown) lead the priorities', () => {
  const top2 = a.priorities.slice(0, 2).map(p => p.color).sort();
  assert.deepStrictEqual(top2, ['brown', 'green']);
});

test('hormonal colors sit after gut/foundation (digestion before hormones)', () => {
  const order = a.priorities.map(p => p.color);
  const gw = order.indexOf('greenwhite');
  const brown = order.indexOf('brown');
  if (gw !== -1) assert.ok(brown < gw, `brown@${brown} vs greenwhite@${gw}`);
});

test('pour: vegetable-forward, Brown excluded, Green + Blue included', () => {
  assert.ok(!a.pour.colors.includes('brown'));
  assert.ok(a.pour.colors.includes('green'));
  assert.ok(a.pour.colors.includes('blue'));
});

test('blood-sugar tune applied (family diabetes history)', () => {
  assert.ok(a.pour.notes.some(n => /liquid sugars/i.test(n)));
});

test('quick-scan labs: no tier-driven recommendations', () => {
  assert.deepStrictEqual(a.labs.recommendPrimary, []);
  assert.deepStrictEqual(a.labs.referFullPanel, []);
});

test('four-week arc is fixed with Week 1 = Roots on foundation colors', () => {
  assert.strictEqual(a.weeks.length, 4);
  assert.strictEqual(a.weeks[0].name, 'Roots');
  assert.deepStrictEqual([...a.weeks[0].colors].sort(), ['Brown', 'Green']);
  assert.deepStrictEqual(a.weeks[3].colors, ['full rainbow']);
});

test('anemia + clotting + asthma condition adjustments all present', () => {
  const keys = a.conditionAdjustments.map(c => c.key);
  for (const k of ['anemia', 'clotting', 'asthma', 'diabetes']) {
    assert.ok(keys.includes(k), `missing adjustment: ${k}`);
  }
});

// ---------------------------------------------------------------------
// Tier-3 hard stops
// ---------------------------------------------------------------------
console.log('\nHard stops (Tier 3):');

test('pregnancy halts the pipeline', () => {
  const r = runAssessment({ ...emily, 'Pregnancy status': 'Yes' }, { formType: 'quickstart' });
  assert.strictEqual(r.halted, true);
  assert.ok(r.haltReasons.some(x => /pregnan/i.test(x)));
});

test('red-flag symptom halts the pipeline', () => {
  const r = runAssessment({ ...emily, 'Red flag symptoms': ['Blood in stool or urine'] }, { formType: 'quickstart' });
  assert.strictEqual(r.halted, true);
});

test('positive eating screen (2+ yes) halts the pipeline', () => {
  const r = runAssessment({
    ...emily,
    'Relationship with food: control': 'Yes',
    'Relationship with food: dominates': 'Yes'
  }, { formType: 'quickstart' });
  assert.strictEqual(r.halted, true);
  assert.ok(r.haltReasons.some(x => /referral/i.test(x)));
});

test('INCOMPLETE eating screen halts the pipeline (brief: positive OR incomplete)', () => {
  const partial = { ...emily };
  delete partial['Relationship with food: dominates'];
  const r = runAssessment(partial, { formType: 'quickstart' });
  assert.strictEqual(r.halted, true);
});

test('one concerning answer does NOT halt (threshold is 2+)', () => {
  const r = runAssessment({ ...emily, 'Relationship with food: weightChange': 'Yes' }, { formType: 'quickstart' });
  assert.strictEqual(r.halted, false, r.haltReasons.join(' | '));
});

// ---------------------------------------------------------------------
// Full-intake tier logic
// ---------------------------------------------------------------------
console.log('\nFull-intake tiers:');

const fullBase = { ...emily };
test('full intake: 5 checked = Tier 2, 8 checked = Tier 3', () => {
  const five = ['a', 'b', 'c', 'd', 'e'];
  const eight = [...five, 'f', 'g', 'h'];
  const r = runAssessment({ ...fullBase, 'Blue symptoms': five, 'Red symptoms': eight }, { formType: 'full' });
  assert.strictEqual(r.tally.blue.tier, 2);
  assert.strictEqual(r.tally.red.tier, 3);
  assert.ok(r.labs.recommendPrimary.includes('Blue'));
  assert.ok(r.labs.referFullPanel.includes('Red'));
});

test('full intake: 2 checked is NOT a lean (leans are quick-scan only)', () => {
  const r = runAssessment(fullBase, { formType: 'full' });
  assert.strictEqual(r.tally.blue.lean, false);
});

test('histamine reactivity removes raw White from the pour', () => {
  const r = runAssessment({
    ...fullBase,
    'Diagnosed conditions': 'histamine intolerance',
    'White symptoms': ['a', 'b', 'c', 'd', 'e'] // would otherwise be priority
  }, { formType: 'full' });
  assert.ok(!r.pour.colors.includes('white'));
});

test('beet in the glass adds the beeturia note', () => {
  const r = runAssessment({
    ...fullBase,
    'Purple symptoms': ['a', 'b', 'c', 'd', 'e'],
    'Green-white symptoms': []
  }, { formType: 'full' });
  if (r.pour.colors.includes('purple')) {
    assert.ok(r.pour.notes.some(n => /beeturia/i.test(n)));
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
