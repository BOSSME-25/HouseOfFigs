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

function findLinkedSubmissions(type, data) {
  // Cross-reference by email — if a quiz has an email, look up intakes with
  // the same email, and vice versa. Returns array of { kind, doc }.
  const email = (data.email || data.Email || '').toLowerCase().trim();
  if (!email) return [];
  const otherDocs = type === 'quiz' ? intakeDocs : quizDocs;
  const otherKind = type === 'quiz' ? 'intake' : 'quiz';
  return otherDocs
    .filter(d => (d.email || d.Email || '').toLowerCase().trim() === email)
    .map(doc => ({ kind: otherKind, doc }));
}

function renderDetail(type, data) {
  const title = type === 'quiz' ? 'Quiz response' : 'Intake submission';

  const skipKeys = new Set(['id', '_kind', 'userAgent', 'referer']);
  const keys = Object.keys(data).filter(k => !skipKeys.has(k));

  // Look for linked submissions in the other collection
  const linked = findLinkedSubmissions(type, data);

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
  html += `<div class="detail-meta">Submitted ${formatTime(data.createdAt)} &middot; `
       + `<a href="#" id="print-submission">Download / print</a> &middot; `
       + `<a href="#" id="copy-json">Copy as JSON</a></div>`;

  if (linked.length > 0) {
    html += '<div class="linked-banner">';
    html += '<div class="linked-banner-label">';
    html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    html += linked.length + ' linked ' + (linked[0].kind === 'quiz' ? 'quiz response' : 'intake submission') + (linked.length > 1 ? 's' : '');
    html += '</div>';
    html += '<div class="linked-list">';
    html += linked.map(item => {
      const d = item.doc;
      const label = item.kind === 'quiz'
        ? (d.profile?.title || 'Anonymous quiz')
        : (d['Full name'] || d['full-name'] || 'Intake submission');
      return '<button type="button" class="linked-item" data-id="' + escape(d.id) + '" data-type="' + item.kind + '">' +
        '<span class="linked-item-label">' + escape(label) + '</span>' +
        '<span class="linked-item-time">' + formatTime(d.createdAt) + ' &rarr;</span>' +
      '</button>';
    }).join('');
    html += '</div></div>';
  }

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
    document.querySelectorAll('.linked-item').forEach(btn => {
      btn.addEventListener('click', () => {
        openDetail(btn.dataset.type, btn.dataset.id);
      });
    });
    const printLink = document.getElementById('print-submission');
    if (printLink) {
      printLink.addEventListener('click', (e) => {
        e.preventDefault();
        openPrintView(type, data);
      });
    }
  }, 0);

  return html;
}

