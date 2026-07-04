/**
 * House of Figs — Calendly booking gate (Funnel Logic Map T7–T11).
 *
 * The 24-hour rule: the intake must be in the system 24 hours before the
 * consult, or the slot releases automatically with a warm rebook path.
 *
 *   T7  invitee.created  → /bookings doc + B1 (confirmation restating the
 *                          rule; "you're all set" variant if intake in)
 *   T8  intake received  → timers cleared + B2 ("you're all set for [date]")
 *   T9  T-72h, no intake → B3 friendly reminder
 *   T10 T-30h, no intake → B4 final call ("due in 6 hours")
 *   T11 T-24h, no intake → Calendly slot released via API + B5 warm
 *                          cancellation with rebook path (intake first)
 *
 * Setup (once, from the admin dashboard): the "Connect Calendly" button
 * calls calendlySetup, which registers the webhook subscription and
 * stores its signing key in /config/calendly.
 *
 * Secrets: CALENDLY_TOKEN (scoped: webhooks RW, scheduled events R +
 * cancel, user read), GMAIL_APP_PASSWORD (shared).
 *
 * Suppression: a safety-halted contact gets NO automated sends and no
 * auto-cancellation — those route to Bethany (map rule T15).
 */

const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

const { personalEmail, fmtWhen } = require('./rooted-pipeline');

const calendlyToken = defineSecret('CALENDLY_TOKEN');

const CALENDLY_API = 'https://api.calendly.com';
const WEBHOOK_URL = 'https://us-central1-houseoffigs-16f71.cloudfunctions.net/calendlyWebhook';
const INTAKE_URL = 'https://houseoffigs.org/intake.html?from=quiz';
const BOOKING_URL = 'https://calendly.com/figatry/30min';

const ADMIN_EMAILS = ['bethany@houseoffigs.org', 'emily@houseoffigs.org'];

