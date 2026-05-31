/**
 * House of Figs Admin Dashboard
 *
 * Sign-in via Firebase Auth (Google provider, restricted to a hardcoded
 * allow-list of Workspace emails). Live data from Firestore via onSnapshot.
 *
 * The Firebase web config below is PUBLIC by design — Firebase web apps
 * always expose these values. Access is enforced by:
 *   1. The ALLOWED_EMAILS check below (defense in depth)
 *   2. Firestore security rules (the real gate — see firestore.rules)
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// ===================================================================
// CONFIG — paste from Firebase Console → Project Settings → Web app
// ===================================================================
const firebaseConfig = {
  apiKey: 'AIzaSyAvh76aewVVl9PCrlBC74uRotkMutrK1cA',
  authDomain: 'houseoffigs-16f71.firebaseapp.com',
  projectId: 'houseoffigs-16f71',
  storageBucket: 'houseoffigs-16f71.firebasestorage.app',
  messagingSenderId: '1084309728433',
  appId: '1:1084309728433:web:fc12dbcea494e895d94690',
  measurementId: 'G-7J1YG1N0GB'
};

const ALLOWED_EMAILS = [
  'bethany@houseoffigs.org',
  'emily@houseoffigs.org'
];

// ===================================================================
// Init
// ===================================================================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(console.error);

// ===================================================================
// State
// ===================================================================
let quizDocs = [];
let intakeDocs = [];
let lastSeenIds = new Set(); // for "new" highlighting on first load
let firstSnapshot = { quizzes: true, intakes: true };

// ===================================================================
// Element refs
// ===================================================================
const loginEl = document.getElementById('login');
const dashboardEl = document.getElementById('dashboard');
const userEmailEl = document.getElementById('user-email');
const loginErrorEl = document.getElementById('login-error');

// ===================================================================
// Auth
// ===================================================================
document.getElementById('signin-btn').addEventListener('click', async () => {
  loginErrorEl.textContent = '';
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    const code = err && err.code;
    if (code === 'auth/popup-closed-by-user') return;
    loginErrorEl.textContent =
      'Sign-in failed: ' + (err && err.message ? err.message : 'Unknown error');
  }
});

document.getElementById('signout-btn').addEventListener('click', async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showLogin();
    return;
  }

  const email = (user.email || '').toLowerCase();
  if (!ALLOWED_EMAILS.includes(email)) {
    loginErrorEl.textContent =
      `${user.email} is not authorized to view this dashboard.`;
    await signOut(auth);
    showLogin();
    return;
  }

  userEmailEl.textContent = user.email;
  showDashboard();
  initSubscriptions();
});

function showLogin() {
  loginEl.classList.remove('hidden');
  dashboardEl.classList.add('hidden');
}

function showDashboard() {
  loginEl.classList.add('hidden');
  dashboardEl.classList.remove('hidden');
}

// ===================================================================
// Tabs
// ===================================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
  });
});

// ===================================================================
// Firestore live subscriptions
// ===================================================================
function initSubscriptions() {
  const quizQ = query(
    collection(db, 'quizzes'),
    orderBy('createdAt', 'desc'),
    limit(200)
  );
  onSnapshot(quizQ, (snap) => {
    quizDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    handleNewItems('quizzes', quizDocs);
    renderQuizList();
    renderActivity();
    renderStats();
  }, (err) => {
    console.error('quizzes onSnapshot error:', err);
    showFatalError(err);
  });

  const intakeQ = query(
    collection(db, 'intakes'),
    orderBy('createdAt', 'desc'),
    limit(200)
  );
  onSnapshot(intakeQ, (snap) => {
    intakeDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    handleNewItems('intakes', intakeDocs);
    renderIntakeList();
    renderActivity();
    renderStats();
  }, (err) => {
    console.error('intakes onSnapshot error:', err);
    showFatalError(err);
  });
}

function handleNewItems(kind, docs) {
  if (firstSnapshot[kind]) {
    docs.forEach(d => lastSeenIds.add(kind + ':' + d.id));
    firstSnapshot[kind] = false;
    return;
  }
  const newIds = docs.filter(d => !lastSeenIds.has(kind + ':' + d.id));
  if (newIds.length > 0) {
    pulseTab(kind);
    notifyNew(kind, newIds.length);
  }
  docs.forEach(d => lastSeenIds.add(kind + ':' + d.id));
}

function pulseTab(kind) {
  const btn = document.querySelector(`.tab-btn[data-tab="${kind}"]`);
  if (!btn) return;
  btn.animate(
    [
      { backgroundColor: 'rgba(139, 94, 90, 0.18)' },
      { backgroundColor: 'transparent' }
    ],
    { duration: 1400, easing: 'ease-out' }
  );
}

function notifyNew(kind, count) {
  const label = kind === 'quizzes' ? 'quiz response' : 'intake submission';
  const plural = count === 1 ? '' : 's';
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('House of Figs', {
        body: `${count} new ${label}${plural}`,
        icon: '/images/apple-touch-icon.png'
      });
    } catch (e) { /* ignore */ }
  }
  // Always visible: tab title flash
  flashTitle(`(${count}) New ${label}${plural} · House of Figs`);
}

