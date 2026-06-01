# House of Figs — email notifications setup

This guide gets Bethany an email every time someone:
- Finishes the **quiz** with their name + email (a captured lead)
- Submits the **intake form**

Emails come from `bethany@houseoffigs.org` via Gmail SMTP and go to both
`bethany@houseoffigs.org` and `emily@houseoffigs.org`.

The whole pipeline stays inside Google: Firestore writes trigger Firebase
Cloud Functions, which send via Gmail.

You'll do this once. About 15 minutes.

---

## What's already in the repo

- `firebase.json` — Firebase project config
- `functions/index.js` — the two Cloud Functions
- `functions/package.json` — declares dependencies

Nothing else to write. Just deploy.

---

## Setup steps

### 1. Upgrade the Firebase project to Blaze (pay-as-you-go)

Cloud Functions require the Blaze plan, but the **free tier** covers ~2M
function invocations and 5GB of egress per month — for the volume this
site will see, the bill will be **$0**.

1. Open https://console.firebase.google.com/project/houseoffigs-16f71/usage/details
2. Click **Modify plan** → choose **Blaze**
3. Add a billing card (required; won't be charged for normal use)
4. Optional but recommended: set a **budget alert** at $5/month so you're
   notified if usage ever spikes:
   https://console.cloud.google.com/billing/budgets

### 2. Create a Gmail App Password for bethany@houseoffigs.org

App Passwords let Cloud Functions send mail through Bethany's Workspace
account without exposing her real password.

1. Sign in to https://myaccount.google.com as **bethany@houseoffigs.org**
2. **Security** → confirm **2-Step Verification** is on (required)
3. Visit https://myaccount.google.com/apppasswords
4. App name: `House of Figs notifications`
5. Click **Create** — you'll get a 16-character password (something like
   `abcd efgh ijkl mnop`). **Copy it now — Google only shows it once.**

**If App Passwords are blocked:** Your Workspace admin policy is
restricting them. As Workspace super-admin, Bethany can allow them at
https://admin.google.com → Security → Less secure apps and your account →
or specifically enable 2SV + App Passwords for her org.

### 3. Install the Firebase CLI locally

Run on the same machine where the repo lives:

```sh
npm install -g firebase-tools
firebase login
```

The login uses your browser. Sign in as `bethany@houseoffigs.org`.

### 4. Install function dependencies

```sh
cd functions
npm install
cd ..
```

### 5. Store the App Password as a secret

Paste the App Password from step 2 when prompted:

```sh
firebase functions:secrets:set GMAIL_APP_PASSWORD --project houseoffigs-16f71
```

The secret is encrypted by Google Secret Manager; nobody (including us)
can read it back from code.

### 6. Deploy

```sh
firebase deploy --only functions --project houseoffigs-16f71
```

First deploy takes 1–3 minutes (Google has to provision two functions
plus the secret access). Look for **✔ Deploy complete!** at the end.

### 7. Test

- Open https://houseoffigs.org/intake.html in a private window
- Fill in the bare minimum required fields and submit
- Within ~30 seconds, both `bethany@` and `emily@` should receive
  **"New intake — [Your name]"** in the inbox

Same flow for the quiz:
- Take the quiz, complete the email gate with a real address
- Check inbox for **"New quiz lead — [Your name]"**

---

## What the emails look like

Brand-styled HTML with the House of Figs header gradient and warm
typography. Each email shows:

**Intake notification:**
- Name (+ preferred name if different)
- Email, phone
- Main reason for reaching out
- Top health goals
- How they found House of Figs
- A button: **Review intake in dashboard** → links to `/admin`

**Quiz lead notification:**
- Name + email
- Profile result (e.g., "The Rebuilder — Your body is asking for restoration")
- A button: **View quiz response in dashboard**

Reply-To is set to the submitter's email, so hitting Reply in Gmail
opens a fresh email straight to them.

---

## Maintenance

- **Change who gets notified** — edit `NOTIFY_TO` at the top of
  `functions/index.js` and re-deploy.
- **Change the From address or wording** — edit `functions/index.js`,
  then `firebase deploy --only functions`.
- **Rotate the App Password** — run
  `firebase functions:secrets:set GMAIL_APP_PASSWORD` again with a new
  value, then redeploy.

## Troubleshooting

**"Permission denied" deploying** — `firebase login` first, with bethany@.

**"Billing required"** — step 1 (Blaze plan) wasn't completed.

**Functions deploy but no emails arrive** — check the Functions log at
https://console.firebase.google.com/project/houseoffigs-16f71/functions/logs
Look for nodemailer errors. Most common: the App Password got pasted
with spaces or was revoked. Re-run step 5.

**Email goes to spam** — first emails sometimes do. Mark "Not spam" once
and they'll stay in the inbox after that.

**Need to disable notifications temporarily** — delete the functions:
`firebase functions:delete onIntakeCreated onQuizEmailCaptured`
You can redeploy later.
