/**
 * House of Figs — Rooted Assessment generation pipeline.
 *
 * onIntakeAssessment fires when a new intake lands. Order of operations
 * (per the Developer Handoff Brief, Q5):
 *
 *   1. Run the deterministic rules engine (rooted-engine.js).
 *   2. HARD STOPS: if the safety screen halted, store a HALTED assessment,
 *      email Bethany, and generate NOTHING client-facing.
 *   3. Tier 1 (internal): store the assessment in /assessments/{intakeId}.
 *   4. Tier 2 (client-facing): draft the 30-day plan prose via the Claude
 *      API, run the two-audience leak check, and store it in
 *      /plans/{intakeId} with status "draft". It NEVER sends itself —
 *      Bethany reviews and approves in the admin.
 *
 * Secrets:
 *   ANTHROPIC_API_KEY   — firebase functions:secrets:set ANTHROPIC_API_KEY
 *   GMAIL_APP_PASSWORD  — already set (shared with the email functions)
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');

const GOING_DEEPER_URL = 'https://houseoffigs.org/going-deeper.html';
const INTAKE_URL = 'https://houseoffigs.org/intake.html?from=quiz'; // gate pass-through
const BOOKING_URL = 'https://calendly.com/houseoffigscompany/30min';

// Personal-feel formatting for Bethany's follow-up emails (Arizona time).
function fmtWhen(iso, withTime = true) {
  if (!iso) return '';
  const opts = { timeZone: 'America/Phoenix', weekday: 'long', month: 'long', day: 'numeric' };
  if (withTime) { opts.hour = 'numeric'; opts.minute = '2-digit'; }
  try { return new Date(iso).toLocaleString('en-US', opts); } catch { return ''; }
}

// Simple personal email wrapper — deliberately lighter than the branded
// shells: the post-consult handoff reads as a note from Bethany, not a
// campaign.
function personalEmail(paragraphsHtml) {
  return `<!doctype html>
<html><body style="margin:0;padding:24px 16px;background:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;color:#2C2C2C;">
  <div style="max-width:560px;margin:0 auto;font-size:0.9375rem;line-height:1.7;">
    ${paragraphsHtml}
    <p style="margin:24px 0 4px;">Warmly,<br>Bethany</p>
    <p style="font-size:0.8125rem;color:#897866;margin:0;">House of Figs &middot; <em>Rooted wellness. Sustainable transformation.</em></p>
  </div>
</body></html>`;
}

const { runAssessment } = require('./rooted-engine');
const { COLOR_VOICE, COLOR_LABELS, FOOD_GIFTS, LEAK_TERMS } = require('./rooted-data');

// Consult prep sheet auto-draft (Client Journey briefing, Stage 5).
// Deterministic from the assessment: loudest color = top priority, second
// thread noted-not-named, one pre-written food gift. Bethany reviews and
// edits every field before the call.
function draftPrepSheet(assessment) {
  const loudest = assessment.priorities[0] || null;
  const second = assessment.priorities[1] || null;
  return {
    loudestColor: loudest ? loudest.label : '',
    loudestWhy: loudest ? loudest.why : '',
    secondThread: second ? second.label : '',
    foodGift: loudest ? (FOOD_GIFTS[loudest.color] || '') : '',
    safetyFlags: assessment.haltReasons || [],
    notes: ''
  };
}

const anthropicKey = defineSecret('ANTHROPIC_API_KEY');

// ---------------------------------------------------------------------
// Two-audience leak check (Brief Q5): no lab names, supplement names or
// doses, functional ranges, or clinical pattern terms may appear in any
// client-facing document. Findings block the "ready" state in the admin.
// ---------------------------------------------------------------------
function leakCheck(text) {
  const findings = [];
  const hay = String(text || '');
  for (const term of LEAK_TERMS) {
    // Word-ish boundary match, case-insensitive for alphabetic terms.
    const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^A-Za-z])${escaped}($|[^A-Za-z])`, 'i');
    if (re.test(hay)) findings.push(term.trim());
  }
  return findings;
}

function planText(plan) {
  // Flatten every client-facing string in the draft for the leak scan.
  const parts = [
    plan.welcomeNote,
    plan.closingReframe,
    ...(plan.rainbowRead || []).map(r => `${r.heading} ${r.paragraph}`),
    ...(plan.weeks || []).map(w => `${w.emphasis} ${w.tailoring}`),
    ...(plan.smallHarvests || []),
    ...(plan.gentleNotes || []),
    ...(plan.pourDescription ? [plan.pourDescription] : [])
  ];
  return parts.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------
// Claude drafting — structured output so the admin can edit per-section.
// ---------------------------------------------------------------------
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['welcomeNote', 'rainbowRead', 'pourDescription', 'weeks',
             'smallHarvests', 'gentleNotes', 'closingReframe'],
  properties: {
    welcomeNote: {
      type: 'string',
      description: 'The "A Note For You" welcome — echoes the client\'s goals in their own words.'
    },
    rainbowRead: {
      type: 'array',
      description: 'One warm paragraph per priority color, strongest first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['color', 'heading', 'paragraph'],
        properties: {
          color: { type: 'string', description: 'Color family label, e.g. "Green"' },
          heading: { type: 'string', description: 'Short lead-in, e.g. "Green was the loudest voice."' },
          paragraph: { type: 'string' }
        }
      }
    },
    pourDescription: {
      type: 'string',
      description: 'Warm description of the daily Rainbow pour and what each color brings.'
    },
    weeks: {
      type: 'array',
      description: 'Exactly 4 entries, one per fixed week theme.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['week', 'emphasis', 'tailoring'],
        properties: {
          week: { type: 'integer' },
          emphasis: { type: 'string', description: 'The week\'s color emphasis in client language.' },
          tailoring: { type: 'string', description: 'The client-specific note for this week.' }
        }
      }
    },
    smallHarvests: {
      type: 'array',
      items: { type: 'string' },
      description: 'Small early wins to watch for, tied to the client\'s stated goals.'
    },
    gentleNotes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Condition-specific gentle notes in plain, non-clinical language (only the ones that apply). Include the beeturia note when beet is in the pour.'
    },
    closingReframe: {
      type: 'string',
      description: 'Week Four closing — their goal plus their named fear, reframed.'
    }
  }
};

function buildDraftPrompt(assessment) {
  const c = assessment.client;
  const voice = assessment.priorities.map(p => {
    const v = COLOR_VOICE[p.color];
    return `${COLOR_LABELS[p.color]} · ${v.title} — tends to be saying: ${v.saying}. Lean into: ${v.leanInto}`;
  }).join('\n');

  const pour = assessment.pour.colors
    .map(f => `${COLOR_LABELS[f]}: ${assessment.pour.ingredients[f]}`)
    .join('\n');

  return `Draft the personalized sections of a "30-Day Rooted Beginning" plan for this client.

CLIENT (use their own words wherever natural):
- Preferred name: ${c.preferredName || c.name || 'there'}
- Chief complaint / main reason: ${c.chiefComplaint || '(not given)'}
- Goals: ${c.goals || '(not given)'}
- Six-month vision: ${c.sixMonthVision || '(not given)'}
- Named fear or block: ${c.fears || '(not given)'}
- What they hope to walk away with: ${c.hopes || '(not given)'}

PRIORITY COLORS (strongest first), with the Color Voice Library entries to draw from:
${voice}

WHAT EACH PRIORITY COLOR IS RESPONDING TO (the symptoms they actually checked — reference these gently, in plain language, never as a list):
${assessment.priorities.map(p => `${p.label}: ${(assessment.tally[p.color].items || []).join('; ') || '(condition-anchored)'}`).join('\n')}

THE DAILY POUR (vegetable-forward, blended not strained, fruit modest, additive with food — never a cleanse or meal replacement):
${pour}
Pour notes: ${assessment.pour.notes.join(' ')}

THE FIXED FOUR-WEEK ARC (names and focus never change; you write only the per-client emphasis + tailoring):
${assessment.weeks.map(w => `Week ${w.week} · ${w.name} — fixed focus: ${w.focus}; this client's colors: ${w.colors.join(' + ')}`).join('\n')}

CONDITION-AWARE ADJUSTMENTS to reflect as gentle plain-language notes (translate; do not name conditions clinically unless the client named them themselves):
${assessment.conditionAdjustments.map(a => `- ${a.note}`).join('\n') || '(none)'}${goingDeeperContext(assessment.goingDeeper)}`;
}

// Optional enrichment when the Going Deeper companion form has returned.
function goingDeeperContext(gd) {
  if (!gd) return '';
  const audits = Object.keys(gd)
    .filter(k => k.startsWith('Rainbow audit: '))
    .map(k => `${k.replace('Rainbow audit: ', '')}: ${gd[k]}`);
  const lines = [];
  if (audits.length) lines.push(`What they already eat (Rainbow audit — affirm what's nourished, grow what's rare):\n${audits.join('; ')}`);
  if (gd['Settling practices']) lines.push(`What helps them settle (use for the wind-down): ${gd['Settling practices']}`);
  if (gd['Support and grounding']) lines.push(`Support & grounding (people, faith, community): ${gd['Support and grounding']}`);
  if (gd['Home environment']) lines.push(`Home feels: ${gd['Home environment']}`);
  if (gd['Meal preparer']) lines.push(`Meals mostly prepared by: ${gd['Meal preparer']}`);
  if (!lines.length) return '';
  return `\n\nFROM THEIR GOING DEEPER FORM (weave in naturally — never quote it back as a list):\n${lines.join('\n')}`;
}

const DRAFT_SYSTEM = `You draft client-facing sections of House of Figs "Rooted Beginning" nourishment plans, in the voice of Bethany Grissum — warm, unhurried, food-forward, faith-respectful, never clinical.

Voice rules (absolute):
- Two-audience rule: ALL clinical reasoning stays practitioner-side. Never mention lab names, lab panels, supplement names or doses, functional ranges, clinical pattern terms (e.g. "estrogen dominance", "HPA-axis", "insulin resistance", "microbiome"), tiers, flags, or scores. The client receives only warmth and food.
- Never frame anything as a diet, cleanse, detox, restriction, or weight-loss protocol. No calorie, macro, or appearance targets. The pour is "additive, with food" — never a meal replacement.
- Measure progress by energy, sleep, strength, and function — never the scale.
- Echo the client's own words for their goals and fears where natural.
- The plan "walks alongside your doctor" — supportive, never a substitute for medical care.
- Warm but not saccharine. Short sentences welcome. Sound like the worked examples: "Yellow was the loudest voice." / "We will make this our anchor."
- If the client expressed faith (e.g. "God first"), let the wind-down and encouragement honor it naturally; otherwise keep it neutral.`;

// ---------------------------------------------------------------------
// The trigger
// ---------------------------------------------------------------------
function registerRootedPipeline({ gmailPassword, makeTransport, emailShell, FROM_ADDRESS, NOTIFY_TO, DASHBOARD_URL, escape }) {

  const onIntakeAssessment = onDocumentCreated(
    {
      document: 'intakes/{docId}',
      secrets: [gmailPassword, anthropicKey],
      timeoutSeconds: 300,
      memory: '512MiB'
    },
    async (event) => {
      const intake = event.data && event.data.data();
      if (!intake) return;
      await processIntakeAssessment(intake, event.params.docId, admin.firestore());
    }
  );

  // Shared by onIntakeAssessment (new submissions) and
  // onAssessmentRequested (admin backfill of earlier intakes).
  async function processIntakeAssessment(intake, intakeId, db) {
    const now = new Date().toISOString();

    // 1–2. Engine (safety screen runs first inside it). Form-source aware
    // per the Client Journey briefing: web submissions carry the full
    // symptom lists and score as a full intake; only paper Quick-Start
    // entries (keyed in manually with Form source = 'paper-quickstart')
    // use the 2-of-4 soft-lean rule.
    const formType = intake['Form source'] === 'paper-quickstart' ? 'quickstart' : 'full';
    const assessment = runAssessment(intake, { formType });

    // 3. Tier 1 — store the practitioner-side assessment. Idempotent:
    //    keyed by intake id, so re-runs overwrite rather than duplicate.
    await db.collection('assessments').doc(intakeId).set({
      ...assessment,
      intakeId,
      status: assessment.halted ? 'halted' : 'generated',
      // Stage 5: auto-drafted consult prep sheet (Bethany edits in admin).
      prepSheet: draftPrepSheet(assessment),
      // Journey milestones — set by admin buttons and functions as the
      // client moves through the funnel. Timestamps, null until reached.
      journey: {
        consultAt: null,        // scheduled consult datetime (admin-entered)
        consultHeldAt: null,    // set by "Mark consult held"
        followUpAt: null,       // scheduled follow-up datetime
        email1SentAt: null,     // post-consult handoff email
        email2SentAt: null,     // the single day-3/4 nudge
        gdReturnedAt: null      // Going Deeper form received
      },
      createdAt: now,
      updatedAt: now
    });

    if (assessment.halted) {
      // HARD STOP — nothing client-facing generates. Flag Bethany.
      const body = assessment.haltReasons
        .map(r => `<div style="margin-bottom:10px;font-size:0.9375rem;color:#2C2C2C;line-height:1.5;">&bull; ${escape(r)}</div>`)
        .join('');
      const html = emailShell(
        `Assessment pipeline HALTED — <em>${escape(assessment.client.name || 'Unnamed')}</em>`,
        `<p style="font-size:0.9375rem;color:#2C2C2C;line-height:1.6;">The safety screen stopped automated generation for this intake. No client documents were created. Review before proceeding:</p>${body}`,
        DASHBOARD_URL,
        'Review in dashboard'
      );
      const transport = makeTransport();
      await transport.sendMail({
        from: `House of Figs <${FROM_ADDRESS}>`,
        to: NOTIFY_TO.join(', '),
        subject: `⚠ Assessment halted — ${assessment.client.name || 'Unnamed'}`,
        html
      });
      return;
    }

    // 4. Tier 2 — draft the client plan via Claude (structured output).
    await draftAndStorePlan(assessment, intakeId, db);
  }

  // -------------------------------------------------------------------
  // Backfill: intakes submitted before the pipeline existed have no
  // assessment. The admin's "Process earlier intakes" button creates a
  // stub assessment doc with status "requested"; this trigger runs the
  // exact same processing path as a fresh submission. Nothing is ever
  // sent to the client. (The pipeline's own writes create docs with
  // status generated/halted, so the guard below ignores them.)
  // -------------------------------------------------------------------
  const onAssessmentRequested = onDocumentCreated(
    {
      document: 'assessments/{docId}',
      secrets: [gmailPassword, anthropicKey],
      timeoutSeconds: 300,
      memory: '512MiB'
    },
    async (event) => {
      const stub = event.data && event.data.data();
      if (!stub || stub.status !== 'requested') return;
      const intakeId = event.params.docId;
      const db = admin.firestore();

      const intakeSnap = await db.collection('intakes').doc(intakeId).get();
      if (!intakeSnap.exists) {
        await db.collection('assessments').doc(intakeId).set({
          status: 'request_failed',
          requestError: 'No intake found with this id.',
          updatedAt: new Date().toISOString()
        }, { merge: true });
        return;
      }
      await processIntakeAssessment(intakeSnap.data(), intakeId, db);
    }
  );

  // Shared by onIntakeAssessment and onHoldCleared.
  async function draftAndStorePlan(assessment, intakeId, db) {
    const now = new Date().toISOString();
    const client = new Anthropic({ apiKey: anthropicKey.value() });
    let draft = null;
    let draftError = null;
    try {
      const response = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        system: DRAFT_SYSTEM,
        output_config: { format: { type: 'json_schema', schema: PLAN_SCHEMA } },
        messages: [{ role: 'user', content: buildDraftPrompt(assessment) }]
      });
      if (response.stop_reason === 'refusal') {
        draftError = 'Model declined to draft — review manually.';
      } else {
        const textBlock = response.content.find(b => b.type === 'text');
        draft = JSON.parse(textBlock.text);
      }
    } catch (err) {
      console.error('Plan draft failed:', err);
      draftError = String((err && err.message) || err);
    }

    const leakFindings = draft ? leakCheck(planText(draft)) : [];

    await db.collection('plans').doc(intakeId).set({
      intakeId,
      clientName: assessment.client.name,
      clientEmail: assessment.client.email,
      // Plan status machine: draft -> approved(sending) -> sent, all
      // admin-driven. leak_blocked / draft_failed need attention first.
      // The plan is sent during/after the first health meeting — never
      // automatically.
      status: draftError ? 'draft_failed' : (leakFindings.length ? 'leak_blocked' : 'draft'),
      draft,
      draftError,
      leakFindings,
      weeksFixed: assessment.weeks,     // fixed arc, for rendering
      pour: assessment.pour,            // colors + ingredients, for rendering
      createdAt: now,
      updatedAt: now
    });
  }

  // -------------------------------------------------------------------
  // Going Deeper returned (Stage 8): site form + Going Deeper = the
  // full-intake equivalent. Merge the GD answers into the safety-relevant
  // intake fields, re-run the engine, refresh the assessment (Bethany
  // re-reviews — approval resets), and re-draft the plan unless it has
  // already been sent.
  // -------------------------------------------------------------------
  const onGoingDeeperCreated = onDocumentCreated(
    {
      document: 'goingDeeper/{docId}',
      secrets: [gmailPassword, anthropicKey],
      timeoutSeconds: 300,
      memory: '512MiB'
    },
    async (event) => {
      const gd = event.data && event.data.data();
      if (!gd) return;
      const intakeId = event.params.docId;
      const db = admin.firestore();
      const now = new Date().toISOString();

      const intakeSnap = await db.collection('intakes').doc(intakeId).get();
      if (!intakeSnap.exists) {
        console.warn(`Going Deeper for unknown intake ${intakeId} — leaving for manual review.`);
        return;
      }
      const intake = intakeSnap.data();

      // Merge GD detail into the fields the safety screen and condition
      // rules read, so new meds/history are picked up on the re-run.
      const joinNonEmpty = (...parts) => parts.filter(Boolean).join(' \n ');
      const merged = { ...intake };
      merged['Medications and supplements'] = joinNonEmpty(
        intake['Medications and supplements'],
        gd['Current medications detail'],
        gd['Current supplements detail'],
        gd['Hormone therapy or birth control']
      );
      merged['Anything else important'] = joinNonEmpty(
        intake['Anything else important'],
        gd['Past surgeries and hospitalizations'],
        gd['Recent bloodwork detail'],
        gd['Gut history'],
        gd['Cycle health detail']
      );

      const assessment = runAssessment(merged, { formType: 'full' });

      // Preserve Bethany's prep-sheet edits and journey milestones.
      const prevSnap = await db.collection('assessments').doc(intakeId).get();
      const prev = prevSnap.exists ? prevSnap.data() : {};
      const journey = { ...(prev.journey || {}), gdReturnedAt: now };

      await db.collection('assessments').doc(intakeId).set({
        ...assessment,
        intakeId,
        // Full picture arrived — approval resets so Bethany re-reviews.
        status: assessment.halted ? 'halted' : 'generated',
        prepSheet: prev.prepSheet || draftPrepSheet(assessment),
        journey,
        goingDeeper: gd,          // raw GD answers for the worksheet view
        gdMergedAt: now,
        createdAt: prev.createdAt || now,
        updatedAt: now
      });

      if (assessment.halted) {
        const transport = makeTransport();
        await transport.sendMail({
          from: `House of Figs <${FROM_ADDRESS}>`,
          to: NOTIFY_TO.join(', '),
          subject: `⚠ Going Deeper re-assessment halted — ${assessment.client.name || 'Unnamed'}`,
          html: emailShell(
            `Re-assessment HALTED after Going Deeper — <em>${escape(assessment.client.name || 'Unnamed')}</em>`,
            assessment.haltReasons.map(r => `<div style="margin-bottom:10px;font-size:0.9375rem;color:#2C2C2C;line-height:1.5;">&bull; ${escape(r)}</div>`).join(''),
            DASHBOARD_URL,
            'Review in dashboard'
          )
        });
        return;
      }

      // Re-draft the plan with the complete picture (never touch a sent plan).
      const planSnap = await db.collection('plans').doc(intakeId).get();
      if (!planSnap.exists || planSnap.data().status !== 'sent') {
        assessment.goingDeeper = gd; // enriches the drafting prompt
        await draftAndStorePlan(assessment, intakeId, db);
      }
    }
  );

  // -------------------------------------------------------------------
  // Clear a safety hold: Bethany's clinical judgment is the intended
  // override (the brief routes hard stops to her — she resolves at the
  // consult). When she sets a halted assessment to "cleared" in the
  // admin, the plan drafts now and the assessment returns to "generated".
  // -------------------------------------------------------------------
  const onHoldCleared = onDocumentUpdated(
    {
      document: 'assessments/{docId}',
      secrets: [gmailPassword, anthropicKey],
      timeoutSeconds: 300,
      memory: '512MiB'
    },
    async (event) => {
      const before = event.data && event.data.before.data();
      const after = event.data && event.data.after.data();
      if (!before || !after) return;
      if (before.status !== 'halted' || after.status !== 'cleared') return;

      const db = admin.firestore();
      const intakeId = event.params.docId;

      await draftAndStorePlan(after, intakeId, db);
      await db.collection('assessments').doc(intakeId).set({
        status: 'generated',
        holdClearedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  );

  // -------------------------------------------------------------------
  // Delivery: when Bethany flips a plan to "approved" in the admin, email
  // it to the client and mark it "sent". The leak check re-runs here as a
  // final gate — an approved plan with leaks refuses to send.
  // -------------------------------------------------------------------
  const onPlanApproved = onDocumentUpdated(
    {
      document: 'plans/{docId}',
      secrets: [gmailPassword]
    },
    async (event) => {
      const before = event.data && event.data.before.data();
      const after = event.data && event.data.after.data();
      if (!before || !after) return;
      if (before.status === 'approved' || after.status !== 'approved') return;

      const db = admin.firestore();
      const ref = db.collection('plans').doc(event.params.docId);
      const plan = after.draft;
      const email = after.clientEmail;

      if (!plan || !email) {
        await ref.set({ status: 'send_failed', sendError: 'Missing draft or client email.', updatedAt: new Date().toISOString() }, { merge: true });
        return;
      }

      // Final two-audience gate.
      const leaks = leakCheck(planText(plan));
      if (leaks.length) {
        await ref.set({ status: 'leak_blocked', leakFindings: leaks, updatedAt: new Date().toISOString() }, { merge: true });
        return;
      }

      const firstName = String(after.clientName || '').trim().split(/\s+/)[0] || 'there';
      const html = renderPlanEmail(firstName, plan, after);

      const transport = makeTransport();
      await transport.sendMail({
        from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
        to: email,
        replyTo: FROM_ADDRESS,
        subject: `${firstName}, your 30-Day Rooted Beginning is ready`,
        html
      });

      await ref.set({ status: 'sent', sentAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
    }
  );

  // Branded client email carrying the full plan.
  function renderPlanEmail(firstName, plan, meta) {
    const e = escape;
    const para = (t) => `<p style="font-size:0.9375rem;color:#2C2C2C;line-height:1.7;margin:0 0 16px;">${e(t)}</p>`;
    const h = (t) => `<div style="font-family:Georgia,serif;font-size:1.2rem;color:#4A3728;font-weight:500;margin:26px 0 10px;">${e(t)}</div>`;

    let body = '';
    body += para(`Hi ${firstName},`);
    body += para(plan.welcomeNote);

    body += h('The Rainbow Read — what your body has been saying');
    for (const r of plan.rainbowRead || []) {
      body += `<p style="font-size:0.9375rem;color:#2C2C2C;line-height:1.7;margin:0 0 14px;"><strong style="color:#4A3728;">${e(r.heading)}</strong> ${e(r.paragraph)}</p>`;
    }

    body += h('Pour it in — your daily Rainbow pour');
    body += para(plan.pourDescription);
    if (meta.pour && meta.pour.ingredients) {
      body += '<ul style="font-size:0.9375rem;color:#2C2C2C;line-height:1.7;margin:0 0 16px;padding-left:20px;">';
      for (const [color, ing] of Object.entries(meta.pour.ingredients)) {
        body += `<li><strong>${e(color.charAt(0).toUpperCase() + color.slice(1))}:</strong> ${e(ing)}</li>`;
      }
      body += '</ul>';
    }

    body += h('Your four weeks');
    const themes = meta.weeksFixed || [];
    for (const w of plan.weeks || []) {
      const t = themes.find(x => x.week === w.week) || {};
      body += `<p style="font-size:0.9375rem;color:#2C2C2C;line-height:1.7;margin:0 0 14px;"><strong style="color:#4A3728;">Week ${w.week}${t.name ? ' · ' + e(t.name) : ''}</strong>${t.focus ? ' — ' + e(t.focus) + '.' : ''}<br>${e(w.emphasis)} ${e(w.tailoring)}</p>`;
    }

    if ((plan.smallHarvests || []).length) {
      body += h('Small Harvests to watch for');
      body += '<ul style="font-size:0.9375rem;color:#2C2C2C;line-height:1.7;margin:0 0 16px;padding-left:20px;">';
      for (const s of plan.smallHarvests) body += `<li>${e(s)}</li>`;
      body += '</ul>';
    }

    if ((plan.gentleNotes || []).length) {
      body += h('A few gentle notes');
      for (const n of plan.gentleNotes) body += para(n);
    }

    body += h('Fruit & Forward');
    body += para(plan.closingReframe);
    body += para('This plan is meant to walk alongside the care of your doctor, not replace it. Bring any questions it raises to your doctor and to me.');

    return `<!doctype html>
<html><body style="margin:0;padding:0;background-color:#f5f0ea;font-family:'Helvetica Neue',Arial,sans-serif;color:#2C2C2C;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f0ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(74,55,40,0.08);">
        <tr><td style="background:linear-gradient(135deg,#4A3728 0%,#6B4F3A 100%);padding:24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <div style="font-family:Georgia,serif;font-size:1.4rem;color:#F5F0EA;font-weight:500;">A 30-Day Rooted Beginning</div>
              <div style="font-family:Georgia,serif;font-style:italic;color:rgba(245,240,234,0.7);font-size:0.875rem;margin-top:2px;">Prepared with care for ${e(firstName)}</div>
            </td>
            <td align="right" style="vertical-align:middle;width:104px;">
              <img src="https://houseoffigs.org/images/logo-light-email.png" alt="House of Figs" width="104" height="90" style="display:block;border:0;">
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px;">
          ${body}
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #ece2cf;">
            <p style="font-family:Georgia,serif;font-style:italic;color:#4A3728;font-size:1rem;margin:0 0 10px;">Rooted with you,</p>
            <div style="font-family:Georgia,serif;font-size:1.05rem;color:#4A3728;font-weight:500;">Bethany Grissum</div>
            <div style="font-size:0.8125rem;color:#897866;line-height:1.6;margin-top:3px;">Founder, House of Figs<br>
              <span style="font-style:italic;">Rooted wellness. Sustainable transformation.</span><br>
              <a href="https://houseoffigs.org" style="color:#8B5E5A;text-decoration:none;">houseoffigs.org</a> &middot; @hofigs</div>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  }

  // -------------------------------------------------------------------
  // Post-consult Email One (Stage 7): fires when Bethany marks the consult
  // held in the admin. Template copy from HOF_PostConsult_FollowUp_Emails,
  // merged from the prep sheet: goal in their words, the food gift, the
  // Going Deeper link, return-by (two days before follow-up), follow-up.
  // -------------------------------------------------------------------
  const onConsultHeld = onDocumentUpdated(
    {
      document: 'assessments/{docId}',
      secrets: [gmailPassword]
    },
    async (event) => {
      const before = event.data && event.data.before.data();
      const after = event.data && event.data.after.data();
      if (!before || !after) return;
      const bj = (before.journey || {});
      const aj = (after.journey || {});
      if (bj.consultHeldAt || !aj.consultHeldAt || aj.email1SentAt) return;

      const intakeId = event.params.docId;
      const db = admin.firestore();
      const email = after.client && after.client.email;
      const firstName = String((after.client && (after.client.preferredName || after.client.name)) || '')
        .trim().split(/\s+/)[0] || 'there';
      const goal = (after.client && (after.client.goals || after.client.chiefComplaint)) || 'to feel like yourself again';
      const foodGift = (after.prepSheet && after.prepSheet.foodGift) || 'the one small shift we talked about';
      const gdLink = `${GOING_DEEPER_URL}?id=${encodeURIComponent(intakeId)}`;
      const followUp = aj.followUpAt ? fmtWhen(aj.followUpAt) : '';
      let returnBy = '';
      if (aj.followUpAt) {
        const d = new Date(aj.followUpAt);
        d.setDate(d.getDate() - 2);
        returnBy = fmtWhen(d.toISOString(), false);
      }

      if (!email) {
        await db.collection('assessments').doc(intakeId).set({
          journey: { ...aj, email1Error: 'No client email on record.' }
        }, { merge: true });
        return;
      }

      const e = escape;
      const html = personalEmail(`
        <p>Hi ${e(firstName)},</p>
        <p>Thank you for the conversation today — and for the honesty you brought to it. What stayed with me is that you want ${e(goal)}, and that's exactly what we'll build toward.</p>
        <p>Before anything else, the one thing from our call: <strong>${e(foodGift)}</strong>. Small, but it starts feeding exactly the system that's been asking. Notice what shifts — even a little.</p>
        <p>Your next step is the Going Deeper form: <a href="${e(gdLink)}" style="color:#8B5E5A;">${e(gdLink)}</a>. It takes about fifteen to twenty minutes and completes the picture your first intake began — so the thirty-day plan I build fits the life you're actually living, not a template.${returnBy ? ` If you can, have it back to me by <strong>${e(returnBy)}</strong>, so I have time to sit with it properly before we talk.` : ''}</p>
        ${followUp ? `<p>We're on the calendar for <strong>${e(followUp)}</strong>. I'm looking forward to it.</p>` : ''}
      `);

      const transport = makeTransport();
      await transport.sendMail({
        from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
        to: email,
        replyTo: FROM_ADDRESS,
        subject: `Your next step, ${firstName} — and the one thing to try this week`,
        html
      });

      await db.collection('assessments').doc(intakeId).set({
        journey: { ...aj, email1SentAt: new Date().toISOString() },
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  );

  // -------------------------------------------------------------------
  // RMI submitted (Entry B, Funnel Logic Map T4): notify admins and send
  // R1 — warm thanks + the quiz invitation. NO booking link, ever: RMI
  // leads are routed to the quiz first, always.
  // -------------------------------------------------------------------
  const QUIZ_URL = 'https://houseoffigs.org/quiz.html';

  const onRmiCreated = onDocumentCreated(
    {
      document: 'rmi/{docId}',
      secrets: [gmailPassword]
    },
    async (event) => {
      const rmi = event.data && event.data.data();
      if (!rmi) return;
      const e = escape;
      const transport = makeTransport();

      // Admin notification
      await transport.sendMail({
        from: `House of Figs <${FROM_ADDRESS}>`,
        to: NOTIFY_TO.join(', '),
        replyTo: rmi.email || FROM_ADDRESS,
        subject: `New message — ${rmi.name || rmi.email}`,
        html: emailShell(
          `New message from <em>${e(rmi.name || 'Unnamed')}</em>`,
          `<div style="font-size:0.9375rem;color:#2C2C2C;line-height:1.6;">
             <div style="margin-bottom:8px;"><strong>Email:</strong> ${e(rmi.email || '')}</div>
             <div><strong>Message:</strong><br>${e(rmi.message || '(none)')}</div>
           </div>`,
          DASHBOARD_URL,
          'Open dashboard'
        )
      });

      // R1 — the quiz invitation (no booking link)
      if (rmi.email) {
        const firstName = String(rmi.name || '').trim().split(/\s+/)[0] || 'there';
        try {
          await transport.sendMail({
            from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
            to: rmi.email,
            replyTo: FROM_ADDRESS,
            subject: `So glad you reached out, ${firstName}`,
            html: personalEmail(`
              <p>Hi ${e(firstName)},</p>
              <p>Thank you for reaching out — your message is in my hands, and I'll reply personally within a day or two.</p>
              <p>While I do, there's one small step that makes everything that follows better: the <a href="${e(QUIZ_URL)}" style="color:#8B5E5A;">free color quiz</a>. Three minutes, and it shows us which of your body's systems are asking for support — your color profile, the direction of your daily pour, and the clearest place to begin.</p>
              <p>It's also the doorway to the free 20-minute session, where we look at your whole picture together and you leave with a custom juice recipe built just for your colors.</p>
              <p>Take the quiz here: <a href="${e(QUIZ_URL)}" style="color:#8B5E5A;">${e(QUIZ_URL)}</a></p>
            `)
          });
          await admin.firestore().collection('rmi').doc(event.params.docId).set({
            r1SentAt: new Date().toISOString()
          }, { merge: true });
        } catch (err) {
          console.error('R1 email failed (admin notify already sent):', err);
        }
      }
    }
  );

  // -------------------------------------------------------------------
  // Daily nudges, 9am Arizona. Two jobs, both single-shot per person:
  //  1. Email Two — the ONE gentle Going Deeper nudge, day 3–4 after
  //     Email One, only if the form hasn't returned. One nudge only; the
  //     follow-up call happens either way (the docx rule).
  //  2. Day-3 quiz nudge — quiz leads with no intake after 3 days.
  // -------------------------------------------------------------------
  const dailyNudges = onSchedule(
    {
      schedule: '0 16 * * *', // 16:00 UTC = 9:00 AM Arizona (no DST)
      timeZone: 'Etc/UTC',
      secrets: [gmailPassword]
    },
    async () => {
      const db = admin.firestore();
      const now = Date.now();
      const DAY = 24 * 60 * 60 * 1000;
      const transport = makeTransport();
      const e = escape;

      // ---- Email Two: Going Deeper nudge ----
      const assessments = await db.collection('assessments').get();
      for (const snap of assessments.docs) {
        const a = snap.data();
        const j = a.journey || {};
        // Global suppression rule (Funnel Logic Map): a safety hold
        // suspends every scheduled send for that contact.
        if (a.status === 'halted') continue;
        if (!j.email1SentAt || j.email2SentAt || j.gdReturnedAt) continue;
        const age = now - Date.parse(j.email1SentAt);
        if (isNaN(age) || age < 3 * DAY || age > 10 * DAY) continue;
        const email = a.client && a.client.email;
        if (!email) continue;

        const firstName = String((a.client.preferredName || a.client.name) || '').trim().split(/\s+/)[0] || 'there';
        const foodGift = (a.prepSheet && a.prepSheet.foodGift) || 'that one small shift';
        const gdLink = `${GOING_DEEPER_URL}?id=${encodeURIComponent(snap.id)}`;
        const followUp = j.followUpAt ? fmtWhen(j.followUpAt, false) : '';

        const html = personalEmail(`
          <p>Hi ${e(firstName)},</p>
          <p>Just a soft note — no rush behind it. The Going Deeper form is here whenever you have a quiet fifteen minutes: <a href="${e(gdLink)}" style="color:#8B5E5A;">${e(gdLink)}</a>.</p>
          <p>${followUp ? `The only reason I ask for it ahead of ${e(followUp)} is so I can read it with care before we talk, instead of during. If the date needs to move to make room, that's easy — just say the word.` : 'The only reason I ask for it ahead of our next conversation is so I can read it with care before we talk, instead of during.'}</p>
          <p>And however the week is going — keep at ${e(foodGift)}. That one small thing is already work worth doing.</p>
        `);

        try {
          await transport.sendMail({
            from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
            to: email,
            replyTo: FROM_ADDRESS,
            subject: `Whenever you're ready, ${firstName}`,
            html
          });
          await db.collection('assessments').doc(snap.id).set({
            journey: { ...j, email2SentAt: new Date().toISOString() }
          }, { merge: true });
        } catch (err) {
          console.error(`Email Two failed for ${snap.id}:`, err);
        }
      }

      // ---- Q2 (day-3 quiz nudge), R2 (day-3 RMI nudge), D1 (day-14) ----
      const [quizzes, intakes, rmis] = await Promise.all([
        db.collection('quizzes').get(),
        db.collection('intakes').get(),
        db.collection('rmi').get()
      ]);
      const intakeEmails = new Set(
        intakes.docs.map(d => String(d.data().email || d.data().Email || '').toLowerCase().trim()).filter(Boolean)
      );
      const quizEmails = new Set(
        quizzes.docs.map(d => String(d.data().email || '').toLowerCase().trim()).filter(Boolean)
      );
      const nudgedEmails = new Set();

      // Q2 — day-3 quiz nudge: one CTA (intake + booking), recipe promise.
      for (const snap of quizzes.docs) {
        const q = snap.data();
        const email = String(q.email || '').toLowerCase().trim();
        if (!email || q.quizNudgeSentAt || q.dormantAt || intakeEmails.has(email) || nudgedEmails.has(email)) continue;
        const age = now - Date.parse(q.emailCapturedAt || q.createdAt || '');
        if (isNaN(age) || age < 3 * DAY || age > 10 * DAY) continue;

        const firstName = String(q.name || '').trim().split(/\s+/)[0] || 'there';
        const profile = (q.profile && q.profile.title) || '';

        const html = personalEmail(`
          <p>Hi ${e(firstName)},</p>
          <p>A few days ago the quiz showed you something real — ${profile ? `you're <strong>${e(profile.replace(/^The /, 'a '))}</strong>, and ` : ''}your body has been asking for a particular kind of support. That doesn't go away on its own, but it does respond — often faster than people expect.</p>
          <p>Whenever you're ready, the next step is a short intake and a free 20-minute consultation — that's where we look at your whole picture together, and where you leave with your <strong>custom juice recipe</strong>, the pour I build around your colors.</p>
          <p>Complete your intake: <a href="${e(INTAKE_URL)}" style="color:#8B5E5A;">${e(INTAKE_URL)}</a><br>
          Book your free consultation: <a href="${e(BOOKING_URL)}" style="color:#8B5E5A;">${e(BOOKING_URL)}</a></p>
          <p>No rush, and no pressure — just an open door.</p>
        `);

        try {
          await transport.sendMail({
            from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
            to: email,
            replyTo: FROM_ADDRESS,
            subject: `Whenever you're ready, ${firstName}`,
            html
          });
          nudgedEmails.add(email);
          await db.collection('quizzes').doc(snap.id).set({
            quizNudgeSentAt: new Date().toISOString()
          }, { merge: true });
        } catch (err) {
          console.error(`Quiz nudge failed for ${snap.id}:`, err);
        }
      }

      // R2 — day-3 RMI nudge: gentle repeat of the quiz invitation.
      for (const snap of rmis.docs) {
        const r = snap.data();
        const email = String(r.email || '').toLowerCase().trim();
        if (!email || r.rmiNudgeSentAt || r.dormantAt || quizEmails.has(email) || nudgedEmails.has(email)) continue;
        const age = now - Date.parse(r.createdAt || '');
        if (isNaN(age) || age < 3 * DAY || age > 10 * DAY) continue;

        const firstName = String(r.name || '').trim().split(/\s+/)[0] || 'there';
        const html = personalEmail(`
          <p>Hi ${e(firstName)},</p>
          <p>Just a soft follow-up — the free color quiz is still here whenever you have three quiet minutes: <a href="${e(QUIZ_URL)}" style="color:#8B5E5A;">${e(QUIZ_URL)}</a>.</p>
          <p>It's the first step toward your color profile, your daily pour, and the free session where you'll leave with a custom juice recipe built around what your body's been asking for.</p>
          <p>No rush at all — the door stays open.</p>
        `);

        try {
          await transport.sendMail({
            from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
            to: email,
            replyTo: FROM_ADDRESS,
            subject: `Whenever you're ready, ${firstName}`,
            html
          });
          nudgedEmails.add(email);
          await db.collection('rmi').doc(snap.id).set({
            rmiNudgeSentAt: new Date().toISOString()
          }, { merge: true });
        } catch (err) {
          console.error(`RMI nudge failed for ${snap.id}:`, err);
        }
      }

      // D1 — day-14 goodbye-for-now, then dormant. One per person, ever.
      // (The quarterly Ripening touch is a future asset per the logic map.)
      const d1Candidates = [];
      for (const snap of quizzes.docs) {
        const q = snap.data();
        const email = String(q.email || '').toLowerCase().trim();
        if (!email || q.dormantAt || intakeEmails.has(email)) continue;
        const age = now - Date.parse(q.emailCapturedAt || q.createdAt || '');
        if (isNaN(age) || age < 14 * DAY || age > 30 * DAY) continue;
        d1Candidates.push({ col: 'quizzes', id: snap.id, email, name: q.name });
      }
      for (const snap of rmis.docs) {
        const r = snap.data();
        const email = String(r.email || '').toLowerCase().trim();
        if (!email || r.dormantAt || quizEmails.has(email)) continue;
        const age = now - Date.parse(r.createdAt || '');
        if (isNaN(age) || age < 14 * DAY || age > 30 * DAY) continue;
        d1Candidates.push({ col: 'rmi', id: snap.id, email, name: r.name });
      }
      const d1Sent = new Set();
      for (const c of d1Candidates) {
        if (d1Sent.has(c.email) || nudgedEmails.has(c.email)) {
          // still mark dormant so they aren't re-considered daily
          await db.collection(c.col).doc(c.id).set({ dormantAt: new Date().toISOString() }, { merge: true });
          continue;
        }
        const firstName = String(c.name || '').trim().split(/\s+/)[0] || 'there';
        const html = personalEmail(`
          <p>Hi ${e(firstName)},</p>
          <p>I'll leave you be after this note — no more reminders, I promise. Just know the door doesn't close: the <a href="${e(QUIZ_URL)}" style="color:#8B5E5A;">free color quiz</a> and everything that follows will be right here whenever the season is right.</p>
          <p>Until then, one small thing you can start today: a little more color on the plate, a little more water through the day. Small things compound.</p>
          <p>Rooting for you either way.</p>
        `);
        try {
          await transport.sendMail({
            from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
            to: c.email,
            replyTo: FROM_ADDRESS,
            subject: `The door stays open, ${firstName}`,
            html
          });
          d1Sent.add(c.email);
          await db.collection(c.col).doc(c.id).set({
            dormantAt: new Date().toISOString(),
            d1SentAt: new Date().toISOString()
          }, { merge: true });
        } catch (err) {
          console.error(`D1 failed for ${c.col}/${c.id}:`, err);
        }
      }
    }
  );

  return { onIntakeAssessment, onAssessmentRequested, onGoingDeeperCreated, onHoldCleared, onPlanApproved, onConsultHeld, onRmiCreated, dailyNudges };
}

module.exports = { registerRootedPipeline, leakCheck, planText, PLAN_SCHEMA, buildDraftPrompt, DRAFT_SYSTEM };
