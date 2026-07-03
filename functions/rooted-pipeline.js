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
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');

const { runAssessment } = require('./rooted-engine');
const { COLOR_VOICE, COLOR_LABELS, LEAK_TERMS } = require('./rooted-data');

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
${assessment.conditionAdjustments.map(a => `- ${a.note}`).join('\n') || '(none)'}`;
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
      const intakeId = event.params.docId;
      const db = admin.firestore();
      const now = new Date().toISOString();

      // 1–2. Engine (safety screen runs first inside it).
      const assessment = runAssessment(intake, { formType: 'full' });

      // 3. Tier 1 — store the practitioner-side assessment. Idempotent:
      //    keyed by intake id, so re-runs overwrite rather than duplicate.
      await db.collection('assessments').doc(intakeId).set({
        ...assessment,
        intakeId,
        status: assessment.halted ? 'halted' : 'generated',
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

  return { onIntakeAssessment, onHoldCleared, onPlanApproved };
}

module.exports = { registerRootedPipeline, leakCheck, planText, PLAN_SCHEMA, buildDraftPrompt, DRAFT_SYSTEM };
