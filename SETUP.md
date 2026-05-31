# House of Figs — internal forms & admin setup

This document walks you through wiring the site up to your own Firebase
project so all form submissions live in Firestore and the admin dashboard at
`/admin` shows them in real time.

Once this is done, the only external services the site uses are Google
(Firebase, Identity, Analytics, Fonts) and Vercel (hosting).

You'll do this once. Should take about 10 minutes — most steps are already done.

---

## Architecture

```
  Public site (quiz, intake)  →  Firestore (writes only, strict rules)
                                        ↑ reads
  Admin dashboard at /admin   →  Firestore  (Google sign-in, allow-list)
```

No backend servers. No service account JSON keys. The Firestore security
rules are the gate. The browser writes directly; admins read directly.

---

## ✅ Already done

- Firebase project `houseoffigs-16f71` created
- Firestore enabled
- Web app registered, `firebaseConfig` pasted into the code

## What's left for you

### 1. Paste the Firestore security rules

1. Open https://console.firebase.google.com/project/houseoffigs-16f71/firestore/rules
2. Replace the entire file with the contents of `firestore.rules` in this repo
3. Click **Publish**

These rules enforce:
- Anyone can submit a quiz or intake form (validated per-field).
- Nobody can read or modify those submissions from the browser.
- Only `bethany@houseoffigs.org` and `emily@houseoffigs.org` (signed in via
  Google) can read submissions through the admin dashboard.

### 2. Enable Google Sign-In (for the admin dashboard)

1. Open https://console.firebase.google.com/project/houseoffigs-16f71/authentication/providers
2. Click **Get started** (if you haven't already)
3. Under **Sign-in method**, click **Google** → toggle **Enable**
4. Support email: `bethany@houseoffigs.org`
5. Click **Save**

### 3. Add authorized domains for sign-in

1. Open https://console.firebase.google.com/project/houseoffigs-16f71/authentication/settings
2. Scroll to **Authorized domains** and make sure these are in the list (add
   any that are missing):
   - `localhost`
   - `houseoffigs.org`
   - `www.houseoffigs.org`

---

## That's it.

After steps 1–3 are done:

- Take the quiz on https://houseoffigs.org/quiz.html — the result appears
  in the admin dashboard within seconds.
- Submit the intake form — same thing.
- Sign in at https://houseoffigs.org/admin with bethany@ or emily@ and
  watch submissions roll in real time.

---

## What this replaces

| Was using | Now uses |
| --- | --- |
| Formspree (intake form) | Firestore (direct write from browser) |
| MailerLite (quiz email gate) | Firestore (direct write from browser) |
| (Nothing — quiz answers weren't captured before) | Firestore |

Phase 2 — when you're ready — will do the same for:
- The contact form (currently MailerLite)
- The newsletter signup (currently MailerLite)

## What stays the same

- **Calendly** for consultation booking (you asked to keep it).
- **Google Analytics** for traffic tracking.
- **Google Fonts** for typography.

---

## Files to know about

- `firestore.rules` — security rules. Paste into Firebase Console.
- `js/firebase-public.mjs` — small loader that initializes Firebase on the
  public site and exposes `window.hofFirebase` for the form-submission code.
- `admin/index.html` + `admin/admin.js` + `admin/admin.css` — dashboard.
- `admin/admin.js` — contains the allow-list of admin emails. Edit this if
  you ever need to add or remove an admin.

## Troubleshooting

**"Not authorized"** when signing in — your email isn't in `ALLOWED_EMAILS`
in `admin/admin.js`. Edit that array and redeploy.

**Sign-in popup closes immediately** — usually a browser blocker. Try a
fresh incognito window.

**Quiz/intake submission silently fails** — open the browser console.
Most likely either the Firestore rules haven't been published yet, or the
domain isn't in the Authorized domains list (step 3).

**"Missing index" warning in Firestore** — the dashboard orders by
`createdAt`. Firestore should auto-create that index on first query. If it
asks, just click the suggested link in the error and click **Create**.