let originalTitle = document.title;
let flashInterval = null;
function flashTitle(newTitle) {
  if (flashInterval) clearInterval(flashInterval);
  let on = false;
  flashInterval = setInterval(() => {
    document.title = on ? originalTitle : newTitle;
    on = !on;
  }, 1500);
  setTimeout(() => {
    if (flashInterval) clearInterval(flashInterval);
    flashInterval = null;
    document.title = originalTitle;
  }, 12000);
}

// Request browser notification permission once user is in
function maybeAskForNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}
setTimeout(maybeAskForNotifications, 2000);

function showFatalError(err) {
  loginErrorEl.textContent =
    'Could not load dashboard data: ' + (err.message || err);
  showLogin();
}

// ===================================================================
// Rendering — Quiz list
// ===================================================================
function renderQuizList() {
  const listEl = document.getElementById('quiz-list');
  if (quizDocs.length === 0) {
    listEl.innerHTML = '<p class="empty">No quiz responses yet.</p>';
    return;
  }
  listEl.innerHTML = quizDocs.map(d => {
    const profile = d.profile?.title || 'Anonymous';
    const subtitle = d.profile?.subtitle || '';
    const who = d.email
      ? `${escape(d.email)}${d.name ? ' &middot; ' + escape(d.name) : ''}`
      : `<em>No email captured</em>`;
    return `
      <div class="data-row" data-id="${escape(d.id)}" data-type="quiz">
        <div class="row-main">
          <div class="row-title">${escape(profile)}</div>
          <div class="row-sub">${who}${subtitle ? ' &middot; <em>' + escape(subtitle) + '</em>' : ''}</div>
        </div>
        <div class="row-time">${formatTime(d.createdAt)}</div>
      </div>
    `;
  }).join('');
  attachRowClicks(listEl);
}

// ===================================================================
// Rendering — Intake list
// ===================================================================
function renderIntakeList() {
  const listEl = document.getElementById('intake-list');
  if (intakeDocs.length === 0) {
    listEl.innerHTML = '<p class="empty">No intake submissions yet.</p>';
    return;
  }
  listEl.innerHTML = intakeDocs.map(d => {
    const name = d['Full name'] || d['full-name'] || (d.email || d.Email) || 'Unnamed';
    const emailVal = d.email || d.Email || '';
    const reason = (d['Main reason for reaching out'] || '').slice(0, 90);
    const sub = reason
      ? escape(reason) + (reason.length === 90 ? '…' : '') + (emailVal ? ' &middot; ' + escape(emailVal) : '')
      : escape(emailVal);
    return `
      <div class="data-row" data-id="${escape(d.id)}" data-type="intake">
        <div class="row-main">
          <div class="row-title">${escape(name)}</div>
          <div class="row-sub">${sub}</div>
        </div>
        <div class="row-time">${formatTime(d.createdAt)}</div>
      </div>
    `;
  }).join('');
  attachRowClicks(listEl);
}

