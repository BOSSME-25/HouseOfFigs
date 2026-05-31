/**
 * POST /api/submit-quiz
 *
 * Accepts two kinds of submissions for the same sessionId:
 *
 * 1. After the user finishes the quiz (anonymous):
 *    { sessionId, answers, profile }
 *
 * 2. After the user enters their email on the results page (lead capture):
 *    { sessionId, email, name }
 *
 * Both write to the same Firestore document so we can connect quiz answers
 * to the lead later in the admin dashboard.
 */

import { getDb } from '../lib/firebase-admin.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const { sessionId, answers, profile, email, name } = body;

    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 200) {
      return res.status(400).json({ error: 'Invalid sessionId' });
    }

    // Basic shape validation. Either it's the initial answers payload, or an email payload.
    const hasAnswers = Array.isArray(answers) && profile && typeof profile === 'object';
    const hasEmail = typeof email === 'string' && email.includes('@');

    if (!hasAnswers && !hasEmail) {
      return res.status(400).json({ error: 'Missing answers or email' });
    }

    const db = getDb();
    const ref = db.collection('quizzes').doc(sessionId);
    const nowIso = new Date().toISOString();

    const update = {
      sessionId,
      updatedAt: nowIso,
    };

    if (hasAnswers) {
      update.answers = answers;
      update.profile = profile;
      update.createdAt = nowIso;
      update.userAgent = (req.headers['user-agent'] || '').slice(0, 500);
      update.referer = (req.headers.referer || '').slice(0, 500);
    }

    if (hasEmail) {
      update.email = email.trim().toLowerCase().slice(0, 320);
      if (typeof name === 'string') update.name = name.trim().slice(0, 200);
      update.emailCapturedAt = nowIso;
    }

    await ref.set(update, { merge: true });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('submit-quiz error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
