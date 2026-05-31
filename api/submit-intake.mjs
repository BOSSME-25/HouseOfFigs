/**
 * POST /api/submit-intake
 *
 * Stores a pre-consultation intake form submission in Firestore.
 * Body is the full form object from intake.html. We pass it through as-is
 * after some light validation and trimming.
 */

import { getDb } from '../lib/firebase-admin.mjs';

const MAX_FIELDS = 200;
const MAX_FIELD_LEN = 5000;

function sanitize(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(sanitize);
  }
  if (typeof value === 'object') {
    // Don't allow nested objects from the form
    return String(value).slice(0, MAX_FIELD_LEN);
  }
  return String(value).slice(0, MAX_FIELD_LEN);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};

    // Find an email field for indexing — intake form uses lowercase "email"
    const emailRaw =
      (typeof body.email === 'string' && body.email) ||
      (typeof body.Email === 'string' && body.Email) ||
      '';
    const email = emailRaw.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    // Build a sanitized copy
    const fields = Object.keys(body).slice(0, MAX_FIELDS);
    const data = {};
    for (const key of fields) {
      data[key] = sanitize(body[key]);
    }
    data.email = email.slice(0, 320);
    data.createdAt = new Date().toISOString();
    data.userAgent = (req.headers['user-agent'] || '').slice(0, 500);
    data.referer = (req.headers.referer || '').slice(0, 500);

    const db = getDb();
    const ref = await db.collection('intakes').add(data);

    return res.status(200).json({ success: true, id: ref.id });
  } catch (err) {
    console.error('submit-intake error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
