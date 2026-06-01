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

// ---- Config ----
const FROM_ADDRESS = 'bethany@houseoffigs.org';
const NOTIFY_TO = [
  'bethany@houseoffigs.org',
  'emily@houseoffigs.org'
];
const DASHBOARD_URL = 'https://houseoffigs.org/admin';

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
