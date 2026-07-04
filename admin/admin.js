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
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import {
  getFunctions,
  httpsCallable
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';

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
const storage = getStorage(app);

// Upload an image to Storage (blog/…) and return its public URL.
async function uploadImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('That file isn’t an image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Image is over 10 MB — please resize it first.');
  const clean = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const path = 'blog/' + Date.now() + '-' + (clean || 'image');
  const snap = await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
  return getDownloadURL(snap.ref);
}

setPersistence(auth, browserLocalPersistence).catch(console.error);

// ===================================================================
// State
// ===================================================================
let quizDocs = [];
let intakeDocs = [];
let postDocs = [];
let testimonialDocs = [];
let assessmentDocs = [];
let planDocs = {};            // intakeId -> plan doc
let rmiDocs = [];             // Request More Information leads (Entry B)
let groveDocs = [];           // Ask the Grove questions (From the Orchard)
let bookingDocs = [];         // Calendly bookings (the 24-hour gate)
let calendlyConnected = false;
let leadMeta = {};          // submissionId ("quiz_x"/"intake_x") -> { status, notes, tags }
let lastSeenIds = new Set(); // for "new" highlighting on first load
let firstSnapshot = { quizzes: true, intakes: true };
let unsubscribes = [];      // active onSnapshot listeners, torn down on sign-out

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
    stopSubscriptions();
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

  loginErrorEl.textContent = '';
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
function stopSubscriptions() {
  unsubscribes.forEach(unsub => unsub());
  unsubscribes = [];
}