// ===================================================================
// Rendering — Activity feed (combined)
// ===================================================================
function renderActivity() {
  const feedEl = document.getElementById('activity-feed');
  const combined = [
    ...quizDocs.map(d => ({ ...d, _kind: 'quiz' })),
    ...intakeDocs.map(d => ({ ...d, _kind: 'intake' }))
  ].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
   .slice(0, 30);

  if (combined.length === 0) {
    feedEl.innerHTML = '<p class="empty">Waiting for the first activity to come in&hellip;</p>';
    return;
  }
  feedEl.innerHTML = combined.map(d => {
    const isQuiz = d._kind === 'quiz';
    const tag = isQuiz
      ? '<span class="row-tag tag-quiz">Quiz</span>'
      : '<span class="row-tag tag-intake">Intake</span>';
    const title = isQuiz
      ? (d.profile?.title || 'Anonymous quiz')
      : (d['Full name'] || d['full-name'] || (d.email || d.Email) || 'Unnamed intake');
    const who = isQuiz
      ? (d.email || 'No email captured')
      : ((d.email || d.Email) || '');
    return `
      <div class="activity-row" data-id="${escape(d.id)}" data-type="${d._kind}">
        <div class="row-main">
          <div class="row-title">${tag}${escape(title)}</div>
          <div class="row-sub">${escape(who)}</div>
        </div>
        <div class="row-time">${formatTime(d.createdAt)}</div>
      </div>
    `;
  }).join('');
  attachRowClicks(feedEl);
}

// ===================================================================
// Stats
// ===================================================================
function renderStats() {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const quizWeek = quizDocs.filter(d => {
    const t = Date.parse(d.createdAt || '');
    return !isNaN(t) && t > weekAgo;
  }).length;
  const quizEmails = quizDocs.filter(d => d.email).length;

  setText('stat-quiz-total', quizDocs.length);
  setText('stat-quiz-emails', quizEmails);
  setText('stat-quiz-week', quizWeek);
  setText('stat-intake-total', intakeDocs.length);

  setText('badge-quizzes', quizDocs.length);
  setText('badge-intakes', intakeDocs.length);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ===================================================================
// Detail modal
// ===================================================================
const modalEl = document.getElementById('detail-modal');
const modalBodyEl = document.getElementById('modal-body');

function attachRowClicks(container) {
  container.querySelectorAll('.data-row, .activity-row').forEach(row => {
    row.addEventListener('click', () => {
      const type = row.dataset.type;
      const id = row.dataset.id;
      openDetail(type, id);
    });
  });
}

async function openDetail(type, id) {
  const collectionName = type === 'quiz' ? 'quizzes' : 'intakes';
  const cached = (type === 'quiz' ? quizDocs : intakeDocs).find(d => d.id === id);
  let data = cached;
  if (!data) {
    const snap = await getDoc(doc(db, collectionName, id));
    if (!snap.exists()) return;
    data = snap.data();
  }
  modalBodyEl.innerHTML = renderDetail(type, data);
  modalEl.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  modalEl.classList.add('hidden');
  document.body.style.overflow = '';
}

document.getElementById('modal-close').addEventListener('click', closeDetail);
document.querySelectorAll('[data-close]').forEach(el =>
  el.addEventListener('click', closeDetail)
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalEl.classList.contains('hidden')) closeDetail();
});

