/**
 * Public-site Firebase client.
 *
 * Loaded by quiz.html and intake.html. Sets up Firestore and exposes a small
 * helper API on window.hofFirebase that classic <script> tags can call:
 *
 *   window.hofFirebase.ready()                       — Promise<void>
 *   window.hofFirebase.writeQuizDoc(sessionId, data) — setDoc + merge
 *   window.hofFirebase.addIntake(data)               — addDoc, returns docRef.id
 *
 * The Firebase web config below is PUBLIC by design and safe to commit.
 * The real security boundary is enforced by Firestore rules.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getFirestore,
  doc,
  setDoc,
  addDoc,
  collection
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAvh76aewVVl9PCrlBC74uRotkMutrK1cA',
  authDomain: 'houseoffigs-16f71.firebaseapp.com',
  projectId: 'houseoffigs-16f71',
  storageBucket: 'houseoffigs-16f71.firebasestorage.app',
  messagingSenderId: '1084309728433',
  appId: '1:1084309728433:web:fc12dbcea494e895d94690',
  measurementId: 'G-7J1YG1N0GB'
};

let app, db;
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (err) {
  console.error('Firebase init failed:', err);
}

window.hofFirebase = {
  ready() {
    return Promise.resolve(!!db);
  },

  async writeQuizDoc(sessionId, data) {
    if (!db) throw new Error('Firestore not initialized');
    if (!sessionId) throw new Error('sessionId required');
    await setDoc(doc(db, 'quizzes', sessionId), data, { merge: true });
  },

  async addIntake(data) {
    if (!db) throw new Error('Firestore not initialized');
    const ref = await addDoc(collection(db, 'intakes'), data);
    return ref.id;
  }
};

// Notify any waiting classic-script code.
window.dispatchEvent(new CustomEvent('hofFirebaseReady'));