function initSubscriptions() {
  stopSubscriptions();
  const listen = (...args) => unsubscribes.push(onSnapshot(...args));

  const quizQ = query(
    collection(db, 'quizzes'),
    orderBy('createdAt', 'desc'),
    limit(200)
  );
  listen(quizQ, (snap) => {
    quizDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    handleNewItems('quizzes', quizDocs);
    renderQuizList();
    renderActivity();
    renderStats();
    renderFunnel();
  }, (err) => {
    console.error('quizzes onSnapshot error:', err);
    showFatalError(err);
  });

  const intakeQ = query(
    collection(db, 'intakes'),
    orderBy('createdAt', 'desc'),
    limit(200)
  );
  listen(intakeQ, (snap) => {
    intakeDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    handleNewItems('intakes', intakeDocs);
    renderIntakeList();
    renderActivity();
    renderStats();
    renderFunnel();
    renderAssessmentList(); // backfill count depends on intakes
  }, (err) => {
    console.error('intakes onSnapshot error:', err);
    showFatalError(err);
  });

  // Blog posts
  listen(query(collection(db, 'posts'), orderBy('updatedAt', 'desc')), (snap) => {
    postDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPostList();
    setText('badge-posts', postDocs.length);
  }, (err) => console.error('posts onSnapshot error:', err));

  // Testimonials
  listen(query(collection(db, 'testimonials'), orderBy('order', 'asc')), (snap) => {
    testimonialDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTestimonialList();
    setText('badge-testimonials', testimonialDocs.length);
  }, (err) => console.error('testimonials onSnapshot error:', err));

  // Lead workflow metadata (status / notes / tags), keyed by submission id
  listen(collection(db, 'leadMeta'), (snap) => {
    leadMeta = {};
    snap.docs.forEach(d => { leadMeta[d.id] = d.data(); });
    renderQuizList();
    renderIntakeList();
  }, (err) => console.error('leadMeta onSnapshot error:', err));

  // Rooted Assessments + plans
  listen(query(collection(db, 'assessments'), orderBy('createdAt', 'desc')), (snap) => {
    assessmentDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAssessmentList();
    setText('badge-assessments', assessmentDocs.length);
    renderFunnel();
  }, (err) => console.error('assessments onSnapshot error:', err));

  listen(collection(db, 'plans'), (snap) => {
    planDocs = {};
    snap.docs.forEach(d => { planDocs[d.id] = { id: d.id, ...d.data() }; });
    renderAssessmentList();
    renderFunnel();
  }, (err) => console.error('plans onSnapshot error:', err));

  // RMI leads (Entry B) — feed the funnel's first stage
  listen(collection(db, 'rmi'), (snap) => {
    rmiDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFunnel();
  }, (err) => console.error('rmi onSnapshot error:', err));

  // Ask the Grove questions (From the Orchard blog)
  listen(collection(db, 'grove'), (snap) => {
    groveDocs = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    renderGroveList();
    setText('badge-grove', groveDocs.filter(g => !g.answeredAt).length);
  }, (err) => console.error('grove onSnapshot error:', err));

  // Calendly bookings (the 24-hour gate) + connection state
  listen(collection(db, 'bookings'), (snap) => {
    bookingDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFunnel();
  }, (err) => console.error('bookings onSnapshot error:', err));

  listen(doc(db, 'config', 'calendly'), (snap) => {
    calendlyConnected = snap.exists() && !!snap.data().subscriptionUri;
    updateCalendlyButton();
  }, (err) => console.error('config onSnapshot error:', err));
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
          <div class="row-title">${escape(profile)}${leadChip('quiz', d.id)}</div>
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
          <div class="row-title">${escape(name)}${leadChip('intake', d.id)}</div>
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
  modalBodyEl.innerHTML = renderDetail(type, data, id);
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

// Shared section map for intakes — used by both the in-browser detail view
// and the print/PDF export so they're identical.
const INTAKE_SECTION_MAP = [
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
      'Weekly time available',
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

const INTAKE_SECTION_SKIP_KEYS = new Set([
  'id', '_kind', 'createdAt', 'updatedAt', 'userAgent', 'referer',
  'email', 'Email', 'Full name', 'full-name'  // shown in header instead
]);

function renderIntakeDetailGrouped(data) {
  // Returns HTML for the intake's grouped detail view — uses the same
  // section structure as the PDF export.
  let html = '';
  const usedKeys = new Set();

  INTAKE_SECTION_MAP.forEach(sect => {
    const rows = [];
    sect.fields.forEach(key => {
      if (key in data && data[key] !== null && data[key] !== '') {
        rows.push(
          '<div class="intake-row">' +
            '<div class="intake-row-label">' + escape(prettyLabel(key)) + '</div>' +
            '<div class="intake-row-value">' + formatValue(data[key]) + '</div>' +
          '</div>'
        );
        usedKeys.add(key);
      }
    });
    if (rows.length > 0) {
      html += '<div class="intake-section-block">';
      html += '<h3 class="intake-section-title">' + escape(sect.title) + '</h3>';
      html += '<div class="intake-rows">' + rows.join('') + '</div>';
      html += '</div>';
    }
  });

  // Anything not categorized
  const otherKeys = Object.keys(data).filter(k =>
    !usedKeys.has(k) && !INTAKE_SECTION_SKIP_KEYS.has(k)
  );
  if (otherKeys.length > 0) {
    let rows = '';
    otherKeys.forEach(key => {
      const v = data[key];
      if (v !== null && v !== '') {
        rows +=
          '<div class="intake-row">' +
            '<div class="intake-row-label">' + escape(prettyLabel(key)) + '</div>' +
            '<div class="intake-row-value">' + formatValue(v) + '</div>' +
          '</div>';
      }
    });
    if (rows) {
      html += '<div class="intake-section-block">';
      html += '<h3 class="intake-section-title">Other</h3>';
      html += '<div class="intake-rows">' + rows + '</div>';
      html += '</div>';
    }
  }
  return html;
}

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

function renderDetail(type, data, id) {
  const title = type === 'quiz' ? 'Quiz response' : 'Intake submission';
  const subId = id || data.id;

  // Look for linked submissions in the other collection
  const linked = findLinkedSubmissions(type, data);

  let html = `<h2>${escape(title)}</h2>`;
  html += `<div class="detail-meta">Submitted ${formatTime(data.createdAt)} &middot; `
       + `<a href="#" id="print-submission">Download / print</a> &middot; `
       + `<a href="#" id="copy-json">Copy as JSON</a></div>`;

  // Lead workflow panel (status / notes / tags)
  html += renderLeadPanel(type, subId);

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

  if (type === 'intake') {
    // Header card with the person's identity (matches the PDF header)
    const fullName = data['Full name'] || data['full-name'] || '';
    const emailVal = data.email || data.Email || '';
    const phone = data.Phone || data.phone || '';
    const meta = [];
    if (emailVal) meta.push(escape(emailVal));
    if (phone) meta.push(escape(phone));
    if (fullName || emailVal) {
      html += '<div class="intake-header-card">';
      html += '<div class="intake-header-name">' + escape(fullName || emailVal || 'Intake submission') + '</div>';
      if (meta.length > 0) {
        html += '<div class="intake-header-meta">' + meta.join(' &middot; ') + '</div>';
      }
      html += '</div>';
    }
    html += renderIntakeDetailGrouped(data);
  } else {
    // Quiz — keep the original priority + flat list
    const skipKeys = new Set(['id', '_kind', 'userAgent', 'referer']);
    const keys = Object.keys(data).filter(k => !skipKeys.has(k));
    const priority = ['profile', 'email', 'name', 'createdAt', 'emailCapturedAt', 'answers'];
    const orderedKeys = [
      ...priority.filter(k => keys.includes(k)),
      ...keys.filter(k => !priority.includes(k))
    ];
    html += '<dl class="detail-fields">';
    for (const key of orderedKeys) {
      html += `<dt>${escape(key)}</dt>`;
      html += `<dd>${formatValue(data[key])}</dd>`;
    }
    html += '</dl>';
  }

  setTimeout(() => {
    initLeadPanel(type, subId);
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

  const usedKeys = new Set();
  INTAKE_SECTION_MAP.forEach(sect => {
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

// ===================================================================
// CMS — shared editor modal
// ===================================================================
const editorModalEl = document.getElementById('editor-modal');
const editorBodyEl = document.getElementById('editor-body');

function openEditor(html) {
  editorBodyEl.innerHTML = html;
  editorModalEl.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeEditor() {
  editorModalEl.classList.add('hidden');
  document.body.style.overflow = '';
  editorBodyEl.innerHTML = '';
}
document.getElementById('editor-close').addEventListener('click', closeEditor);
document.querySelectorAll('[data-close-editor]').forEach(el =>
  el.addEventListener('click', closeEditor)
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !editorModalEl.classList.contains('hidden')) closeEditor();
});

// ===================================================================
// In-page confirmation — replaces window.confirm() so the browser's
// "suppress dialogs" checkbox can never silently disable actions.
// Returns a Promise<boolean>.
// ===================================================================
function hofConfirm(message, confirmLabel = 'Yes, continue', danger = false) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box" role="alertdialog" aria-modal="true">
        <p class="confirm-msg">${escape(message)}</p>
        <div class="confirm-actions">
          <button type="button" class="ghost-btn" data-c="no">Cancel</button>
          <button type="button" class="${danger ? 'danger-btn' : 'primary-btn'}" data-c="yes">${escape(confirmLabel)}</button>
        </div>
      </div>`;
    function done(v) {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    }
    function onKey(e) { if (e.key === 'Escape') done(false); }
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) done(false);
      const btn = e.target.closest('[data-c]');
      if (btn) done(btn.dataset.c === 'yes');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-c="yes"]').focus();
  });
}

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

// ===================================================================
// CMS — Blog posts
// ===================================================================

// The four From the Orchard pillars — every post belongs to exactly one
// (Blog Addendum). Keys must match blog.html / blog-post.html.
const PILLARS = {
  trellis: 'The Trellis',
  fallow: 'The Fallow',
  vine: 'Off the Vine',
  grove: 'The Grove'
};

// Preview a draft on the real public page before publishing. The draft is
// handed over via localStorage (admin + site share the origin) and the page
// is opened with ?preview=1, which renders it with a "not published" banner.
function openSitePreview(kind, data, page) {
  try {
    localStorage.setItem('hof_preview', JSON.stringify({ kind, data, at: Date.now() }));
  } catch (err) {
    alert('Preview failed: ' + (err.message || err));
    return;
  }
  window.open('/' + page + (page.includes('?') ? '&' : '?') + 'preview=1', 'hof-preview');
}

function renderPostList() {
  const el = document.getElementById('post-list');
  if (!el) return;
  if (postDocs.length === 0) {
    el.innerHTML = '<p class="empty">No posts yet. Create your first one.</p>';
    return;
  }
  el.innerHTML = postDocs.map(d => {
    const chip = d.status === 'published'
      ? '<span class="status-chip status-published">Published</span>'
      : '<span class="status-chip status-draft">Draft</span>';
    const date = d.publishedAt || d.updatedAt || d.createdAt;
    const excerpt = d.excerpt ? escape(d.excerpt) : '<em>No excerpt</em>';
    const pillarChip = d.pillar && PILLARS[d.pillar]
      ? `<span class="status-chip" style="background:rgba(114,47,69,0.1);color:#722F45;">${escape(PILLARS[d.pillar])}</span>`
      : '<span class="status-chip status-draft">No pillar</span>';
    return `
      <div class="data-row cms-row" data-id="${escape(d.id)}" data-kind="post">
        <div class="row-main">
          <div class="row-title">${escape(d.title || 'Untitled')} ${pillarChip} ${chip}</div>
          <div class="row-sub">${excerpt}</div>
        </div>
        <div class="row-time">${formatTime(date)}</div>
      </div>`;
  }).join('');
  el.querySelectorAll('.cms-row').forEach(row =>
    row.addEventListener('click', () => openPostEditor(row.dataset.id))
  );
}

function openPostEditor(id) {
  const post = id ? postDocs.find(p => p.id === id) : null;
  const isNew = !post;
  const p = post || {
    title: '', slug: '', excerpt: '', body: '',
    coverImage: '', author: 'Bethany Grissum', status: 'draft', pillar: ''
  };
  openEditor(`
    <h2>${isNew ? 'New blog post' : 'Edit blog post'}</h2>
    <form id="post-form" class="editor-form">
      <label>Title
        <input type="text" name="title" value="${escape(p.title)}" required>
      </label>
      <label>Slug (web address)
        <input type="text" name="slug" value="${escape(p.slug)}" placeholder="auto-filled from title">
        <span class="field-hint">Lowercase letters, numbers, and hyphens. Leave blank to auto-fill. Shows as /blog/&lt;slug&gt;.</span>
      </label>
      <label>Pillar (the post's From the Orchard category)
        <select name="pillar">
          <option value="" ${!p.pillar ? 'selected' : ''}>— Choose a pillar —</option>
          ${Object.entries(PILLARS).map(([k, name]) =>
            `<option value="${k}" ${p.pillar === k ? 'selected' : ''}>${name}</option>`
          ).join('')}
        </select>
        <span class="field-hint">Every post belongs to exactly one pillar: Trellis (big changes), Fallow (rest), Off the Vine (myths), Grove (reader questions).</span>
      </label>
      <label>Excerpt (short teaser shown on the blog list)
        <textarea name="excerpt" rows="2" maxlength="600">${escape(p.excerpt)}</textarea>
      </label>
      <label>Cover image (optional)
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <input type="text" name="coverImage" value="${escape(p.coverImage)}" placeholder="/images/... or upload →" style="flex:1;">
          <button type="button" class="ghost-btn" id="upload-cover">Upload</button>
        </div>
      </label>
      <label>Author
        <input type="text" name="author" value="${escape(p.author || '')}">
      </label>
      <label>Body
        <div style="display:flex;justify-content:flex-end;margin-bottom:0.35rem;">
          <button type="button" class="ghost-btn" id="insert-image">+ Insert image</button>
        </div>
        <textarea name="body" rows="14" class="editor-body-field">${escape(p.body)}</textarea>
        <span class="field-hint">Paste straight from Word or Google Docs — headings, bold/italic, lists, and paragraph spacing convert automatically. Or write here: a blank line (Enter twice) starts a new paragraph; a single Enter is a line break; HTML mixes in freely (&lt;strong&gt;, &lt;em&gt;, &lt;a&gt;, &lt;h2&gt;, &lt;ul&gt;, &lt;blockquote&gt;, &lt;img&gt;, &lt;hr&gt;). Use Preview to check the look.</span>
      </label>
      <label class="editor-status">Status
        <select name="status">
          <option value="draft" ${p.status !== 'published' ? 'selected' : ''}>Draft — not visible on the site</option>
          <option value="published" ${p.status === 'published' ? 'selected' : ''}>Published — live on the site</option>
        </select>
      </label>
      <div class="editor-actions">
        <div class="editor-actions-left">
          ${isNew ? '' : '<button type="button" class="danger-btn" id="delete-post">Delete</button>'}
        </div>
        <div class="editor-actions-right">
          <button type="button" class="ghost-btn" id="preview-post">Preview</button>
          <button type="button" class="ghost-btn" id="cancel-editor">Cancel</button>
          <button type="submit" class="primary-btn">Save</button>
        </div>
      </div>
      <p class="editor-status-msg" id="post-status-msg"></p>
    </form>
  `);
  const form = document.getElementById('post-form');
  form.addEventListener('submit', (e) => { e.preventDefault(); savePost(id, form); });
  document.getElementById('cancel-editor').addEventListener('click', closeEditor);
  document.getElementById('preview-post').addEventListener('click', () => {
    const fd = new FormData(form);
    openSitePreview('post', {
      title: (fd.get('title') || 'Untitled').trim() || 'Untitled',
      slug: slugify(fd.get('slug') || '') || slugify(fd.get('title') || ''),
      pillar: PILLARS[fd.get('pillar')] ? fd.get('pillar') : '',
      excerpt: (fd.get('excerpt') || '').trim(),
      body: (fd.get('body') || '').trim(),
      coverImage: (fd.get('coverImage') || '').trim(),
      author: (fd.get('author') || '').trim(),
      publishedAt: p.publishedAt || new Date().toISOString()
    }, 'blog-post.html');
  });
  const del = document.getElementById('delete-post');
  if (del) del.addEventListener('click', () => deletePost(id));

  // Image uploads — cover image and in-body images go to Firebase Storage.
  const statusMsg = document.getElementById('post-status-msg');
  function pickImage(onDone) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      statusMsg.textContent = 'Uploading image…';
      try {
        const url = await uploadImage(file);
        statusMsg.textContent = 'Image uploaded.';
        onDone(url);
      } catch (err) {
        console.error('uploadImage failed:', err);
        statusMsg.textContent = 'Upload failed: ' + (err.message || err);
      }
    });
    input.click();
  }
  document.getElementById('upload-cover').addEventListener('click', () => {
    pickImage((url) => { form.querySelector('[name="coverImage"]').value = url; });
  });
  document.getElementById('insert-image').addEventListener('click', () => {
    pickImage((url) => {
      const field = form.querySelector('[name="body"]');
      const start = field.selectionStart ?? field.value.length;
      const snippet = '\n\n<img src="' + url + '" alt="">\n\n';
      field.value = field.value.slice(0, start) + snippet + field.value.slice(field.selectionEnd ?? start);
      const pos = start + snippet.length;
      field.focus();
      field.setSelectionRange(pos, pos);
    });
  });

  // Pasting from Word/Google Docs: convert the rich clipboard HTML into
  // the clean markup the blog renderer expects, instead of losing all
  // formatting to the plain textarea.
  const bodyField = form.querySelector('[name="body"]');
  bodyField.addEventListener('paste', (e) => {
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    if (!html || !/</.test(html)) return; // plain text — let the browser handle it
    e.preventDefault();
    const converted = wordHtmlToBody(html);
    const start = bodyField.selectionStart;
    const end = bodyField.selectionEnd;
    bodyField.value = bodyField.value.slice(0, start) + converted + bodyField.value.slice(end);
    const pos = start + converted.length;
    bodyField.setSelectionRange(pos, pos);
  });
}

// Convert Word / Google Docs clipboard HTML into the editor's format:
// blank-line-separated paragraphs with a little clean inline HTML
// (<strong>, <em>, <a>) and block HTML (<h2>, <h3>, <ul>, <ol>,
// <blockquote>) — exactly what blog-post.html's bodyHtml() renders.
function wordHtmlToBody(html) {
  const docEl = new DOMParser().parseFromString(html, 'text/html');

  // Inline content of a node → text with clean inline tags.
  function inline(node) {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.textContent.replace(/[ \s]+/g, ' ');
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') { out += '\n'; return; }
      const cs = n.style || {};
      let inner = inline(n);
      if (!inner.trim()) { out += inner; return; }
      // Google Docs wraps whole documents in <b style="font-weight:normal">.
      const bold = ((tag === 'b' || tag === 'strong') && cs.fontWeight !== 'normal')
        || parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === 'bold';
      const italic = tag === 'i' || tag === 'em' || cs.fontStyle === 'italic';
      if (bold) inner = '<strong>' + inner.trim() + '</strong>' + (/\s$/.test(inner) ? ' ' : '');
      if (italic) inner = '<em>' + inner.trim() + '</em>' + (/\s$/.test(inner) ? ' ' : '');
      if (tag === 'a' && n.getAttribute('href') && !/^javascript:/i.test(n.getAttribute('href'))) {
        inner = '<a href="' + n.getAttribute('href') + '">' + inner.trim() + '</a>';
      }
      out += inner;
    });
    return out;
  }

  // Strip the fake "·  " / "1.  " prefixes Word puts on list paragraphs.
  function stripListMarker(s) {
    return s.replace(/^\s*(?:[·•o§\-•●▪]|\(?\d{1,3}[.)]|[a-z][.)])\s+/i, '').trim();
  }

  const blocks = []; // { kind: 'p'|'h2'|'h3'|'quote'|'li'|'oli', text }
  function walk(node) {
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = n.textContent.trim();
        if (t) blocks.push({ kind: 'p', text: t });
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const tag = n.tagName.toLowerCase();
      if (tag === 'style' || tag === 'script' || tag === 'meta' || tag === 'link' || tag === 'xml') return;
      if (/^h[1-2]$/.test(tag)) { blocks.push({ kind: 'h2', text: inline(n).trim() }); return; }
      if (/^h[3-6]$/.test(tag)) { blocks.push({ kind: 'h3', text: inline(n).trim() }); return; }
      if (tag === 'blockquote') { blocks.push({ kind: 'quote', text: inline(n).trim() }); return; }
      if (tag === 'li') {
        const listTag = n.parentElement && n.parentElement.tagName.toLowerCase();
        blocks.push({ kind: listTag === 'ol' ? 'oli' : 'li', text: inline(n).trim() });
        return;
      }
      if (tag === 'p') {
        const cls = (n.getAttribute('class') || '') + ' ' + ((n.getAttribute('style') || ''));
        const text = inline(n).trim();
        if (!text) return;
        if (/MsoListParagraph|mso-list/i.test(cls)) {
          const numbered = /^\s*\(?\d{1,3}[.)]\s/.test(text);
          blocks.push({ kind: numbered ? 'oli' : 'li', text: stripListMarker(text) });
        } else if (/MsoQuote|MsoIntenseQuote/i.test(cls)) {
          blocks.push({ kind: 'quote', text });
        } else {
          blocks.push({ kind: 'p', text });
        }
        return;
      }
      walk(n); // div, span wrappers, ul/ol containers, td, etc.
    });
  }
  walk(docEl.body);

  // Assemble: consecutive list items merge into one <ul>/<ol> block.
  const out = [];
  let list = null; // { tag, items }
  function flushList() {
    if (!list) return;
    out.push('<' + list.tag + '>' + list.items.map((i) => '<li>' + i + '</li>').join('') + '</' + list.tag + '>');
    list = null;
  }
  blocks.forEach((b) => {
    if (b.kind === 'li' || b.kind === 'oli') {
      const tag = b.kind === 'oli' ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(b.text);
      return;
    }
    flushList();
    if (!b.text) return;
    if (b.kind === 'h2') out.push('<h2>' + b.text + '</h2>');
    else if (b.kind === 'h3') out.push('<h3>' + b.text + '</h3>');
    else if (b.kind === 'quote') out.push('<blockquote>' + b.text + '</blockquote>');
    else out.push(b.text);
  });
  flushList();

  return out.join('\n\n');
}

async function savePost(id, form) {
  const msg = document.getElementById('post-status-msg');
  const submitBtn = form.querySelector('button[type="submit"]');
  const fd = new FormData(form);
  const title = (fd.get('title') || '').trim();
  if (!title) { msg.textContent = 'Title is required.'; return; }

  const slug = slugify(fd.get('slug') || '') || slugify(title);
  if (!slug) { msg.textContent = 'Please add a title or slug with letters/numbers.'; return; }

  const now = new Date().toISOString();
  const status = fd.get('status') === 'published' ? 'published' : 'draft';
  const existing = id ? postDocs.find(p => p.id === id) : null;

  const pillar = PILLARS[fd.get('pillar')] ? fd.get('pillar') : '';

  const data = {
    title,
    slug,
    pillar,
    excerpt: (fd.get('excerpt') || '').trim(),
    body: (fd.get('body') || '').trim(),
    coverImage: (fd.get('coverImage') || '').trim(),
    author: (fd.get('author') || '').trim(),
    status,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    publishedAt: status === 'published' ? (existing?.publishedAt || now) : (existing?.publishedAt || null)
  };

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    if (id) {
      await setDoc(doc(db, 'posts', id), data);
    } else {
      await addDoc(collection(db, 'posts'), data);
    }
    closeEditor();
  } catch (err) {
    console.error('savePost failed:', err);
    msg.textContent = 'Save failed: ' + (err.message || err);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
}

async function deletePost(id) {
  if (!(await hofConfirm('Delete this post permanently? This cannot be undone.', 'Delete post', true))) return;
  try {
    await deleteDoc(doc(db, 'posts', id));
    closeEditor();
  } catch (err) {
    console.error('deletePost failed:', err);
    alert('Delete failed: ' + (err.message || err));
  }
}

document.getElementById('new-post').addEventListener('click', () => openPostEditor(null));

// ===================================================================
// Ask the Grove — reader questions from the From the Orchard blog
// ===================================================================
function renderGroveList() {
  const el = document.getElementById('grove-list');
  if (!el) return;
  if (groveDocs.length === 0) {
    el.innerHTML = '<p class="empty">No questions planted yet.</p>';
    return;
  }
  el.innerHTML = groveDocs.map(g => {
    const chip = g.answeredAt
      ? '<span class="status-chip status-published">Answered</span>'
      : '<span class="status-chip status-draft">New</span>';
    const who = [g.name, g.email].filter(Boolean).join(' · ') || 'Anonymous';
    const q = String(g.question || '');
    const preview = q.length > 140 ? q.slice(0, 137) + '…' : q;
    return `
      <div class="data-row grove-row" data-id="${escape(g.id)}">
        <div class="row-main">
          <div class="row-title">${escape(who)} ${chip}</div>
          <div class="row-sub">${escape(preview)}</div>
        </div>
        <div class="row-time">${formatTime(g.createdAt)}</div>
      </div>`;
  }).join('');
  el.querySelectorAll('.grove-row').forEach(row =>
    row.addEventListener('click', () => openGroveDetail(row.dataset.id))
  );
}

function openGroveDetail(id) {
  const g = groveDocs.find(x => x.id === id);
  if (!g) return;
  const who = [g.name, g.email].filter(Boolean).join(' · ') || 'Anonymous';
  modalBodyEl.innerHTML = (`
    <h2>Ask the Grove</h2>
    <p style="color:#897866;font-size:0.875rem;margin:0 0 1rem;">
      ${escape(who)} &middot; ${formatTime(g.createdAt)}
      ${g.answeredAt ? ' &middot; Answered ' + formatTime(g.answeredAt) : ''}
    </p>
    <p style="white-space:pre-wrap;line-height:1.7;">${escape(g.question || '')}</p>
    <div style="display:flex;gap:0.5rem;margin-top:1.5rem;flex-wrap:wrap;">
      <button class="primary-btn" id="grove-answer-post" type="button">Answer as a Grove post</button>
      <button class="ghost-btn" id="grove-toggle-answered" type="button">
        ${g.answeredAt ? 'Mark as unanswered' : 'Mark as answered'}
      </button>
    </div>
  `);
  modalEl.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('grove-answer-post').addEventListener('click', () => {
    closeDetail();
    // Pre-fill a Grove-pillar post from the question.
    openPostEditor(null);
    const form = document.getElementById('post-form');
    if (form) {
      form.querySelector('[name="pillar"]').value = 'grove';
      form.querySelector('[name="body"]').value =
        'From the Grove: “' + String(g.question || '').trim() + '”\n\n';
    }
  });
  document.getElementById('grove-toggle-answered').addEventListener('click', async () => {
    try {
      await updateDoc(doc(db, 'grove', id), {
        answeredAt: g.answeredAt ? null : new Date().toISOString()
      });
      closeDetail();
    } catch (err) {
      console.error('grove toggle failed:', err);
      alert('Update failed: ' + (err.message || err));
    }
  });
}

// ===================================================================
// CMS — Testimonials
// ===================================================================
function renderTestimonialList() {
  const el = document.getElementById('testimonial-list');
  if (!el) return;
  if (testimonialDocs.length === 0) {
    el.innerHTML = '<p class="empty">No testimonials yet. Create your first one.</p>';
    return;
  }
  el.innerHTML = testimonialDocs.map(d => {
    const chip = d.status === 'published'
      ? '<span class="status-chip status-published">Published</span>'
      : '<span class="status-chip status-draft">Draft</span>';
    const quote = d.quote ? escape(d.quote.slice(0, 120)) + (d.quote.length > 120 ? '…' : '') : '';
    return `
      <div class="data-row cms-row" data-id="${escape(d.id)}" data-kind="testimonial">
        <div class="row-main">
          <div class="row-title">${escape(d.name || 'Anonymous')} ${chip}</div>
          <div class="row-sub">${quote}</div>
        </div>
        <div class="row-time">#${d.order ?? 0}</div>
      </div>`;
  }).join('');
  el.querySelectorAll('.cms-row').forEach(row =>
    row.addEventListener('click', () => openTestimonialEditor(row.dataset.id))
  );
}

function openTestimonialEditor(id) {
  const t = id ? testimonialDocs.find(x => x.id === id) : null;
  const isNew = !t;
  const nextOrder = testimonialDocs.length
    ? Math.max(...testimonialDocs.map(x => x.order ?? 0)) + 1
    : 0;
  const v = t || { name: '', quote: '', context: '', status: 'draft', order: nextOrder };
  openEditor(`
    <h2>${isNew ? 'New testimonial' : 'Edit testimonial'}</h2>
    <form id="testimonial-form" class="editor-form">
      <label>Name
        <input type="text" name="name" value="${escape(v.name)}" required>
      </label>
      <label>Context (optional — e.g. "Nutrition client, 2025")
        <input type="text" name="context" value="${escape(v.context || '')}">
      </label>
      <label>Quote
        <textarea name="quote" rows="6" required maxlength="4000">${escape(v.quote)}</textarea>
      </label>
      <label>Display order
        <input type="number" name="order" value="${v.order ?? 0}" step="1">
        <span class="field-hint">Lower numbers show first.</span>
      </label>
      <label class="editor-status">Status
        <select name="status">
          <option value="draft" ${v.status !== 'published' ? 'selected' : ''}>Draft — not visible on the site</option>
          <option value="published" ${v.status === 'published' ? 'selected' : ''}>Published — live on the site</option>
        </select>
      </label>
      <div class="editor-actions">
        <div class="editor-actions-left">
          ${isNew ? '' : '<button type="button" class="danger-btn" id="delete-testimonial">Delete</button>'}
        </div>
        <div class="editor-actions-right">
          <button type="button" class="ghost-btn" id="preview-testimonial">Preview</button>
          <button type="button" class="ghost-btn" id="cancel-editor-t">Cancel</button>
          <button type="submit" class="primary-btn">Save</button>
        </div>
      </div>
      <p class="editor-status-msg" id="testimonial-status-msg"></p>
    </form>
  `);
  const form = document.getElementById('testimonial-form');
  form.addEventListener('submit', (e) => { e.preventDefault(); saveTestimonial(id, form); });
  document.getElementById('cancel-editor-t').addEventListener('click', closeEditor);
  document.getElementById('preview-testimonial').addEventListener('click', () => {
    const fd = new FormData(form);
    openSitePreview('testimonial', {
      name: (fd.get('name') || 'Client').trim() || 'Client',
      quote: (fd.get('quote') || '').trim(),
      context: (fd.get('context') || '').trim()
    }, 'testimonials.html');
  });
  const del = document.getElementById('delete-testimonial');
  if (del) del.addEventListener('click', () => deleteTestimonial(id));
}

async function saveTestimonial(id, form) {
  const msg = document.getElementById('testimonial-status-msg');
  const submitBtn = form.querySelector('button[type="submit"]');
  const fd = new FormData(form);
  const name = (fd.get('name') || '').trim();
  const quote = (fd.get('quote') || '').trim();
  if (!name || !quote) { msg.textContent = 'Name and quote are required.'; return; }

  const now = new Date().toISOString();
  const existing = id ? testimonialDocs.find(x => x.id === id) : null;
  const order = parseInt(fd.get('order'), 10);
  const data = {
    name,
    quote,
    context: (fd.get('context') || '').trim(),
    status: fd.get('status') === 'published' ? 'published' : 'draft',
    order: Number.isFinite(order) ? order : 0,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    if (id) {
      await setDoc(doc(db, 'testimonials', id), data);
    } else {
      await addDoc(collection(db, 'testimonials'), data);
    }
    closeEditor();
  } catch (err) {
    console.error('saveTestimonial failed:', err);
    msg.textContent = 'Save failed: ' + (err.message || err);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
}

async function deleteTestimonial(id) {
  if (!(await hofConfirm('Delete this testimonial permanently? This cannot be undone.', 'Delete testimonial', true))) return;
  try {
    await deleteDoc(doc(db, 'testimonials', id));
    closeEditor();
  } catch (err) {
    console.error('deleteTestimonial failed:', err);
    alert('Delete failed: ' + (err.message || err));
  }
}

document.getElementById('new-testimonial').addEventListener('click', () => openTestimonialEditor(null));

// ===================================================================
// Lead management — status / notes / tags on quiz + intake submissions.
// Stored in /leadMeta/{type_id} so submission docs stay write-once.
// ===================================================================
const LEAD_STATUSES = ['New', 'Contacted', 'Client', 'Archived'];

function leadKey(type, id) {
  // Normalize type ('quiz'/'intake') and prefix the id.
  return `${type}_${id}`;
}

function renderLeadPanel(type, id) {
  if (!id) return '';
  const meta = leadMeta[leadKey(type, id)] || {};
  const current = meta.status || 'New';
  const notes = meta.notes || '';
  const tags = Array.isArray(meta.tags) ? meta.tags.join(', ') : (meta.tags || '');

  const buttons = LEAD_STATUSES.map(s =>
    `<button type="button" class="lead-status-btn${s === current ? ' active' : ''}" data-status="${s}">${s}</button>`
  ).join('');

  return `
    <div class="lead-panel" data-lead-id="${escape(id)}" data-lead-type="${escape(type)}">
      <p class="lead-panel-title">Lead status &amp; notes</p>
      <div class="lead-status-row" id="lead-status-row">${buttons}</div>
      <label class="lead-field-label" for="lead-notes-field">Private notes (only visible here)</label>
      <textarea class="lead-notes" id="lead-notes-field" rows="3" placeholder="Add a note about this lead…">${escape(notes)}</textarea>
      <label class="lead-field-label" for="lead-tags-field">Tags (comma-separated)</label>
      <input type="text" class="lead-notes lead-tags-input" id="lead-tags-field" value="${escape(tags)}" placeholder="e.g. hormones, follow-up, VIP">
      <div class="lead-save-row">
        <button type="button" class="primary-btn" id="lead-save">Save</button>
        <span class="lead-save-status" id="lead-save-status"></span>
      </div>
    </div>`;
}

function initLeadPanel(type, id) {
  const panel = document.querySelector('.lead-panel');
  if (!panel || !id) return;

  let selectedStatus = (leadMeta[leadKey(type, id)] || {}).status || 'New';

  panel.querySelectorAll('.lead-status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedStatus = btn.dataset.status;
      panel.querySelectorAll('.lead-status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const saveBtn = document.getElementById('lead-save');
  const statusEl = document.getElementById('lead-save-status');
  saveBtn.addEventListener('click', async () => {
    const notes = document.getElementById('lead-notes-field').value.trim();
    const tags = document.getElementById('lead-tags-field').value
      .split(',').map(t => t.trim()).filter(Boolean).slice(0, 20);
    saveBtn.disabled = true;
    statusEl.textContent = 'Saving…';
    try {
      await setDoc(doc(db, 'leadMeta', leadKey(type, id)), {
        status: selectedStatus,
        notes,
        tags,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      statusEl.textContent = 'Saved ✓';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    } catch (err) {
      console.error('lead save failed:', err);
      statusEl.textContent = 'Save failed';
    } finally {
      saveBtn.disabled = false;
    }
  });
}

// Small status chip for the list rows (hidden for the default "New").
function leadChip(type, id) {
  const meta = leadMeta[leadKey(type, id)];
  const status = meta && meta.status;
  if (!status || status === 'New') return '';
  const cls = 's-' + status.toLowerCase();
  return `<span class="lead-row-chip ${cls}">${escape(status)}</span>`;
}

// ===================================================================
// Rooted Assessments — review workspace
// ===================================================================

// Two-audience leak terms. KEEP IN SYNC with functions/rooted-data.js
// (LEAK_TERMS) — the Cloud Function re-checks on send, so this client copy
// is a convenience, not the security boundary.
const LEAK_TERMS = [
  'CBC', 'ferritin', 'TIBC', 'HbA1c', 'A1c', 'hs-CRP', 'CRP', 'TSH', 'ApoB',
  'Lp(a)', 'ALT', 'AST', 'DUTCH', 'estradiol', 'progesterone', 'FSH',
  'RBC magnesium', 'iron panel', 'lab panel', 'bloodwork panel', 'thyroid panel',
  'hormone panel', 'fasting glucose',
  'supplement', 'mg ', ' mcg', ' IU', 'dose', 'dosage', 'capsule',
  'insulin resistance', 'estrogen dominance', 'HPA-axis', 'HPA axis',
  'dysregulation', 'cardiometabolic', 'microbiome', 'dysbiosis',
  'adrenal', 'cortisol', 'functional range', 'optimal range', 'referral',
  'disordered eating', 'SCOFF', 'diagnosis', 'clinical',
  // Gate C additions (Client Journey briefing): no calorie/macro targets
  // or appearance-based goal language in client-facing output.
  'calorie', 'calories', 'macro', 'macros', 'kcal', 'BMI',
  'weight target', 'goal weight', 'pounds to lose'
];

function clientLeakCheck(text) {
  const findings = [];
  for (const term of LEAK_TERMS) {
    const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^A-Za-z])${escaped}($|[^A-Za-z])`, 'i');
    if (re.test(text)) findings.push(term.trim());
  }
  return findings;
}

const PLAN_STATUS_LABELS = {
  halted: ['Safety hold — review', 's-halted'],
  clearing: ['Hold cleared — drafting…', 's-draft'],
  requested: ['Generating…', 's-draft'],
  request_failed: ['Generation failed', 's-halted'],
  draft_failed: ['Draft failed', 's-halted'],
  leak_blocked: ['Leak blocked', 's-halted'],
  draft: ['In review', 's-draft'],
  ready: ['Ready for follow-up', 's-ready'],
  approved: ['Sending plan…', 's-ready'],
  sent: ['Plan sent', 's-sent'],
  send_failed: ['Send failed', 's-halted']
};

function assessmentStatus(a) {
  if (a.status === 'halted') return 'halted';
  if (a.status === 'cleared') return 'clearing';
  if (a.status === 'requested') return 'requested';
  if (a.status === 'request_failed') return 'request_failed';
  const plan = planDocs[a.id];
  if (plan && plan.status === 'sent') return 'sent';
  if (plan && plan.status === 'approved') return 'approved';
  if (a.status === 'approved') return 'ready';
  return (plan && plan.status) || 'draft';
}

function statusChipHtml(status) {
  const [label, cls] = PLAN_STATUS_LABELS[status] || [status, 's-draft'];
  return `<span class="lead-row-chip plan-chip ${cls}">${escape(label)}</span>`;
}

function unprocessedIntakes() {
  const done = new Set(assessmentDocs.map(a => a.id));
  return intakeDocs.filter(i => !done.has(i.id));
}

function renderAssessmentList() {
  const el = document.getElementById('assessment-list');
  if (!el) return;

  // Backfill button: intakes from before the pipeline (or missed runs).
  const backfillBtn = document.getElementById('process-earlier');
  if (backfillBtn) {
    const n = unprocessedIntakes().length;
    backfillBtn.style.display = n ? '' : 'none';
    backfillBtn.textContent = `Process earlier intakes (${n})`;
  }

  if (assessmentDocs.length === 0) {
    el.innerHTML = '<p class="empty">No assessments yet — they appear when an intake is submitted.</p>';
    return;
  }
  el.innerHTML = assessmentDocs.map(a => {
    const status = assessmentStatus(a);
    const who = a.client?.name || a.client?.email || 'Unnamed';
    const priorities = (a.priorities || []).map(p => p.label).join(' · ');
    return `
      <div class="data-row cms-row" data-id="${escape(a.id)}">
        <div class="row-main">
          <div class="row-title">${escape(who)} ${statusChipHtml(status)}</div>
          <div class="row-sub">${escape(priorities || '—')}</div>
        </div>
        <div class="row-time">${formatTime(a.createdAt)}</div>
      </div>`;
  }).join('');
  el.querySelectorAll('.cms-row').forEach(row =>
    row.addEventListener('click', () => openAssessmentDetail(row.dataset.id))
  );
}

// ===================================================================
// Calendly connection (the 24-hour booking gate)
// ===================================================================
function updateCalendlyButton() {
  const btn = document.getElementById('calendly-connect');
  if (!btn) return;
  btn.style.display = '';
  if (calendlyConnected) {
    btn.textContent = 'Calendly connected ✓';
    btn.disabled = true;
  } else {
    btn.textContent = 'Connect Calendly';
    btn.disabled = false;
  }
}

const calendlyConnectBtn = document.getElementById('calendly-connect');
if (calendlyConnectBtn) {
  calendlyConnectBtn.addEventListener('click', async () => {
    if (calendlyConnected) return;
    const ok = await hofConfirm(
      'Connect Calendly? This registers the booking webhook so confirmations, reminders, and the 24-hour intake rule run automatically.',
      'Connect'
    );
    if (!ok) return;
    calendlyConnectBtn.disabled = true;
    calendlyConnectBtn.textContent = 'Connecting…';
    try {
      const setup = httpsCallable(getFunctions(app, 'us-central1'), 'calendlySetup');
      await setup({});
      calendlyConnectBtn.textContent = 'Calendly connected ✓';
    } catch (err) {
      console.error('Calendly connect failed:', err);
      calendlyConnectBtn.disabled = false;
      calendlyConnectBtn.textContent = 'Connect Calendly';
      alert('Connection failed: ' + (err.message || err) + '\n\nCheck that the CALENDLY_TOKEN secret is set and the paid plan is active.');
    }
  });
}

// Backfill: create "requested" stubs; the onAssessmentRequested function
// runs the normal pipeline for each. Nothing is sent to clients.
const processEarlierBtn = document.getElementById('process-earlier');
if (processEarlierBtn) {
  processEarlierBtn.addEventListener('click', async () => {
    const pending = unprocessedIntakes();
    if (!pending.length) return;
    const ok = await hofConfirm(
      `Generate assessments for ${pending.length} earlier intake${pending.length === 1 ? '' : 's'}? Prep sheets and plan drafts are created for your review — nothing is sent to clients.`,
      'Generate assessments'
    );
    if (!ok) return;
    processEarlierBtn.disabled = true;
    processEarlierBtn.textContent = 'Queuing…';
    try {
      for (const i of pending) {
        await setDoc(doc(db, 'assessments', i.id), {
          status: 'requested',
          intakeId: i.id,
          client: {
            name: i['Full name'] || i['full-name'] || '',
            email: (i.email || i.Email || '')
          },
          requestedAt: new Date().toISOString(),
          createdAt: i.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('backfill queue failed:', err);
      alert('Queuing failed: ' + (err.message || err));
    } finally {
      processEarlierBtn.disabled = false;
    }
  });
}

function tallyTableHtml(a) {
  const rows = Object.values(a.tally || {}).map(t => `
    <tr>
      <td>${escape(t.label)}</td>
      <td style="text-align:center;">${t.checked}</td>
      <td style="text-align:center;">${t.tier || '—'}</td>
      <td>${t.flag ? '✓ flag' : (t.lean ? 'lean' : '—')}${t.anchored ? ' · anchored' : ''}${t.selfId ? ' · self-ID' : ''}</td>
    </tr>`).join('');
  return `<table class="aw-table">
    <thead><tr><th>Color</th><th>#</th><th>Tier</th><th>Signal</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function worksheetHtml(a) {
  let html = '<div class="aw-section"><h3>Rainbow cluster tally</h3>' + tallyTableHtml(a) + '</div>';

  if ((a.patterns || []).length) {
    html += '<div class="aw-section"><h3>Pattern candidates</h3>' + a.patterns.map(p =>
      `<div class="aw-item"><strong>${escape(p.name)}</strong> <em>(${escape(p.strength)}, score ${p.score})</em><br>
       <span class="aw-muted">${escape(p.whereToBegin)}</span><br>
       <span class="aw-evidence">${p.evidence.map(escape).join(' · ')}</span></div>`
    ).join('') + '</div>';
  }

  html += '<div class="aw-section"><h3>Priorities</h3>' + (a.priorities || []).map((p, i) =>
    `<div class="aw-item">${i + 1}. <strong>${escape(p.label)}</strong> — <span class="aw-muted">${escape(p.why)}</span></div>`
  ).join('') + (a.sequencingRules || []).map(r => `<div class="aw-muted" style="margin-top:4px;">↳ ${escape(r)}</div>`).join('') + '</div>';

  html += `<div class="aw-section"><h3>Pour</h3>
    <div class="aw-item">${(a.pour?.colors || []).map(c => escape(c)).join(' · ') || '—'}</div>
    ${Object.entries(a.pour?.ingredients || {}).map(([c, ing]) => `<div class="aw-muted">${escape(c)}: ${escape(ing)}</div>`).join('')}
    ${(a.pour?.notes || []).map(n => `<div class="aw-evidence">• ${escape(n)}</div>`).join('')}</div>`;

  html += '<div class="aw-section"><h3>Four-week arc</h3>' + (a.weeks || []).map(w =>
    `<div class="aw-item"><strong>Week ${w.week} · ${escape(w.name)}</strong> — ${escape(w.colors.join(' + '))}<br><span class="aw-muted">${escape(w.focus)}</span></div>`
  ).join('') + '</div>';

  if (a.labs) {
    html += `<div class="aw-section"><h3>Labs guidance (practitioner-side only)</h3>
      <div class="aw-muted">${escape(a.labs.note || '')}</div>
      ${a.labs.recommendPrimary?.length ? `<div class="aw-item">Recommend primary panel: ${a.labs.recommendPrimary.map(escape).join(', ')}</div>` : ''}
      ${a.labs.referFullPanel?.length ? `<div class="aw-item">Refer for full panel: ${a.labs.referFullPanel.map(escape).join(', ')}</div>` : ''}</div>`;
  }

  if ((a.conditionAdjustments || []).length) {
    html += '<div class="aw-section"><h3>Condition adjustments</h3>' +
      a.conditionAdjustments.map(x => `<div class="aw-item">• ${escape(x.note)}</div>`).join('') + '</div>';
  }

  // Going Deeper answers (Stage 8), when the companion form has returned.
  if (a.goingDeeper) {
    const gd = a.goingDeeper;
    const skip = new Set(['intakeId', 'createdAt', 'Full name']);
    html += `<div class="aw-section"><h3>Going Deeper — companion form${a.gdMergedAt ? ` <span class="aw-muted">(returned ${formatTime(a.gdMergedAt)})</span>` : ''}</h3>`;
    for (const key of Object.keys(gd)) {
      if (skip.has(key)) continue;
      const v = gd[key];
      const val = Array.isArray(v) ? v.join('; ') : String(v);
      if (!val) continue;
      html += `<div class="aw-item"><strong>${escape(key)}:</strong> ${escape(val)}</div>`;
    }
    html += '</div>';
  }
  return html;
}

// ===================================================================
// Consult prep sheet + journey controls (Stages 5–8)
// ===================================================================
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function journeyLine(j) {
  const bits = [];
  if (j.consultAt) bits.push(`Consult scheduled ${formatTime(j.consultAt)}`);
  if (j.consultHeldAt) bits.push(`Consult held ${formatTime(j.consultHeldAt)}`);
  if (j.email1SentAt === 'skipped-manual') bits.push('Handoff email skipped (recorded manually)');
  else if (j.email1SentAt) bits.push(`Handoff email sent ${formatTime(j.email1SentAt)}`);
  if (j.email2SentAt) bits.push(`Nudge sent ${formatTime(j.email2SentAt)}`);
  if (j.gdReturnedAt) bits.push(`Going Deeper returned ${formatTime(j.gdReturnedAt)}`);
  if (j.email1Error) bits.push(`⚠ ${j.email1Error}`);
  return bits.length ? bits.map(escape).join(' · ') : 'No consult activity yet.';
}

function prepSheetHtml(a) {
  const p = a.prepSheet || {};
  const j = a.journey || {};
  const held = !!j.consultHeldAt;
  return `<div class="aw-section aw-plan" id="prep-sheet">
    <h3>Consult prep sheet ${held ? '<span class="lead-row-chip s-client">Consult held</span>' : ''}</h3>
    <div class="aw-muted" style="margin-bottom:0.75rem;">${journeyLine(j)}</div>
    <div class="editor-form">
      <label>Loudest color (the one you will name)
        <input type="text" id="prep-loudest" value="${escape(p.loudestColor || '')}">
        <span class="field-hint">${escape(p.loudestWhy || '')}</span>
      </label>
      <label>Second thread — noted, not named
        <input type="text" id="prep-second" value="${escape(p.secondThread || '')}">
      </label>
      <label>The one food gift — written before the call
        <textarea id="prep-gift" rows="2">${escape(p.foodGift || '')}</textarea>
      </label>
      <label>Notes from the call
        <textarea id="prep-notes" rows="3">${escape(p.notes || '')}</textarea>
      </label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
        <label>Consult date &amp; time
          <input type="datetime-local" id="journey-consult" value="${toLocalInput(j.consultAt)}">
        </label>
        <label>Follow-up date &amp; time
          <input type="datetime-local" id="journey-followup" value="${toLocalInput(j.followUpAt)}">
          <span class="field-hint">Email 1 asks for the form two days before this.</span>
        </label>
      </div>
      <div class="editor-actions">
        <div class="editor-actions-left"><span class="lead-save-status" id="prep-status"></span></div>
        <div class="editor-actions-right">
          <button type="button" class="ghost-btn" id="prep-print">Print prep sheet</button>
          <button type="button" class="ghost-btn" id="prep-save">Save prep</button>
          ${held ? '' : '<button type="button" class="ghost-btn" id="consult-held-silent">Record consult (no email)</button>'}
          ${held ? '' : '<button type="button" class="primary-btn" id="consult-held">Mark consult held</button>'}
        </div>
      </div>
      ${held ? '' : '<p class="aw-muted" style="margin:6px 0 0;">"Mark consult held" saves the prep sheet and sends the post-consult handoff email (goal echo, food gift, Going Deeper link, follow-up date) within a minute. The single day-3 nudge goes automatically if the form doesn\'t come back. Use "Record consult (no email)" for consults that already happened — it advances the client without emailing them.</p>'}
    </div>
  </div>`;
}

async function savePrepSheet(id, markHeld) {
  const a = assessmentDocs.find(x => x.id === id);
  if (!a) return;
  const st = document.getElementById('prep-status');
  const j = { ...(a.journey || {}) };
  const consultVal = document.getElementById('journey-consult').value;
  const followVal = document.getElementById('journey-followup').value;
  j.consultAt = consultVal ? new Date(consultVal).toISOString() : (j.consultAt || null);
  j.followUpAt = followVal ? new Date(followVal).toISOString() : (j.followUpAt || null);

  const prepSheet = {
    ...(a.prepSheet || {}),
    loudestColor: document.getElementById('prep-loudest').value.trim(),
    secondThread: document.getElementById('prep-second').value.trim(),
    foodGift: document.getElementById('prep-gift').value.trim(),
    notes: document.getElementById('prep-notes').value.trim()
  };

  if (markHeld === 'silent') {
    const ok = await hofConfirm(
      `Record that ${a.client?.name || 'this client'}'s consult already happened? No email is sent — the client simply advances to "Awaiting Going Deeper". Send them the Going Deeper link yourself if they don't have it.`,
      'Record consult'
    );
    if (!ok) return;
    j.consultHeldAt = new Date().toISOString();
    j.email1SentAt = 'skipped-manual'; // prevents the automated handoff email
  } else if (markHeld) {
    if (!prepSheet.foodGift) { st.textContent = 'Add the food gift first — Email 1 quotes it.'; return; }
    if (!j.followUpAt) { st.textContent = 'Set the follow-up date first — Email 1 references it.'; return; }
    const ok = await hofConfirm(
      `Mark the consult held? This sends ${a.client?.name || 'the client'} the handoff email with the Going Deeper link and the food gift ("${prepSheet.foodGift}").`,
      'Consult held — send email'
    );
    if (!ok) return;
    j.consultHeldAt = new Date().toISOString();
  }

  st.textContent = 'Saving…';
  try {
    await setDoc(doc(db, 'assessments', id), {
      prepSheet,
      journey: j,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    st.textContent = markHeld === 'silent' ? 'Consult recorded — no email sent ✓'
      : (markHeld ? 'Saved — handoff email sending ✓' : 'Saved ✓');
    setTimeout(() => { if (st) st.textContent = ''; }, 2500);
  } catch (err) {
    console.error('prep save failed:', err);
    st.textContent = 'Save failed: ' + (err.message || err);
  }
}

function printPrepSheet(a) {
  const p = a.prepSheet || {};
  const j = a.journey || {};
  const w = window.open('', '_blank');
  if (!w) return;
  const leanRows = Object.values(a.tally || {}).map(t =>
    `<tr><td>${escape(t.label)}</td><td style="text-align:center;">${t.checked}</td><td>${t.flag ? 'flag' : (t.lean ? 'lean' : '—')}${t.selfId ? ' · self-ID' : ''}</td></tr>`
  ).join('');
  w.document.write(`<!doctype html><html><head><title>Consult Prep — ${escape(a.client?.name || '')}</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #2C2C2C; max-width: 680px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-family: Georgia, serif; color: #4A3728; font-size: 1.4rem; margin-bottom: 0.2rem; }
    .muted { font-size: 0.8125rem; color: #897866; }
    .box { background: #faf6ef; border: 1px solid #ece2cf; border-radius: 8px; padding: 10px 14px; margin: 10px 0; font-size: 0.9rem; line-height: 1.6; }
    .label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.06em; color: #6B7F5E; font-weight: 700; margin-top: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; margin-top: 6px; }
    td { padding: 3px 6px; border-bottom: 1px solid #f2ebdf; }
    .flags { color: #a84b42; }
  </style></head><body>
  <div class="muted">HOUSE OF FIGS · FREE CONSULTATION · INTERNAL USE</div>
  <h1>Consult Prep Sheet — ${escape(a.client?.name || 'Unnamed')}</h1>
  <div class="muted">${j.consultAt ? 'Consult: ' + escape(new Date(j.consultAt).toLocaleString()) : 'Consult: ____________'} · ${escape(a.client?.email || '')}</div>
  <div class="label">Chief complaint — in their words</div><div class="box">${escape(a.client?.chiefComplaint || '')}</div>
  <div class="label">What they hope to walk away with</div><div class="box">${escape(a.client?.hopes || a.client?.goals || '')}</div>
  <div class="label">Rainbow leans</div><table>${leanRows}</table>
  <div class="label">Loudest color (the one I will name)</div><div class="box">${escape(p.loudestColor || '')}</div>
  <div class="label">Second thread — noted, not named</div><div class="box">${escape(p.secondThread || '')}</div>
  <div class="label">The one food gift — written before the call</div><div class="box">${escape(p.foodGift || '')}</div>
  <div class="label">Safety flags — if any, care replaces the ask</div><div class="box flags">${(p.safetyFlags || []).map(escape).join('<br>') || 'None noted.'}</div>
  <div class="label">Notes from the call</div><div class="box" style="min-height:80px;">${escape(p.notes || '')}</div>
  <script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});<\/script>
  </body></html>`);
  w.document.close();
}

const PLAN_FIELD_DEFS = [
  { key: 'welcomeNote', label: 'Welcome note', rows: 5 },
  { key: 'pourDescription', label: 'Pour description', rows: 3 },
  { key: 'closingReframe', label: 'Closing reframe (Week Four)', rows: 4 }
];

function openAssessmentDetail(id) {
  const a = assessmentDocs.find(x => x.id === id);
  if (!a) return;
  const plan = planDocs[id];
  const status = assessmentStatus(a);

  let html = `<h2>Rooted Assessment — ${escape(a.client?.name || 'Unnamed')}</h2>`;
  html += `<div class="detail-meta">${statusChipHtml(status)} &middot; Intake ${formatTime(a.createdAt)}`;
  if (a.client?.email) html += ` &middot; ${escape(a.client.email)}`;
  html += ' &middot; <a href="#" id="aw-print" onclick="return false;">Print worksheet</a></div>';

  if (a.status === 'halted') {
    html += '<div class="halt-banner"><strong>Pipeline halted — nothing client-facing was generated.</strong>' +
      (a.haltReasons || []).map(r => `<div>• ${escape(r)}</div>`).join('') +
      '<div class="aw-muted" style="margin-top:6px;">The safety rule: the outcome is a referral or a conversation, never a restrictive plan. If your clinical judgment says it\'s safe to proceed (e.g. resolved at the consult), you can clear the hold below — the plan will draft for your review.</div>' +
      '<div style="margin-top:10px;"><button type="button" class="ghost-btn" id="clear-hold">Clear hold &amp; draft plan</button> <span class="lead-save-status" id="hold-status"></span></div></div>';
  }
  if (a.status === 'cleared') {
    html += '<div class="aw-client">Hold cleared — the plan is drafting now. It appears here in about a minute.</div>';
  }
  if (a.status === 'approved') {
    html += `<div class="aw-client" style="border-color:#c9d6c0;background:#f4f8f1;">✓ Assessment approved${a.approvedAt ? ' ' + formatTime(a.approvedAt) : ''} — <strong>ready for the follow-up meeting</strong>. Send the plan below during or after that conversation.</div>`;
  }

  html += `<div class="aw-client">
    <div><strong>Chief complaint:</strong> ${escape(a.client?.chiefComplaint || '—')}</div>
    <div><strong>Goals:</strong> ${escape(a.client?.goals || '—')}</div>
    <div><strong>Named fear:</strong> ${escape(a.client?.fears || '—')}</div>
  </div>`;

  html += prepSheetHtml(a);
  html += worksheetHtml(a);

  // Plan editor (only when not halted)
  if (a.status !== 'halted' && plan) {
    html += '<div class="aw-section aw-plan"><h3>Client plan draft (Tier 2 — approval required)</h3>';
    if (plan.draftError) {
      html += `<div class="halt-banner">Draft generation failed: ${escape(plan.draftError)}<br>
        <span class="aw-muted">Fix the issue (e.g. API key) and resubmit, or write the plan manually below.</span></div>`;
    }
    if ((plan.leakFindings || []).length) {
      html += `<div class="halt-banner">Two-audience leak check flagged: <strong>${plan.leakFindings.map(escape).join(', ')}</strong> — edit these out before approving.</div>`;
    }
    const d = plan.draft || {};
    html += '<div class="editor-form" id="plan-editor">';
    for (const f of PLAN_FIELD_DEFS) {
      html += `<label>${f.label}<textarea data-plan-field="${f.key}" rows="${f.rows}">${escape(d[f.key] || '')}</textarea></label>`;
    }
    (d.rainbowRead || []).forEach((r, i) => {
      html += `<label>Rainbow Read — ${escape(r.color)}
        <input type="text" data-plan-rr-heading="${i}" value="${escape(r.heading)}" style="margin-bottom:4px;">
        <textarea data-plan-rr-para="${i}" rows="3">${escape(r.paragraph)}</textarea></label>`;
    });
    (d.weeks || []).forEach((w, i) => {
      html += `<label>Week ${w.week} — emphasis &amp; tailoring
        <input type="text" data-plan-wk-emphasis="${i}" value="${escape(w.emphasis)}" style="margin-bottom:4px;">
        <textarea data-plan-wk-tailoring="${i}" rows="2">${escape(w.tailoring)}</textarea></label>`;
    });
    html += `<label>Small Harvests (one per line)<textarea data-plan-field="smallHarvests" rows="4">${escape((d.smallHarvests || []).join('\n'))}</textarea></label>`;
    html += `<label>Gentle notes (one per line)<textarea data-plan-field="gentleNotes" rows="4">${escape((d.gentleNotes || []).join('\n'))}</textarea></label>`;
    html += '</div>';

    html += `<div class="editor-actions" style="margin-top:1rem;">
      <div class="editor-actions-left"><span class="lead-save-status" id="plan-save-status"></span></div>
      <div class="editor-actions-right">
        <button type="button" class="ghost-btn" id="plan-save">Save draft</button>
        ${a.status !== 'approved' ? '<button type="button" class="primary-btn" id="assessment-approve">Approve assessment — ready for follow-up</button>' : ''}
        <button type="button" class="${a.status === 'approved' ? 'primary-btn' : 'ghost-btn'}" id="plan-approve">Send plan to client</button>
      </div>
    </div>
    <p class="aw-muted" style="margin-top:8px;">Approving the assessment marks ${escape(a.client?.preferredName || a.client?.name || 'this client')} as ready for their follow-up meeting — nothing is emailed. "Send plan" emails the 30-day plan to ${escape(plan.clientEmail || 'the client')}; use it during or after the meeting. The leak check runs once more at send time.</p>`;
    html += '</div>';
  }

  // Prescribe to Fig·atry — Bethany's "both spaces" prescribing surface.
  if (a.status !== 'halted' && a.client?.email) {
    html += `<div class="aw-section aw-plan"><h3>Prescribe to Fig·atry</h3>
      <p class="aw-muted" style="margin-bottom:0.75rem;">Sends straight to ${escape(a.client.email)}'s app. If they aren't connected yet, it waits for them with an invite code.</p>
      <div class="editor-form">
        <label>Type
          <select id="rx-kind">
            <option value="goal">Goal</option>
            <option value="meal">Meal</option>
            <option value="juice_recipe">Juice recipe</option>
          </select>
        </label>
        <label>Title
          <input type="text" id="rx-title" placeholder="e.g. Your daily Rainbow pour">
        </label>
        <label>Description (optional)
          <textarea id="rx-desc" rows="2" placeholder="A warm sentence about why / how…"></textarea>
        </label>
        <label>Ingredients (for meals & juice — one per line) / cadence (for goals)
          <textarea id="rx-extra" rows="3" placeholder="a generous handful of spinach&#10;cucumber&#10;fresh lemon — or for a goal: daily"></textarea>
        </label>
        <div class="editor-actions">
          <div class="editor-actions-left"><span class="lead-save-status" id="rx-status"></span></div>
          <div class="editor-actions-right">
            <button type="button" class="primary-btn" id="rx-send">Prescribe</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  modalBodyEl.innerHTML = html;
  modalEl.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const rxSend = document.getElementById('rx-send');
  if (rxSend) rxSend.addEventListener('click', async () => {
    const st = document.getElementById('rx-status');
    const kind = document.getElementById('rx-kind').value;
    const title = document.getElementById('rx-title').value.trim();
    const description = document.getElementById('rx-desc').value.trim();
    const extra = document.getElementById('rx-extra').value.trim();
    if (!title) { st.textContent = 'Add a title.'; return; }
    rxSend.disabled = true;
    st.textContent = 'Sending…';
    try {
      const call = httpsCallable(getFunctions(app, 'us-central1'), 'prescribeToApp');
      const payload = { email: a.client.email, kind, title, description };
      if (kind === 'goal') payload.cadence = extra;
      else payload.ingredients = extra.split('\n').map(s => s.trim()).filter(Boolean);
      const { data } = await call(payload);
      st.textContent = data.status === 'delivered'
        ? 'Delivered to their app ✓'
        : data.status === 'pended'
          ? `Waiting for them — invite code ${data.inviteCode || '(sent previously)'}`
          : 'Saved — delivers once the coach account exists.';
      document.getElementById('rx-title').value = '';
      document.getElementById('rx-desc').value = '';
      document.getElementById('rx-extra').value = '';
    } catch (err) {
      console.error('prescribe failed:', err);
      st.textContent = 'Failed: ' + (err.message || err);
    } finally {
      rxSend.disabled = false;
    }
  });

  const saveBtn = document.getElementById('plan-save');
  const approveBtn = document.getElementById('plan-approve');
  if (saveBtn) saveBtn.addEventListener('click', () => savePlanDraft(id, false));
  if (approveBtn) approveBtn.addEventListener('click', () => savePlanDraft(id, true));
  const printBtn = document.getElementById('aw-print');
  if (printBtn) printBtn.addEventListener('click', () => printWorksheet(a));

  const prepSave = document.getElementById('prep-save');
  const prepPrint = document.getElementById('prep-print');
  const consultHeldBtn = document.getElementById('consult-held');
  if (prepSave) prepSave.addEventListener('click', () => savePrepSheet(id, false));
  if (prepPrint) prepPrint.addEventListener('click', () => printPrepSheet(a));
  if (consultHeldBtn) consultHeldBtn.addEventListener('click', () => savePrepSheet(id, true));
  const consultSilentBtn = document.getElementById('consult-held-silent');
  if (consultSilentBtn) consultSilentBtn.addEventListener('click', () => savePrepSheet(id, 'silent'));

  const clearHoldBtn = document.getElementById('clear-hold');
  if (clearHoldBtn) clearHoldBtn.addEventListener('click', async () => {
    if (!(await hofConfirm('Clear this safety hold? Only do this if your clinical judgment says it\'s safe to proceed. The plan will draft for your review — nothing is sent to the client.', 'Clear hold'))) return;
    const st = document.getElementById('hold-status');
    st.textContent = 'Clearing…';
    try {
      await setDoc(doc(db, 'assessments', id), { status: 'cleared', updatedAt: new Date().toISOString() }, { merge: true });
      st.textContent = 'Cleared — drafting the plan now (about a minute).';
    } catch (err) {
      console.error('clear hold failed:', err);
      st.textContent = 'Failed: ' + (err.message || err);
    }
  });

  const assessApproveBtn = document.getElementById('assessment-approve');
  if (assessApproveBtn) assessApproveBtn.addEventListener('click', async () => {
    const st = document.getElementById('plan-save-status');
    st.textContent = 'Approving…';
    try {
      await setDoc(doc(db, 'assessments', id), {
        status: 'approved',
        approvedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      st.textContent = 'Approved — ready for the follow-up meeting ✓';
      setTimeout(() => { if (st) st.textContent = ''; }, 2500);
    } catch (err) {
      console.error('assessment approve failed:', err);
      st.textContent = 'Failed: ' + (err.message || err);
    }
  });
}

// Print the practitioner worksheet (internal clinical file) — same pattern
// as the existing quiz/intake print views: new tab + auto print dialog.
function printWorksheet(a) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Rooted Assessment — ${escape(a.client?.name || '')}</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #2C2C2C; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
    .conf { font-size: 0.6875rem; letter-spacing: 0.06em; text-transform: uppercase; color: #a84b42; margin-bottom: 0.5rem; }
    h1 { font-family: Georgia, serif; color: #4A3728; font-size: 1.5rem; margin: 0 0 0.25rem; }
    h3 { font-family: Georgia, serif; color: #4A3728; border-bottom: 1px solid #ece2cf; padding-bottom: 4px; }
    .aw-item { font-size: 0.875rem; line-height: 1.55; margin-bottom: 6px; }
    .aw-muted { font-size: 0.8125rem; color: #897866; }
    .aw-evidence { font-size: 0.75rem; color: #a29483; }
    .aw-client { background: #f5f0ea; border-radius: 8px; padding: 12px 14px; font-size: 0.875rem; line-height: 1.6; margin: 12px 0; }
    .aw-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
    .aw-table th { text-align: left; font-size: 0.6875rem; text-transform: uppercase; color: #6B7F5E; padding: 4px 6px; border-bottom: 1px solid #ece2cf; }
    .aw-table td { padding: 4px 6px; border-bottom: 1px solid #f2ebdf; }
    .halt-banner { background: #faf0ee; border: 1px solid #e5c4bd; border-radius: 8px; padding: 10px 12px; font-size: 0.875rem; color: #7c3a32; margin: 12px 0; }
  </style></head><body>
  <div class="conf">House of Figs · Confidential clinical file — internal use only</div>
  <h1>Per-Client Assessment Worksheet</h1>
  <div class="aw-muted">${escape(a.client?.name || 'Unnamed')}${a.client?.age ? ' · ' + escape(a.client.age) : ''}${a.client?.location ? ' · ' + escape(a.client.location) : ''} · Intake ${escape(a.createdAt || '')}</div>
  ${a.status === 'halted' ? '<div class="halt-banner"><strong>HALTED:</strong> ' + (a.haltReasons || []).map(escape).join(' · ') + '</div>' : ''}
  <div class="aw-client">
    <div><strong>Chief complaint:</strong> ${escape(a.client?.chiefComplaint || '—')}</div>
    <div><strong>Goals:</strong> ${escape(a.client?.goals || '—')}</div>
    <div><strong>Named fear:</strong> ${escape(a.client?.fears || '—')}</div>
  </div>
  ${worksheetHtml(a)}
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });<\/script>
  </body></html>`);
  w.document.close();
}

function collectPlanDraft(existing) {
  const d = JSON.parse(JSON.stringify(existing.draft || {}));
  document.querySelectorAll('[data-plan-field]').forEach(el => {
    const key = el.dataset.planField;
    if (key === 'smallHarvests' || key === 'gentleNotes') {
      d[key] = el.value.split('\n').map(s => s.trim()).filter(Boolean);
    } else {
      d[key] = el.value.trim();
    }
  });
  document.querySelectorAll('[data-plan-rr-heading]').forEach(el => {
    const i = +el.dataset.planRrHeading;
    if (d.rainbowRead && d.rainbowRead[i]) d.rainbowRead[i].heading = el.value.trim();
  });
  document.querySelectorAll('[data-plan-rr-para]').forEach(el => {
    const i = +el.dataset.planRrPara;
    if (d.rainbowRead && d.rainbowRead[i]) d.rainbowRead[i].paragraph = el.value.trim();
  });
  document.querySelectorAll('[data-plan-wk-emphasis]').forEach(el => {
    const i = +el.dataset.planWkEmphasis;
    if (d.weeks && d.weeks[i]) d.weeks[i].emphasis = el.value.trim();
  });
  document.querySelectorAll('[data-plan-wk-tailoring]').forEach(el => {
    const i = +el.dataset.planWkTailoring;
    if (d.weeks && d.weeks[i]) d.weeks[i].tailoring = el.value.trim();
  });
  return d;
}

// ===================================================================
// Client journey funnel (Overview tab)
// Each person appears once, at the FURTHEST stage they've reached.
// Click a stage card to see exactly who is in it; click a person to
// open their full detail.
// ===================================================================
const FUNNEL_STAGES = [
  { key: 'quiz', label: 'New leads', hint: 'Quiz taken or info requested — no intake yet' },
  { key: 'prep', label: 'Consult prep', hint: 'Intake in — review prep sheet before the free consult' },
  { key: 'awaitingGd', label: 'Awaiting Going Deeper', hint: 'Consult held — companion form not back yet' },
  { key: 'review', label: 'In review', hint: 'Full picture in — assessment awaiting approval' },
  { key: 'ready', label: 'Ready for follow-up', hint: 'Assessment approved — follow-up meeting next' },
  { key: 'coaching', label: 'Coaching', hint: 'Plan sent — inside the 30 days' },
  { key: 'lookback', label: 'Day-30 look-back', hint: 'Past day 30 — renew, deepen, or refer' },
  { key: 'halted', label: 'Safety hold', hint: 'Halted — needs Bethany before anything proceeds' }
];

function emailOf(d) {
  return String(d.email || d.Email || '').toLowerCase().trim();
}

function computeFunnel() {
  const stages = { quiz: [], prep: [], awaitingGd: [], review: [], ready: [], coaching: [], lookback: [], halted: [] };
  const intakeEmails = new Set(intakeDocs.map(emailOf).filter(Boolean));
  const bookedEmails = new Set(
    bookingDocs.filter(b => b.status === 'booked').map(b => String(b.email || '').toLowerCase().trim())
  );

  // Quiz leads who haven't submitted an intake yet (dedupe by email).
  const seenQuiz = new Set();
  for (const q of quizDocs) {
    const em = emailOf(q);
    if (!em || intakeEmails.has(em) || seenQuiz.has(em)) continue;
    seenQuiz.add(em);
    stages.quiz.push({
      name: (q.name || em) + (bookedEmails.has(em) ? ' · booked' : '') + (q.dormantAt ? ' · dormant' : ''),
      email: em, when: q.emailCapturedAt || q.createdAt,
      open: () => openDetail('quiz', q.id)
    });
  }

  // RMI leads (Entry B) who haven't taken the quiz or submitted an intake.
  for (const r of rmiDocs) {
    const em = emailOf(r);
    if (!em || intakeEmails.has(em) || seenQuiz.has(em)) continue;
    seenQuiz.add(em);
    stages.quiz.push({
      name: (r.name || em) + ' (RMI)' + (r.dormantAt ? ' · dormant' : ''),
      email: em, when: r.createdAt,
      open: () => openRmiDetail(r)
    });
  }

  // Intakes, bucketed by their assessment/plan state.
  for (const i of intakeDocs) {
    const a = assessmentDocs.find(x => x.id === i.id);
    const plan = planDocs[i.id];
    const person = {
      name: i['Full name'] || i['full-name'] || emailOf(i) || 'Unnamed',
      email: emailOf(i),
      when: i.createdAt,
      open: a ? () => openAssessmentDetail(i.id) : () => openDetail('intake', i.id)
    };
    const j = (a && a.journey) || {};
    if (a && a.status === 'halted') {
      stages.halted.push(person);
    } else if (plan && plan.status === 'sent') {
      const days = (Date.now() - Date.parse(plan.sentAt || plan.updatedAt || '')) / 86400000;
      (days > 30 ? stages.lookback : stages.coaching).push(person);
    } else if (a && a.status === 'approved') {
      stages.ready.push(person);
    } else if (j.gdReturnedAt) {
      stages.review.push(person);
    } else if (j.consultHeldAt) {
      stages.awaitingGd.push(person);
    } else {
      stages.prep.push(person);
    }
  }
  return stages;
}

function openRmiDetail(r) {
  let html = `<h2>Message — ${escape(r.name || r.email || 'Unnamed')}</h2>
    <div class="detail-meta">Received ${formatTime(r.createdAt)}${r.email ? ' &middot; ' + escape(r.email) : ''}</div>
    <div class="aw-client" style="margin-top:1rem;">${escape(r.message || '(no message)')}</div>
    <div class="aw-muted" style="margin-top:0.75rem;">
      ${r.r1SentAt ? 'Quiz invitation sent ' + formatTime(r.r1SentAt) : 'Quiz invitation pending'}
      ${r.rmiNudgeSentAt ? ' &middot; Nudge sent ' + formatTime(r.rmiNudgeSentAt) : ''}
      ${r.dormantAt ? ' &middot; Dormant since ' + formatTime(r.dormantAt) : ''}
    </div>
    <p class="aw-muted" style="margin-top:0.75rem;">RMI leads are routed to the quiz first — reply personally to their message from bethany@houseoffigs.org.</p>`;
  modalBodyEl.innerHTML = html;
  modalEl.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderFunnel() {
  const el = document.getElementById('funnel');
  if (!el) return;
  const stages = computeFunnel();
  el.innerHTML = FUNNEL_STAGES.map((s, idx) => `
    <button type="button" class="funnel-card${s.key === 'halted' && stages.halted.length ? ' funnel-card--alert' : ''}" data-stage="${s.key}">
      <div class="funnel-count">${stages[s.key].length}</div>
      <div class="funnel-label">${s.label}</div>
      <div class="funnel-hint">${s.hint}</div>
      ${idx < 6 ? '<span class="funnel-arrow" aria-hidden="true">&rarr;</span>' : ''}
    </button>`).join('');
  el.querySelectorAll('.funnel-card').forEach(card =>
    card.addEventListener('click', () => openFunnelStage(card.dataset.stage))
  );
}

function openFunnelStage(key) {
  const stage = FUNNEL_STAGES.find(s => s.key === key);
  const people = computeFunnel()[key] || [];
  let html = `<h2>${escape(stage.label)}</h2>
    <div class="detail-meta">${people.length} ${people.length === 1 ? 'person' : 'people'} &middot; ${escape(stage.hint)}</div>`;
  if (!people.length) {
    html += '<p class="empty">No one in this stage right now.</p>';
  } else {
    html += '<div class="data-list" style="margin-top:0.75rem;">' + people
      .sort((a, b) => (b.when || '').localeCompare(a.when || ''))
      .map((p, i) => `
        <div class="data-row funnel-person" data-idx="${i}">
          <div class="row-main">
            <div class="row-title">${escape(p.name)}</div>
            <div class="row-sub">${escape(p.email || '')}</div>
          </div>
          <div class="row-time">${formatTime(p.when)}</div>
        </div>`).join('') + '</div>';
  }
  modalBodyEl.innerHTML = html;
  modalEl.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const sorted = people.sort((a, b) => (b.when || '').localeCompare(a.when || ''));
  modalBodyEl.querySelectorAll('.funnel-person').forEach(row =>
    row.addEventListener('click', () => sorted[+row.dataset.idx].open())
  );
}

async function savePlanDraft(id, approve) {
  const plan = planDocs[id];
  if (!plan) return;
  const statusEl = document.getElementById('plan-save-status');
  const draft = collectPlanDraft(plan);

  // Client-side leak check (the function re-checks at send).
  const allText = [
    draft.welcomeNote, draft.pourDescription, draft.closingReframe,
    ...(draft.rainbowRead || []).map(r => r.heading + ' ' + r.paragraph),
    ...(draft.weeks || []).map(w => w.emphasis + ' ' + w.tailoring),
    ...(draft.smallHarvests || []),
    ...(draft.gentleNotes || [])
  ].filter(Boolean).join('\n');
  const leaks = clientLeakCheck(allText);

  if (approve && leaks.length) {
    statusEl.textContent = 'Blocked — clinical terms present: ' + leaks.join(', ');
    return;
  }
  if (approve && !(await hofConfirm(`Send this plan to ${plan.clientEmail}? This emails the client their 30-day plan.`, 'Send plan'))) return;

  statusEl.textContent = approve ? 'Approving…' : 'Saving…';
  try {
    await setDoc(doc(db, 'plans', id), {
      draft,
      leakFindings: leaks,
      status: approve ? 'approved' : (leaks.length ? 'leak_blocked' : 'draft'),
      updatedAt: new Date().toISOString()
    }, { merge: true });
    statusEl.textContent = approve ? 'Approved — sending to client ✓' : 'Saved ✓';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
  } catch (err) {
    console.error('plan save failed:', err);
    statusEl.textContent = 'Save failed: ' + (err.message || err);
  }
}