function renderDetail(type, data) {
  const title = type === 'quiz' ? 'Quiz response' : 'Intake submission';

  const skipKeys = new Set(['id', '_kind', 'userAgent', 'referer']);
  const keys = Object.keys(data).filter(k => !skipKeys.has(k));

  // Put a few important keys first if present
  const priority = type === 'quiz'
    ? ['profile', 'email', 'name', 'createdAt', 'emailCapturedAt', 'answers']
    : ['full-name', 'name', 'Full name', 'email', 'Email',
       'Preferred connection', 'Main reason for reaching out',
       'Top health goals', 'createdAt'];
  const orderedKeys = [
    ...priority.filter(k => keys.includes(k)),
    ...keys.filter(k => !priority.includes(k))
  ];

  let html = `<h2>${escape(title)}</h2>`;
  html += `<div class="detail-meta">Submitted ${formatTime(data.createdAt)} &middot; <a href="#" id="copy-json">Copy as JSON</a></div>`;
  html += '<dl class="detail-fields">';
  for (const key of orderedKeys) {
    html += `<dt>${escape(key)}</dt>`;
    html += `<dd>${formatValue(data[key])}</dd>`;
  }
  html += '</dl>';

  setTimeout(() => {
    const copyLink = document.getElementById('copy-json');
    if (copyLink) {
      copyLink.addEventListener('click', (e) => {
        e.preventDefault();
        navigator.clipboard.writeText(JSON.stringify(data, null, 2))
          .then(() => { copyLink.textContent = 'Copied!'; });
      });
    }
  }, 0);

  return html;
}

function formatValue(v) {
  if (v === null || v === undefined || v === '') {
    return '<span class="empty-val">—</span>';
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '<span class="empty-val">—</span>';
    // Quiz answers: array of { question, answer, scores }
    if (v.every(x => x && typeof x === 'object' && 'question' in x && 'answer' in x)) {
      return '<ol class="qa-list">' + v.map(x =>
        '<li><div class="qa-q">' + escape(x.question || '') + '</div>' +
        '<div class="qa-a">' + escape(x.answer || '') + '</div></li>'
      ).join('') + '</ol>';
    }
    // Other arrays of objects: fall back to pretty JSON
    if (v.some(x => x && typeof x === 'object')) {
      return '<pre>' + escape(JSON.stringify(v, null, 2)) + '</pre>';
    }
    return v.map(x => escape(String(x))).join(', ');
  }
  if (typeof v === 'object') {
    return '<pre>' + escape(JSON.stringify(v, null, 2)) + '</pre>';
  }
  // ISO timestamp?
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return escape(new Date(v).toLocaleString());
  }
  // multi-line text — preserve linebreaks
  if (typeof v === 'string' && v.includes('\n')) {
    return escape(v).replace(/\n/g, '<br>');
  }
  return escape(String(v));
}

// ===================================================================
// CSV export
// ===================================================================
document.getElementById('export-quizzes').addEventListener('click', () => {
  const rows = quizDocs.map(d => ({
    submittedAt: d.createdAt || '',
    profile: d.profile?.title || '',
    profileSubtitle: d.profile?.subtitle || '',
    email: d.email || '',
    name: d.name || '',
    emailCapturedAt: d.emailCapturedAt || '',
    sessionId: d.id || ''
  }));
  downloadCsv('quiz-responses', rows);
});

document.getElementById('export-intakes').addEventListener('click', () => {
  // Collect all unique keys across intakes for a stable header
  const allKeys = new Set(['createdAt']);
  intakeDocs.forEach(d => {
    Object.keys(d).forEach(k => {
      if (!['id', 'userAgent', 'referer'].includes(k)) allKeys.add(k);
    });
  });
  const headers = [...allKeys];
  const rows = intakeDocs.map(d => {
    const row = {};
    headers.forEach(h => {
      const v = d[h];
      row[h] = Array.isArray(v) ? v.join('; ') : (v ?? '');
    });
    return row;
  });
  downloadCsv('intake-submissions', rows);
});

function downloadCsv(name, rows) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => csvCell(r[h])).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `houseoffigs-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ===================================================================
// Utilities
// ===================================================================
function escape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  if (days < 7) return days + 'd ago';
  return new Date(t).toLocaleDateString();
}