// Opens a clean, brand-styled printable view of a single submission in a
// new tab, with the print dialog auto-triggered. Bethany can save as PDF
// or print directly. Works on iPad / phone (AirPrint) too.
function openPrintView(type, data) {
  const title = type === 'quiz' ? 'Quiz response' : 'Intake submission';
  const fileSlug = type === 'quiz'
    ? (data.name || data.email || 'anonymous').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    : (data['Full name'] || data['full-name'] || data.email || 'anonymous').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dateStr = new Date(data.createdAt || Date.now()).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
  const docTitle = `House of Figs · ${title} · ${fileSlug} · ${dateStr}`;

  const sections = renderPrintSections(type, data);

  const printHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escape(docTitle)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after { box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    color: #2C2C2C;
    background: #fff;
    margin: 0;
    padding: 2.5rem 2rem;
    max-width: 820px;
    margin: 0 auto;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .ph {
    border-bottom: 2px solid #D4C5B2;
    padding-bottom: 1.25rem;
    margin-bottom: 2rem;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 2rem;
  }
  .ph-brand {
    font-family: 'Cormorant Garamond', serif;
    color: #4A3728;
  }
  .ph-brand h1 {
    font-size: 1.625rem;
    margin: 0 0 0.15rem;
    font-weight: 500;
  }
  .ph-brand .tagline {
    font-style: italic;
    color: #8B5E5A;
    font-size: 0.875rem;
  }
  .ph-meta {
    text-align: right;
    font-size: 0.8125rem;
    color: #897866;
    line-height: 1.5;
  }
  .ph-meta .label {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.6875rem;
    color: #8B5E5A;
    font-weight: 500;
  }
  .doctitle {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.875rem;
    color: #4A3728;
    margin: 0 0 0.25rem;
    font-weight: 500;
  }
  .subline {
    color: #897866;
    font-size: 0.9375rem;
    margin: 0 0 2rem;
  }
  section { margin-bottom: 2rem; break-inside: avoid; }
  section h2 {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.25rem;
    color: #4A3728;
    margin: 0 0 0.75rem;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid #ece2cf;
    font-weight: 500;
  }
  .field-row {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 0.75rem 1.5rem;
    padding: 0.4rem 0;
    border-bottom: 1px dashed #f0e6d4;
    font-size: 0.875rem;
  }
  .field-row:last-child { border-bottom: none; }
  .field-row dt {
    font-weight: 500;
    color: #6B7F5E;
  }
  .field-row dd {
    margin: 0;
    color: #2C2C2C;
    word-wrap: break-word;
    white-space: pre-wrap;
  }
  .field-row dd.empty { color: #bbb; font-style: italic; }
  .profile-card {
    background: linear-gradient(135deg, #faf6ef 0%, #f5ede0 100%);
    border: 1px solid #ece2cf;
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
  }
  .profile-card-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.5rem;
    color: #4A3728;
    font-weight: 500;
    line-height: 1.2;
  }
  .profile-card-subtitle {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    color: #8B5E5A;
    margin-top: 0.25rem;
  }
  .profile-card-chips {
    margin-top: 0.85rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }
  .chip {
    display: inline-block;
    font-size: 0.75rem;
    padding: 0.2rem 0.7rem;
    border-radius: 20px;
    background: #D4C5B2;
    color: #4A3728;
    text-transform: capitalize;
  }
  .chip-red    { background: #f4d6d3; color: #8b2a1f; }
  .chip-orange { background: #f6dec5; color: #8e4a13; }
  .chip-yellow { background: #f3e6b3; color: #8a6a0a; }
  .chip-green  { background: #d3e3cc; color: #2d5a32; }
  .chip-greenwhite { background: #e2ead9; color: #4b6647; }
  .chip-white  { background: #ece9e2; color: #5c5046; }
  .chip-blue   { background: #d3dceb; color: #2e4773; }
  .chip-purple { background: #ddd0e6; color: #4d2d6d; }
  .chip-brown  { background: #e0d2c1; color: #5a3b1f; }
  .qa-list { list-style: none; padding: 0; margin: 0; counter-reset: q; }
  .qa-list li {
    counter-increment: q;
    padding: 0.65rem 1rem 0.65rem 2.5rem;
    background: #faf6ef;
    border-radius: 6px;
    margin-bottom: 0.5rem;
    position: relative;
  }
  .qa-list li::before {
    content: counter(q);
    position: absolute;
    left: 0.85rem;
    top: 0.65rem;
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.125rem;
    color: #8B5E5A;
  }
  .qa-q { font-size: 0.8125rem; color: #4A3728; font-weight: 500; margin-bottom: 0.15rem; }
  .qa-a { font-size: 0.8125rem; font-style: italic; color: #2C2C2C; }
  .footer {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid #ece2cf;
    font-size: 0.6875rem;
    color: #b09f8d;
    text-align: center;
    letter-spacing: 0.04em;
  }
  @media print {
    body { padding: 0.75in 0.6in; max-width: none; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <div class="ph">
    <div class="ph-brand">
      <h1>House of Figs</h1>
      <div class="tagline">Rooted wellness. Sustainable transformation.</div>
    </div>
    <div class="ph-meta">
      <div class="label">${escape(title)}</div>
      <div>${escape(dateStr)}</div>
    </div>
  </div>

  ${sections}

  <div class="footer">
    Confidential client record · Generated ${new Date().toLocaleString('en-US')}<br>
    houseoffigs.org · bethany@houseoffigs.org
  </div>

  <script>
    // Trigger print dialog after fonts load
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 500);
    });
  </script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    alert('Please allow pop-ups to download. The print view opens in a new tab.');
    return;
  }
  win.document.open();
  win.document.write(printHtml);
  win.document.close();
}

function renderPrintSections(type, data) {
  if (type === 'quiz') {
    return renderQuizPrintSections(data);
  }
  return renderIntakePrintSections(data);
}

function renderQuizPrintSections(data) {
  let html = '';
  const fullName = data.name || '';
  const emailVal = data.email || '';

  // Header info
  html += '<h1 class="doctitle">' + escape(fullName || emailVal || 'Anonymous quiz response') + '</h1>';
  html += '<p class="subline">';
  if (emailVal) html += escape(emailVal) + ' &middot; ';
  html += 'Session ' + escape(data.sessionId || '').slice(0, 8) + '…';
  html += '</p>';

  // Profile
  if (data.profile) {
    const p = data.profile;
    const chips = (p.keys || []).map(k =>
      '<span class="chip chip-' + escape(k) + '">' + escape(k) + '</span>'
    ).join('');
    html += '<section>';
    html += '<h2>Profile result</h2>';
    html += '<div class="profile-card">';
    html += '<div class="profile-card-title">' + escape(p.title || '') + '</div>';
    html += '<div class="profile-card-subtitle">' + escape(p.subtitle || '') + '</div>';
    if (chips) html += '<div class="profile-card-chips">' + chips + '</div>';
    html += '</div></section>';
  }

  // Answers
  if (Array.isArray(data.answers) && data.answers.length > 0) {
    html += '<section><h2>Quiz answers</h2><ol class="qa-list">';
    data.answers.forEach(a => {
      html += '<li>';
      html += '<div class="qa-q">' + escape(a.question || '') + '</div>';
      html += '<div class="qa-a">' + escape(a.answer || '') + '</div>';
      html += '</li>';
    });
    html += '</ol></section>';
  }

  // Metadata
  html += '<section><h2>Submission details</h2><dl>';
  html += printField('Submitted', new Date(data.createdAt || Date.now()).toLocaleString('en-US'));
  if (data.emailCapturedAt) {
    html += printField('Email captured', new Date(data.emailCapturedAt).toLocaleString('en-US'));
  }
  html += printField('Session ID', data.sessionId || '—');
  html += '</dl></section>';

  return html;
}

function renderIntakePrintSections(data) {
  const fullName = data['Full name'] || data['full-name'] || '';
  const emailVal = data.email || data.Email || '';
  const phone = data.Phone || data.phone || '';

  let html = '';
  html += '<h1 class="doctitle">' + escape(fullName || emailVal || 'Intake submission') + '</h1>';
  html += '<p class="subline">';
  const subParts = [];
  if (emailVal) subParts.push(escape(emailVal));
  if (phone) subParts.push(escape(phone));
  html += subParts.join(' &middot; ');
  html += '</p>';

  // Section groupings — based on the intake form's 6 fieldsets
  const sectionMap = [
    {
      title: 'About you',
      fields: [
        'Full name', 'full-name', 'Preferred name', 'preferred-name',
        'Preferred name & pronouns',
        'email', 'Email', 'phone', 'Phone',
        'Date of birth', 'date-of-birth',
        'Location', 'location', 'Occupation', 'occupation',
        'How did you hear about House of Figs', 'referral', 'Referral',
        'Preferred connection'
      ]
    },
    {
      title: 'Your story',
      fields: [
        'Main reason for reaching out', 'reason',
        'Top health goals', 'goals',
        'Past approaches that have worked',
        'Past approaches that haven’t worked',
        'How long have you been dealing with this',
        'Energy and motivation right now',
        'Weekly time available (1-10)',
        'Best time of day to focus on wellness'
      ]
    },
    {
      title: 'Health snapshot',
      fields: [
        'Diagnosed conditions', 'conditions',
        'Medications and supplements', 'meds',
        'Allergies and sensitivities',
        'Surgeries or major medical history',
        'Family health patterns', 'family'
      ]
    },
    {
      title: 'Rainbow quick-scan',
      fields: [
        'Red symptoms', 'Orange symptoms', 'Yellow symptoms',
        'Green symptoms', 'Green-white symptoms', 'White symptoms',
        'Blue symptoms', 'Purple symptoms', 'Brown symptoms',
        'Rainbow patterns that stand out', 'rainbow-stands-out'
      ]
    },
    {
      title: 'Lifestyle',
      fields: [
        'Average sleep', 'Sleep quality', 'Wake time', 'Bedtime',
        'Digestion regularity', 'Digestion notes',
        'Stress level (1-10)', 'Primary stressors',
        'Stress habits', 'Nervous system practices',
        'Movement frequency', 'Movement type',
        'Daily water', 'Daily caffeine', 'Alcohol',
        'Typical day of eating', 'typical-day',
        'Eating-out frequency'
      ]
    },
    {
      title: 'Vision & readiness',
      fields: [
        'What you hope to walk away with', 'walk-away',
        'Fears or blocks', 'fears',
        'Anything else important', 'anything-else'
      ]
    }
  ];

  const usedKeys = new Set();
  sectionMap.forEach(sect => {
    const rows = [];
    sect.fields.forEach(key => {
      if (key in data && data[key] !== null && data[key] !== '') {
        rows.push(printField(prettyLabel(key), data[key]));
        usedKeys.add(key);
      }
    });
    if (rows.length > 0) {
      html += '<section><h2>' + escape(sect.title) + '</h2><dl>' + rows.join('') + '</dl></section>';
    }
  });

  // Anything not categorized
  const skipKeys = new Set(['createdAt', 'userAgent', 'referer']);
  const otherKeys = Object.keys(data).filter(k =>
    !usedKeys.has(k) && !skipKeys.has(k)
  );
  if (otherKeys.length > 0) {
    let rows = '';
    otherKeys.forEach(key => {
      if (data[key] !== null && data[key] !== '') {
        rows += printField(prettyLabel(key), data[key]);
      }
    });
    if (rows) html += '<section><h2>Other</h2><dl>' + rows + '</dl></section>';
  }

  // Footer metadata
  html += '<section><h2>Submission details</h2><dl>';
  html += printField('Submitted', new Date(data.createdAt || Date.now()).toLocaleString('en-US'));
  html += '</dl></section>';

  return html;
}

function prettyLabel(key) {
  // Convert "field-name" or "Field name" to readable Title Case
  const k = key.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  return k.charAt(0).toUpperCase() + k.slice(1);
}

function printField(label, value) {
  if (Array.isArray(value)) {
    value = value.join(', ');
  }
  if (value === null || value === undefined || value === '') {
    return '<div class="field-row"><dt>' + escape(label) + '</dt>'
      + '<dd class="empty">—</dd></div>';
  }
  return '<div class="field-row"><dt>' + escape(label) + '</dt>'
    + '<dd>' + escape(String(value)) + '</dd></div>';
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
    // Quiz profile: { key, title, subtitle, keys[] }
    if (v.title && v.subtitle && Array.isArray(v.keys)) {
      const chips = v.keys.map(k =>
        '<span class="profile-chip profile-chip-' + escape(k) + '">' + escape(k) + '</span>'
      ).join('');
      return (
        '<div class="profile-card">' +
          '<div class="profile-card-title">' + escape(v.title) + '</div>' +
          '<div class="profile-card-subtitle">' + escape(v.subtitle) + '</div>' +
          (v.key ? '<div class="profile-card-key">Profile key: <code>' + escape(v.key) + '</code></div>' : '') +
          (chips ? '<div class="profile-card-chips"><span class="profile-card-chips-label">Color focus</span>' + chips + '</div>' : '') +
        '</div>'
      );
    }
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
