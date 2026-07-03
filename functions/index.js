/**
 * House of Figs — email notifications
 *
 * Two Cloud Functions:
 *   - onIntakeCreated         fires once when a new doc lands in /intakes
 *   - onQuizEmailCaptured     fires when a quiz doc is updated with an email
 *                             (i.e. the user finished the front-loaded gate)
 *
 * Emails are sent from bethany@houseoffigs.org via Gmail SMTP using a
 * Workspace App Password stored as a Firebase Functions secret.
 *
 * To set the secret once:
 *   firebase functions:secrets:set GMAIL_APP_PASSWORD
 *
 * Then deploy:
 *   firebase deploy --only functions
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

admin.initializeApp();

// ---- Config ----
const FROM_ADDRESS = 'bethany@houseoffigs.org';
const NOTIFY_TO = [
  'bethany@houseoffigs.org',
  'emily@houseoffigs.org'
];
const DASHBOARD_URL = 'https://houseoffigs.org/admin';

// Client-facing links used in the quiz follow-up emails. The intake link
// carries ?from=quiz — the intake page is gated quiz-first, and this is
// how emailed quiz-completers pass the gate on any device.
const INTAKE_URL = 'https://houseoffigs.org/intake.html?from=quiz';
const BOOKING_URL = 'https://calendly.com/houseoffigscompany/30min';

const gmailPassword = defineSecret('GMAIL_APP_PASSWORD');

setGlobalOptions({ region: 'us-central1', maxInstances: 5 });

// Lazily build the SMTP transport so cold starts don't pay the cost
// when no email is actually sent.
function makeTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: FROM_ADDRESS,
      pass: gmailPassword.value()
    }
  });
}

function escape(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emailShell(headlineHtml, bodyHtml, ctaUrl, ctaLabel) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background-color:#f5f0ea;font-family:'Helvetica Neue',Arial,sans-serif;color:#2C2C2C;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f0ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(74,55,40,0.08);">
        <tr><td style="background:linear-gradient(135deg,#4A3728 0%,#6B4F3A 100%);padding:28px 32px;">
          <div style="font-family:Georgia,serif;font-size:1.5rem;color:#F5F0EA;font-weight:500;letter-spacing:0.01em;">House of Figs</div>
          <div style="font-family:Georgia,serif;font-style:italic;color:rgba(245,240,234,0.7);font-size:0.875rem;margin-top:2px;">Rooted wellness. Sustainable transformation.</div>
        </td></tr>
        <tr><td style="padding:32px;">
          <div style="font-family:Georgia,serif;font-size:1.5rem;color:#4A3728;font-weight:500;line-height:1.25;margin-bottom:20px;">${headlineHtml}</div>
          ${bodyHtml}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;">
            <tr><td style="border-radius:6px;background-color:#8B5E5A;">
              <a href="${escape(ctaUrl)}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:500;font-size:0.9375rem;">${escape(ctaLabel)} &rarr;</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 32px 28px;border-top:1px solid #ece2cf;color:#897866;font-size:0.75rem;line-height:1.5;">
          You're receiving this because you're an admin of the House of Figs site.<br>
          <a href="${DASHBOARD_URL}" style="color:#8B5E5A;text-decoration:none;">houseoffigs.org/admin</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function fieldRow(label, value) {
  if (value == null || value === '') return '';
  return `
    <div style="margin-bottom:10px;">
      <div style="font-size:0.75rem;letter-spacing:0.06em;text-transform:uppercase;color:#6B7F5E;font-weight:600;margin-bottom:2px;">${escape(label)}</div>
      <div style="font-size:0.9375rem;color:#2C2C2C;line-height:1.5;">${escape(value)}</div>
    </div>`;
}

// Client-facing intake receipt: a short "it arrived, here's what happens
// next" note. The plan itself is NEVER sent here — Bethany reviews results
// with the client in real time at the first health meeting.
function intakeReceiptHtml(firstName) {
  const paras = [
    'Thank you for trusting me with your story — your intake arrived safely.',
    'Here is what happens next: I personally review everything you shared and prepare for your first health meeting. When we sit down together, we’ll walk through what your answers reveal and map out your path forward — nothing is decided without you in the room.',
    'If you haven’t scheduled your consultation yet, you can do that below.'
  ].map(p => `<p style="font-size:0.9375rem;color:#2C2C2C;line-height:1.7;margin:0 0 18px;">${escape(p)}</p>`).join('\n          ');

  return `<!doctype html>
<html><body style="margin:0;padding:0;background-color:#f5f0ea;font-family:'Helvetica Neue',Arial,sans-serif;color:#2C2C2C;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;">Your intake arrived safely — here’s what happens next.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f0ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(74,55,40,0.08);">
        <tr><td style="background:linear-gradient(135deg,#4A3728 0%,#6B4F3A 100%);padding:24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <div style="font-family:Georgia,serif;font-size:1.5rem;color:#F5F0EA;font-weight:500;">House of Figs</div>
              <div style="font-family:Georgia,serif;font-style:italic;color:rgba(245,240,234,0.7);font-size:0.875rem;margin-top:2px;">Rooted wellness. Sustainable transformation.</div>
            </td>
            <td align="right" style="vertical-align:middle;width:104px;">
              <img src="https://houseoffigs.org/images/logo-light-email.png" alt="House of Figs" width="104" height="90" style="display:block;border:0;">
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="font-size:0.9375rem;color:#2C2C2C;line-height:1.7;margin:0 0 18px;">Hi ${escape(firstName)},</p>
          ${paras}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 10px;">
            <tr><td style="border-radius:6px;background-color:#8B5E5A;">
              <a href="${escape(BOOKING_URL)}" style="display:inline-block;padding:13px 26px;color:#ffffff;text-decoration:none;font-weight:600;font-size:0.9375rem;">Book your consultation &rarr;</a>
            </td></tr>
          </table>
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #ece2cf;">
            <p style="font-family:Georgia,serif;font-style:italic;color:#4A3728;font-size:1rem;margin:0 0 10px;">Rooted with you,</p>
            <div style="font-family:Georgia,serif;font-size:1.05rem;color:#4A3728;font-weight:500;">Bethany Grissum</div>
            <div style="font-size:0.8125rem;color:#897866;line-height:1.6;margin-top:3px;">Founder, House of Figs<br>
              <span style="font-style:italic;">Rooted wellness. Sustainable transformation.</span><br>
              <a href="https://houseoffigs.org" style="color:#8B5E5A;text-decoration:none;">houseoffigs.org</a> &middot; @hofigs</div>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px 28px;border-top:1px solid #ece2cf;color:#897866;font-size:0.6875rem;line-height:1.5;">
          You’re receiving this because you completed an intake at
          <a href="https://houseoffigs.org" style="color:#8B5E5A;text-decoration:none;">houseoffigs.org</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// =========================================================================
// INTAKE — every new submission gets a notification
// =========================================================================
exports.onIntakeCreated = onDocumentCreated(
  {
    document: 'intakes/{docId}',
    secrets: [gmailPassword]
  },
  async (event) => {
    const data = event.data && event.data.data();
    if (!data) return;

    const fullName = data['Full name'] || data['full-name'] || 'Unnamed';
    const preferredName = data['Preferred name'] || data['preferred-name'] || '';
    const emailAddr = data.email || data.Email || '';
    const phone = data.Phone || data.phone || '';
    const reason = data['Main reason for reaching out'] || data.reason || '';
    const goals = data['Top health goals'] || data.goals || '';
    const referral = data['How did you hear about House of Figs'] || data.referral || '';

    const body =
      fieldRow('Name', fullName + (preferredName && preferredName !== fullName ? ` (goes by ${preferredName})` : '')) +
      fieldRow('Email', emailAddr) +
      fieldRow('Phone', phone) +
      fieldRow('Main reason', reason) +
      fieldRow('Top health goals', goals) +
      fieldRow('Found us via', referral);

    const html = emailShell(
      `New intake from <em>${escape(fullName)}</em>`,
      body,
      DASHBOARD_URL,
      'Review intake in dashboard'
    );

    const transport = makeTransport();
    await transport.sendMail({
      from: `House of Figs <${FROM_ADDRESS}>`,
      to: NOTIFY_TO.join(', '),
      replyTo: emailAddr || FROM_ADDRESS,
      subject: `New intake — ${fullName}`,
      html: html
    });

    // Confirmation receipt to the client. Separate try/catch so a bad
    // client address can never break the admin notification above.
    if (emailAddr) {
      try {
        const firstName = String(preferredName || fullName || '').trim().split(/\s+/)[0] || 'there';
        await transport.sendMail({
          from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
          to: emailAddr,
          replyTo: FROM_ADDRESS,
          subject: `${firstName}, your intake is in my hands`,
          html: intakeReceiptHtml(firstName),
          text:
            `Hi ${firstName},\n\n` +
            `Thank you for trusting me with your story — your intake arrived safely.\n\n` +
            `Here's what happens next: I personally review everything you shared and prepare for your first health meeting. When we sit down together, we'll walk through what your answers reveal and map out your path forward — nothing is decided without you in the room.\n\n` +
            `If you haven't scheduled your consultation yet, you can do that here: ${BOOKING_URL}\n\n` +
            `Rooted with you,\nBethany\n\n` +
            `Bethany Grissum — Founder, House of Figs\n` +
            `Rooted wellness. Sustainable transformation.\n` +
            `houseoffigs.org · @hofigs`
        });
      } catch (err) {
        console.error('Intake receipt email failed (admin notify already sent):', err);
      }
    }
  }
);

// =========================================================================
// QUIZ — notify when the email gate is submitted (lead captured).
// Anonymous quiz completions don't trigger an email; only when the user
// finishes the gate and gives us a name+email.
// =========================================================================
exports.onQuizEmailCaptured = onDocumentUpdated(
  {
    document: 'quizzes/{docId}',
    secrets: [gmailPassword]
  },
  async (event) => {
    const before = event.data && event.data.before.data();
    const after = event.data && event.data.after.data();
    if (!before || !after) return;

    // Only fire when email transitions from absent → present
    if (before.email || !after.email) return;

    const name = after.name || 'New visitor';
    const emailAddr = after.email;
    const profile = (after.profile && after.profile.title) || '';
    const profileSub = (after.profile && after.profile.subtitle) || '';

    const body =
      fieldRow('Name', name) +
      fieldRow('Email', emailAddr) +
      fieldRow('Quiz profile', profile + (profileSub ? ` — ${profileSub}` : ''));

    const html = emailShell(
      `New quiz lead — <em>${escape(name)}</em>`,
      body,
      DASHBOARD_URL,
      'View quiz response in dashboard'
    );

    const transport = makeTransport();
    await transport.sendMail({
      from: `House of Figs <${FROM_ADDRESS}>`,
      to: NOTIFY_TO.join(', '),
      replyTo: emailAddr || FROM_ADDRESS,
      subject: profile
        ? `New quiz lead — ${name} (${profile})`
        : `New quiz lead — ${name}`,
      html: html
    });
  }
);

// =========================================================================
// QUIZ FOLLOW-UP — personalized email sent TO the quiz-taker.
// One email per profile (Rebuilder / Balancer / Energizer), fired once when
// the email gate is submitted. Keyed off after.profile.title, which the quiz
// writes before the email update lands. Runs as its own function so a failure
// here never blocks the admin lead notification above.
// =========================================================================

// Copy is provided by the client (House of Figs). Keyed by the exact
// profile.title string the quiz stores.
const QUIZ_FOLLOWUPS = {
  'The Rebuilder': {
    subject: 'Your results are in — you’re a Rebuilder',
    preview: 'Why the intake form is the other half of your picture.',
    paragraphs: [
      'Thank you for taking a few quiet minutes to check in with your body. Your answers point to a clear pattern: you’re a Rebuilder, and your body is asking for restoration.',
      'A Rebuilder’s body is reaching for the deep, jewel-toned foods right now: the reds, blues, and purples. Cooked tomatoes and pomegranate. Wild blueberries and Concord grapes. Beets, figs, and black grapes. These are the foods of recovery and renewal, the ones that help a tired, worked-hard body settle, repair, and come back to itself.',
      'If you’d like somewhere to begin today, keep it small: add one deep-colored food to a single meal. A handful of frozen wild blueberries in the morning. Roasted beets at dinner. Nothing to overhaul, just one quiet act of restoration. Because this was never about restriction. It’s about rebuilding.',
      'When you’re ready to go deeper, I’d love to meet you — and the next step is your intake form. Think of your quiz and your intake as a pair. The quiz was a first glance at which colors your body is reaching for. The intake fills in the rest of your story: your rhythms, your history, the way your body has been speaking to you day to day. On their own, each tells me a little. Together, they give us a clear picture of where restoration needs to begin, so we’re never guessing. By the time we sit down for your free consultation, your starting point is already in front of us, and our whole conversation can go toward the path forward.',
      'It only takes a few minutes, and it’s the most useful thing you can do before we talk.'
    ]
  },
  'The Balancer': {
    subject: 'Your results are in — you’re a Balancer',
    preview: 'Why the intake form is the other half of your picture.',
    paragraphs: [
      'Thank you for taking a few quiet minutes to check in with your body. Your answers point to a clear pattern: you’re a Balancer, and your body is asking for harmony and gentle support.',
      'A Balancer’s body is doing the quiet, everyday work of digesting, clearing, and grounding, and it’s reaching for the greens, whites, and earthy browns to help. Leafy greens and broccoli sprouts. Garlic, onions, and leeks. Lentils, oats, and flaxseed. These are the foods that steady digestion, support your body’s natural rhythms of renewal, and help everything run a little smoother.',
      'If you’d like somewhere to begin today, make it simple: add one grounding food to your plate. A spoonful of ground flax in the morning. A handful of greens at lunch. Sautéed onions at dinner. One small step toward balance.',
      'When you’re ready to go deeper, I’d love to meet you — and the next step is your intake form. Think of your quiz and your intake as a pair. The quiz was a first glance at which colors your body is reaching for. The intake fills in the rest of your story: your rhythms, your history, the way your body has been speaking to you day to day. On their own, each tells me a little. Together, they give us a clear picture of where your body is asking for balance, so we’re never guessing. By the time we sit down for your free consultation, your starting point is already in front of us, and our whole conversation can go toward the path forward.',
      'It only takes a few minutes, and it’s the most useful thing you can do before we talk.'
    ]
  },
  'The Energizer': {
    subject: 'Your results are in — you’re an Energizer',
    preview: 'Why the intake form is the other half of your picture.',
    paragraphs: [
      'Thank you for taking a few quiet minutes to check in with your body. Your answers point to a clear pattern: you’re an Energizer, and your body is hungry for fuel and defense.',
      'An Energizer’s body is looking for steady energy through the day and strong, resilient defenses, and it’s reaching for the oranges, yellows, and earthy browns to get there. Sweet potato, carrots, and pumpkin. Citrus, pineapple, and yellow peppers. Oats, lentils, and quinoa. These are the foods that build steady fuel, support your immune strength, and soften those afternoon crashes.',
      'If you’d like somewhere to begin today, keep it easy: add one fueling food to your plate. Roasted sweet potato at dinner. A squeeze of fresh citrus over your greens. A warm bowl of oats to start the morning. One small step toward steadier energy.',
      'When you’re ready to go deeper, I’d love to meet you — and the next step is your intake form. Think of your quiz and your intake as a pair. The quiz was a first glance at which colors your body is reaching for. The intake fills in the rest of your story: your rhythms, your history, the way your body has been speaking to you day to day. On their own, each tells me a little. Together, they give us a clear picture of where your energy is asking to be rebuilt, so we’re never guessing. By the time we sit down for your free consultation, your starting point is already in front of us, and our whole conversation can go toward the path forward.',
      'It only takes a few minutes, and it’s the most useful thing you can do before we talk.'
    ]
  }
};

// First name only, with a graceful fallback so the greeting always reads well.
function firstNameOf(name) {
  const first = String(name == null ? '' : name).trim().split(/\s+/)[0];
  return first || 'there';
}

// Client-facing branded shell: two CTAs (intake primary, booking secondary)
// plus Bethany's signature. Distinct from the admin emailShell.
function clientEmailShell(firstName, tpl) {
  const paras = tpl.paragraphs
    .map((p) => `<p style="font-size:0.9375rem;color:#2C2C2C;line-height:1.7;margin:0 0 18px;">${escape(p)}</p>`)
    .join('\n          ');

  return `<!doctype html>
<html><body style="margin:0;padding:0;background-color:#f5f0ea;font-family:'Helvetica Neue',Arial,sans-serif;color:#2C2C2C;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;">${escape(tpl.preview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f0ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(74,55,40,0.08);">
        <tr><td style="background:linear-gradient(135deg,#4A3728 0%,#6B4F3A 100%);padding:24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;">
              <div style="font-family:Georgia,serif;font-size:1.5rem;color:#F5F0EA;font-weight:500;letter-spacing:0.01em;">House of Figs</div>
              <div style="font-family:Georgia,serif;font-style:italic;color:rgba(245,240,234,0.7);font-size:0.875rem;margin-top:2px;">Rooted wellness. Sustainable transformation.</div>
            </td>
            <td align="right" style="vertical-align:middle;width:104px;">
              <img src="https://houseoffigs.org/images/logo-light-email.png" alt="House of Figs" width="104" height="90" style="display:block;border:0;outline:none;text-decoration:none;">
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="font-size:0.9375rem;color:#2C2C2C;line-height:1.7;margin:0 0 18px;">Hi ${escape(firstName)},</p>
          ${paras}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 10px;">
            <tr><td style="border-radius:6px;background-color:#8B5E5A;">
              <a href="${escape(INTAKE_URL)}" style="display:inline-block;padding:13px 26px;color:#ffffff;text-decoration:none;font-weight:600;font-size:0.9375rem;">Complete your intake &rarr;</a>
            </td></tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;">
            <tr><td style="border-radius:6px;border:1px solid #8B5E5A;">
              <a href="${escape(BOOKING_URL)}" style="display:inline-block;padding:12px 25px;color:#8B5E5A;text-decoration:none;font-weight:600;font-size:0.9375rem;">Book your free consultation &rarr;</a>
            </td></tr>
          </table>
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #ece2cf;">
            <p style="font-family:Georgia,serif;font-style:italic;color:#4A3728;font-size:1rem;margin:0 0 10px;">Rooted with you,</p>
            <div style="font-family:Georgia,serif;font-size:1.05rem;color:#4A3728;font-weight:500;">Bethany Grissum</div>
            <div style="font-size:0.8125rem;color:#897866;line-height:1.6;margin-top:3px;">Founder, House of Figs<br>
              <span style="font-style:italic;">Rooted wellness. Sustainable transformation.</span><br>
              <a href="https://houseoffigs.org" style="color:#8B5E5A;text-decoration:none;">houseoffigs.org</a> &middot; @hofigs</div>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px 28px;border-top:1px solid #ece2cf;color:#897866;font-size:0.6875rem;line-height:1.5;">
          You’re receiving this because you completed the color quiz at
          <a href="https://houseoffigs.org/quiz.html" style="color:#8B5E5A;text-decoration:none;">houseoffigs.org</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Plain-text alternative — improves deliverability and serves text-only clients.
function clientPlainText(firstName, tpl) {
  return (
    `Hi ${firstName},\n\n` +
    tpl.paragraphs.join('\n\n') +
    `\n\nComplete your intake: ${INTAKE_URL}` +
    `\nBook your free consultation: ${BOOKING_URL}\n\n` +
    `Rooted with you,\nBethany\n\n` +
    `Bethany Grissum — Founder, House of Figs\n` +
    `Rooted wellness. Sustainable transformation.\n` +
    `houseoffigs.org · @hofigs`
  );
}

exports.onQuizFollowupEmail = onDocumentUpdated(
  {
    document: 'quizzes/{docId}',
    secrets: [gmailPassword]
  },
  async (event) => {
    const before = event.data && event.data.before.data();
    const after = event.data && event.data.after.data();
    if (!before || !after) return;

    // Same gate as the admin notification: fire once, when email first appears.
    if (before.email || !after.email) return;

    const profileTitle = after.profile && after.profile.title;
    const tpl = profileTitle && QUIZ_FOLLOWUPS[profileTitle];
    if (!tpl) {
      console.warn(`No follow-up template for profile "${profileTitle}" (quiz ${event.params.docId}); skipping client email.`);
      return;
    }

    const firstName = firstNameOf(after.name);

    const transport = makeTransport();
    await transport.sendMail({
      from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
      to: after.email,
      replyTo: FROM_ADDRESS,
      subject: tpl.subject,
      text: clientPlainText(firstName, tpl),
      html: clientEmailShell(firstName, tpl)
    });
  }
);

// =========================================================================
// ROOTED ASSESSMENT PIPELINE — engine + Claude-drafted plan (see
// rooted-pipeline.js). Registered here so it shares the email helpers.
// =========================================================================
const { registerRootedPipeline } = require('./rooted-pipeline');
Object.assign(exports, registerRootedPipeline({
  gmailPassword,
  makeTransport,
  emailShell,
  FROM_ADDRESS,
  NOTIFY_TO,
  DASHBOARD_URL,
  escape
}));