async function calendlyFetch(path, options = {}) {
  const res = await fetch(path.startsWith('http') ? path : CALENDLY_API + path, {
    ...options,
    headers: {
      'Authorization': `Bearer ${calendlyToken.value()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendly ${options.method || 'GET'} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

function uuidFromUri(uri) {
  return String(uri || '').split('/').pop();
}

function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function registerCalendly({ gmailPassword, makeTransport, FROM_ADDRESS, NOTIFY_TO, escape }) {
  const e = escape;

  // -------------------------------------------------------------------
  // Setup — called from the admin ("Connect Calendly"). Registers the
  // webhook subscription and stores the signing key.
  // -------------------------------------------------------------------
  const calendlySetup = onCall(
    { secrets: [calendlyToken] },
    async (request) => {
      const email = (request.auth && request.auth.token && request.auth.token.email || '').toLowerCase();
      if (!request.auth || !ADMIN_EMAILS.includes(email)) {
        throw new HttpsError('permission-denied', 'Admins only.');
      }

      const me = await calendlyFetch('/users/me');
      const userUri = me.resource.uri;
      const orgUri = me.resource.current_organization;

      // Remove any prior subscription we created (idempotent reconnect).
      const db = admin.firestore();
      const cfgRef = db.collection('config').doc('calendly');
      const cfg = (await cfgRef.get()).data() || {};
      if (cfg.subscriptionUri) {
        try { await calendlyFetch(cfg.subscriptionUri, { method: 'DELETE' }); }
        catch (err) { console.warn('Old subscription cleanup failed (continuing):', err.message); }
      }

      const sub = await calendlyFetch('/webhook_subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          url: WEBHOOK_URL,
          events: ['invitee.created', 'invitee.canceled'],
          organization: orgUri,
          user: userUri,
          scope: 'user'
        })
      });

      await cfgRef.set({
        subscriptionUri: sub.resource.uri,
        signingKey: sub.resource.signing_key || null,
        userUri,
        orgUri,
        connectedBy: email,
        connectedAt: new Date().toISOString()
      });

      return { ok: true, subscription: sub.resource.uri };
    }
  );

  // -------------------------------------------------------------------
  // Webhook — invitee.created / invitee.canceled
  // -------------------------------------------------------------------
  const calendlyWebhook = onRequest(
    { secrets: [gmailPassword] },
    async (req, res) => {
      if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
      const db = admin.firestore();

      // Verify signature against the stored signing key.
      try {
        const cfg = (await db.collection('config').doc('calendly').get()).data();
        const key = cfg && cfg.signingKey;
        if (key) {
          const sig = String(req.get('Calendly-Webhook-Signature') || '');
          const t = (sig.match(/t=([^,]+)/) || [])[1];
          const v1 = (sig.match(/v1=([^,]+)/) || [])[1];
          const expected = crypto.createHmac('sha256', key)
            .update(`${t}.${req.rawBody.toString()}`).digest('hex');
          if (!t || !v1 || !crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) {
            console.warn('Calendly signature mismatch — rejecting');
            res.status(401).send('bad signature');
            return;
          }
        }
      } catch (err) {
        console.error('Signature verification error:', err);
        res.status(401).send('verification failed');
        return;
      }

      const { event, payload } = req.body || {};
      if (!payload) { res.status(400).send('no payload'); return; }

      const eventUuid = uuidFromUri(payload.scheduled_event && payload.scheduled_event.uri);
      if (!eventUuid) { res.status(200).send('ignored'); return; }
      const ref = db.collection('bookings').doc(eventUuid);

      if (event === 'invitee.created') {
        const email = String(payload.email || '').toLowerCase().trim();
        const startTime = payload.scheduled_event.start_time;

        // Match an intake by email (T8 may already have happened pre-booking).
        const intakeSnap = await db.collection('intakes').get();
        const matched = intakeSnap.docs.find(d =>
          String(d.data().email || d.data().Email || '').toLowerCase().trim() === email);

        await ref.set({
          eventUuid,
          email,
          name: payload.name || '',
          startTime,
          cancelUrl: payload.cancel_url || '',
          rescheduleUrl: payload.reschedule_url || '',
          inviteeUri: payload.uri || '',
          status: 'booked',
          intakeId: matched ? matched.id : null,
          intakeMatchedAt: matched ? new Date().toISOString() : null,
          b3SentAt: null, b4SentAt: null,
          createdAt: new Date().toISOString()
        });

        // Record consult time on the journey when we know the intake.
        if (matched) {
          await db.collection('assessments').doc(matched.id).set({
            journey: { consultAt: startTime },
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }

        // B1 — confirmation (T7). Variant depends on intake presence.
        const firstName = firstNameOf(payload.name);
        const when = fmtWhen(startTime);
        const transport = makeTransport();
        const html = matched
          ? personalEmail(`
              <p>Hi ${e(firstName)},</p>
              <p>You're all set — we're on the calendar for <strong>${e(when)}</strong>, and your intake is already in my hands. I'll read every word before we talk.</p>
              <p>Our twenty minutes together: I'll reflect back what I heard in your story, we'll look at the one color that spoke loudest, and you'll leave with one genuinely useful thing to try — and your custom juice recipe direction.</p>
              <p>Nothing to prepare. Come as you are.</p>`)
          : personalEmail(`
              <p>Hi ${e(firstName)},</p>
              <p>Your free consultation is confirmed for <strong>${e(when)}</strong> — I'm looking forward to it.</p>
              <p>One thing makes this conversation worth far more than twenty minutes: your intake. <strong>Please have it complete at least 24 hours before we meet</strong> — it's how I walk in already knowing your story instead of spending our time gathering it.</p>
              <p>Complete your intake here: <a href="${e(INTAKE_URL)}" style="color:#8B5E5A;">${e(INTAKE_URL)}</a> (about 10–15 minutes)</p>
              <p>A kind heads-up on the rule: if the intake isn't in 24 hours before our time, the session releases automatically so the slot can serve someone ready — and you can simply rebook once your intake is done. No harm, no shame, whenever you're ready.</p>`);

        await transport.sendMail({
          from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
          to: email,
          replyTo: FROM_ADDRESS,
          subject: matched
            ? `You're all set for ${when}, ${firstName}`
            : `Confirmed for ${when} — one step to hold it, ${firstName}`,
          html
        });
        await ref.set({ b1SentAt: new Date().toISOString(), b1Variant: matched ? 'all_set' : 'intake_needed' }, { merge: true });

      } else if (event === 'invitee.canceled') {
        const existing = (await ref.get()).data() || {};
        // Our own T-24h cancellation already handled status + B5.
        if (existing.status !== 'auto_canceled') {
          await ref.set({
            status: 'canceled',
            canceledAt: new Date().toISOString(),
            cancelReason: (payload.cancellation && payload.cancellation.reason) || ''
          }, { merge: true });
        }
      }

      res.status(200).send('ok');
    }
  );

  // -------------------------------------------------------------------
  // T8 — intake received AFTER booking: clear timers, send B2, stamp the
  // consult time onto the journey.
  // -------------------------------------------------------------------
  const onIntakeBookingMatch = onDocumentCreated(
    {
      document: 'intakes/{docId}',
      secrets: [gmailPassword]
    },
    async (event) => {
      const intake = event.data && event.data.data();
      if (!intake) return;
      const email = String(intake.email || intake.Email || '').toLowerCase().trim();
      if (!email) return;
      const db = admin.firestore();

      const open = await db.collection('bookings')
        .where('email', '==', email)
        .where('status', '==', 'booked')
        .get();
      if (open.empty) return;

      const transport = makeTransport();
      for (const snap of open.docs) {
        const b = snap.data();
        if (b.intakeMatchedAt) continue;
        await snap.ref.set({
          intakeId: event.params.docId,
          intakeMatchedAt: new Date().toISOString()
        }, { merge: true });

        await db.collection('assessments').doc(event.params.docId).set({
          journey: { consultAt: b.startTime },
          updatedAt: new Date().toISOString()
        }, { merge: true });

        const firstName = firstNameOf(b.name);
        const when = fmtWhen(b.startTime);
        await transport.sendMail({
          from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
          to: email,
          replyTo: FROM_ADDRESS,
          subject: `You're all set for ${when}, ${firstName}`,
          html: personalEmail(`
            <p>Hi ${e(firstName)},</p>
            <p>Your intake just arrived — thank you. <strong>You're all set for ${e(when)}.</strong> I'll read every word before we talk.</p>
            <p>What to expect from our twenty minutes: I'll reflect back what I heard in your story, we'll look at the one color that spoke loudest across your answers, and you'll leave with one genuinely useful thing to try this week — plus the direction for your custom juice recipe.</p>
            <p>Nothing else to prepare. Come as you are.</p>`)
        });
        await snap.ref.set({ b2SentAt: new Date().toISOString() }, { merge: true });
      }
    }
  );

  // -------------------------------------------------------------------
  // Hourly timers — T9 (T-72h), T10 (T-30h), T11 (T-24h auto-cancel).
  // -------------------------------------------------------------------
  const bookingTimers = onSchedule(
    {
      schedule: '0 * * * *',
      timeZone: 'Etc/UTC',
      secrets: [gmailPassword, calendlyToken]
    },
    async () => {
      const db = admin.firestore();
      const now = Date.now();
      const HOUR = 3600 * 1000;
      const transport = makeTransport();

      // Safety-hold suppression set (map rule: holds suspend everything).
      const halted = new Set();
      (await db.collection('assessments').where('status', '==', 'halted').get())
        .docs.forEach(d => {
          const em = d.data().client && d.data().client.email;
          if (em) halted.add(String(em).toLowerCase().trim());
        });

      const open = await db.collection('bookings').where('status', '==', 'booked').get();
      for (const snap of open.docs) {
        const b = snap.data();
        const start = Date.parse(b.startTime || '');
        if (isNaN(start)) continue;
        const hoursOut = (start - now) / HOUR;

        if (hoursOut <= 0) {
          await snap.ref.set({ status: 'completed', completedAt: new Date().toISOString() }, { merge: true });
          continue;
        }
        if (b.intakeMatchedAt) continue;              // timers cleared (T8)
        if (halted.has(b.email)) continue;            // safety hold — Bethany decides

        const firstName = firstNameOf(b.name);
        const when = fmtWhen(b.startTime);

        // T11 — auto-cancel at T-24h. Release the slot, then B5.
        if (hoursOut <= 24) {
          try {
            await calendlyFetch(`/scheduled_events/${b.eventUuid}/cancellation`, {
              method: 'POST',
              body: JSON.stringify({ reason: 'Intake not received 24 hours before the session — released per the booking policy. Warm rebook email sent.' })
            });
          } catch (err) {
            console.error(`Auto-cancel failed for ${b.eventUuid} (continuing to email):`, err.message);
          }
          await transport.sendMail({
            from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
            to: b.email,
            replyTo: FROM_ADDRESS,
            subject: `Whenever you're ready, ${firstName} — your session released today`,
            html: personalEmail(`
              <p>Hi ${e(firstName)},</p>
              <p>Since your intake hadn't arrived 24 hours ahead, I've released ${e(when)} — exactly as promised, and with zero hard feelings. Life is full; this happens.</p>
              <p>The path back is simple, whenever you're ready:</p>
              <p>1. Complete your intake: <a href="${e(INTAKE_URL)}" style="color:#8B5E5A;">${e(INTAKE_URL)}</a><br>
              2. Then pick a new time: <a href="${e(BOOKING_URL)}" style="color:#8B5E5A;">${e(BOOKING_URL)}</a></p>
              <p>That order matters only because it lets me read your story before we talk — which is the whole reason our twenty minutes will be worth your time.</p>`)
          });
          await snap.ref.set({ status: 'auto_canceled', autoCanceledAt: new Date().toISOString(), b5SentAt: new Date().toISOString() }, { merge: true });
          // Flag Bethany so nothing is a surprise.
          await transport.sendMail({
            from: `House of Figs <${FROM_ADDRESS}>`,
            to: NOTIFY_TO.join(', '),
            subject: `Auto-released: ${b.name || b.email} (${when}) — intake never arrived`,
            html: personalEmail(`<p>The 24-hour gate released <strong>${e(b.name || b.email)}</strong>'s session (${e(when)}). B5 rebook email sent. No action needed unless you'd like to reach out personally.</p>`)
          });
          continue;
        }

        // T10 — final call at T-30h ("due in 6 hours").
        if (hoursOut <= 30 && !b.b4SentAt) {
          await transport.sendMail({
            from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
            to: b.email,
            replyTo: FROM_ADDRESS,
            subject: `${firstName}, your intake is due in 6 hours to hold ${when}`,
            html: personalEmail(`
              <p>Hi ${e(firstName)},</p>
              <p>A kind but clear note: <strong>your intake is due in the next 6 hours</strong> to hold your session on ${e(when)}. If it isn't in by 24 hours before our time, the slot releases automatically and you'd simply rebook after — but I'd love not to lose our time.</p>
              <p>It takes about 10–15 minutes: <a href="${e(INTAKE_URL)}" style="color:#8B5E5A;">${e(INTAKE_URL)}</a></p>
              <p>If life's in the way and you'd rather move the session, that's easy too — just reply and we'll find a better time.</p>`)
          });
          await snap.ref.set({ b4SentAt: new Date().toISOString() }, { merge: true });
          continue;
        }

        // T9 — friendly reminder at T-72h.
        if (hoursOut <= 72 && !b.b3SentAt) {
          await transport.sendMail({
            from: `Bethany Grissum, House of Figs <${FROM_ADDRESS}>`,
            to: b.email,
            replyTo: FROM_ADDRESS,
            subject: `Before we meet ${when}, ${firstName}`,
            html: personalEmail(`
              <p>Hi ${e(firstName)},</p>
              <p>We're on for <strong>${e(when)}</strong> — and the one thing that makes those twenty minutes really count is your intake, due 24 hours before we meet.</p>
              <p>It takes about 10–15 minutes, whenever you have a quiet moment: <a href="${e(INTAKE_URL)}" style="color:#8B5E5A;">${e(INTAKE_URL)}</a></p>
              <p>I read every word before the call — that's the difference between a generic chat and a conversation about <em>you</em>.</p>`)
          });
          await snap.ref.set({ b3SentAt: new Date().toISOString() }, { merge: true });
        }
      }
    }
  );

  return { calendlySetup, calendlyWebhook, onIntakeBookingMatch, bookingTimers };
}

module.exports = { registerCalendly };
