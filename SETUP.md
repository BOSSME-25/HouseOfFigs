# House of Figs — internal forms & admin setup

This document walks you through wiring the site up to your own Firebase
project so all form submissions live in Firestore and the admin dashboard at
`/admin` shows them.

Once this is done, the only external services the site uses are Google
(Firebase, Identity, Analytics, Fonts) and Vercel (hosting + serverless
functions).

You'll do this once. Should take about 20 minutes.

---

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com and sign in as
   **bethany@houseoffigs.org**.
2. Click **Add project**.
3. Project name: `house-of-figs` (or `houseoffigs` — anything you like).
4. Disable Google Analytics inside Firebase (you already have GA4 set up
   on the site, no need to duplicate). Click **Create**.

## 2. Enable Firestore

1. Inside the project, go to **Build → Firestore Database**.
2. Click **Create database**.
3. Start in **production mode** (we'll paste real security rules next).
4. Choose a location close to you — `nam5 (us-central)` is a fine default.
5. Click **Create**.

## 3. Paste the security rules

1. Still in Firestore Database, click the **Rules** tab.
2. Replace the entire file with the contents of `firestore.rules` from this
   project (sitting next to this file). Then click **Publish**.

These rules say:
- Only `bethany@houseoffigs.org` and `emily@houseoffigs.org` (signed in via
  Google) can read submissions.
- Nobody can write from the client. All writes go through our Vercel
  Functions using a service account.

## 4. Enable Google Sign-In for the admin dashboard

1. Go to **Build → Authentication**.
2. Click **Get started**.
3. Under **Sign-in method**, click **Google** → **Enable**.
4. Set the support email to `bethany@houseoffigs.org` and click **Save**.

## 5. Register the web app (for the admin dashboard frontend)

1. Go to **Project settings** (gear icon, top left) → **General** tab.
2. Scroll down to **Your apps**, click the `</>` (web) icon.
3. App nickname: `Admin Dashboard`. Do **not** check "Firebase Hosting".
4. Click **Register app**.
5. You'll see a `firebaseConfig` object with values like:
   ```js
   {
     apiKey: "AIza…",
     authDomain: "house-of-figs.firebaseapp.com",
     projectId: "house-of-figs",
     storageBucket: "house-of-figs.appspot.com",
     messagingSenderId: "123…",
     appId: "1:123…:web:abc…"
   }
   ```
6. **Send those six values to me** and I'll paste them into
   `admin/admin.js`. (These values are public — they appear in every
   Firebase web app and are safe to commit.)

## 6. Create the service account (for the Vercel Functions backend)

1. In Project settings, click the **Service accounts** tab.
2. Click **Generate new private key** → **Generate key**.
3. A JSON file downloads. **Open it in a text editor** and copy the
   entire contents (it's one big JSON object).

## 7. Add the service account JSON to Vercel as an env var

1. Go to https://vercel.com/oeprojects/house-of-figs/settings/environment-variables
2. Click **Add new**.
3. **Key**: `FIREBASE_ADMIN_KEY`
4. **Value**: paste the entire JSON object you copied in step 6.
5. **Environments**: check all three (Production, Preview, Development).
6. Click **Save**.

## 8. Authorize the admin domain for sign-in

1. Back in Firebase Console → **Authentication** → **Settings** tab →
   **Authorized domains**.
2. Make sure these are in the list (add any that are missing):
   - `localhost`
   - `houseoffigs.org`
   - `www.houseoffigs.org`

## 9. Redeploy

After steps 5–8 are done and you've sent me the firebaseConfig values,
I'll paste them in and push a new deploy. After that:

- **Quiz** → results POST to `/api/submit-quiz`, show up in dashboard live.
- **Intake form** → POSTs to `/api/submit-intake`, shows up in dashboard live.
- **Admin dashboard** at https://houseoffigs.org/admin → sign in with
  bethany@ or emily@ and watch submissions roll in real time.

---

## What this replaces

| Was using | Now uses |
| --- | --- |
| Formspree (intake form) | Vercel Function → Firestore |
| MailerLite (quiz email gate) | Same — Vercel Function → Firestore |
| (Nothing — quiz answers weren't captured before) | Firestore |

Phase 2 — coming next — will do the same for:
- The contact form (currently MailerLite)
- The newsletter signup (currently MailerLite)

## What stays the same

- **Calendly** for consultation booking (you asked to keep it).
- **Google Analytics** for traffic tracking.
- **Google Fonts** for typography.

---

## Files to know about

- `firestore.rules` — security rules. Paste into Firebase Console.
- `api/submit-quiz.mjs` — backend handler for quiz submissions.
- `api/submit-intake.mjs` — backend handler for intake submissions.
- `lib/firebase-admin.mjs` — Firebase Admin SDK init (reads
  `FIREBASE_ADMIN_KEY` env var).
- `admin/index.html` + `admin/admin.js` + `admin/admin.css` — dashboard.
- `package.json` — declares the `firebase-admin` dependency.

## Troubleshooting

**"FIREBASE_ADMIN_KEY env var is not set"** — Step 7 wasn't completed, or
the deploy hasn't run since the env var was added. Trigger a redeploy.

**"Not authorized"** when signing in — your email isn't in `ALLOWED_EMAILS`
in `admin/admin.js`. Edit that array and redeploy.

**Sign-in popup closes immediately** — usually a browser blocker. Try a
fresh incognito window.

**Missing `index` error in Firestore** — the dashboard orders by
`createdAt`. Firestore should auto-create that index on first query. If it
asks, just click the suggested link in the error.
