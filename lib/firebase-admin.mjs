/**
 * Firebase Admin SDK initialization (server-side / Vercel Functions only).
 *
 * Expects one env var on Vercel:
 *   FIREBASE_ADMIN_KEY  — the full service account JSON, as a single line
 *
 * Get the JSON from:
 *   Firebase Console → Project Settings → Service accounts → Generate new private key
 */

import admin from 'firebase-admin';

let _app = null;

export function getAdmin() {
  if (!_app) {
    const raw = process.env.FIREBASE_ADMIN_KEY;
    if (!raw) {
      throw new Error('FIREBASE_ADMIN_KEY env var is not set');
    }
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch (err) {
      throw new Error('FIREBASE_ADMIN_KEY is not valid JSON: ' + err.message);
    }
    _app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  return admin;
}

export function getDb() {
  return getAdmin().firestore();
}
