# Fig·atry — sync consent copy

Reference copy for **A8** in the Fig·atry Paid Tiers addendum: *"Publish a
privacy policy and add a consent step before Health records or ethnic
background sync off the device."*

This is app-side UI copy for whoever builds the Fig·atry screens — it
doesn't live in this repo's code, since Fig·atry is a separate
application. Saved here so it isn't lost between the addendum and
whoever picks up the build.

Both consent moments share the same shape: a one-time modal, shown the
first time the toggle is turned on, that says plainly what leaves the
device, why, and that it's reversible. Neither should ever be pre-checked
or bundled into onboarding as a blanket "accept all."

---

## 1. Health records sync (Apple Health)

**Trigger:** the client turns on Health sync in Profile / Settings, before
any data leaves the device.

**Modal title:** Share your Health data?

**Modal body:**
> Turning this on syncs your Apple Health data — things like sleep, steps,
> and heart rate — to your secure Fig·atry account. It's included in your
> Month in Review, and if you're on a Coached plan, Bethany can see it
> too, alongside everything else you share.
>
> You're in control of this the whole way: turn it off any time from
> Settings, and you can ask to have past synced data deleted for good.

**Buttons:** `Not now` (secondary) &nbsp;·&nbsp; `Turn on syncing` (primary)

**Persistent settings note**, shown next to the toggle at all times (not
just first-time):
> Off by default. Only turns on with your say-so, right here.

---

## 2. Ethnic / ancestry background

**Trigger:** the client is asked (optionally, never required) for
ancestry/ethnic background — in onboarding or Profile — before that
field is saved.

**Modal title:** Share your ancestry background?

**Modal body:**
> This is entirely optional. Some lab ranges and nutrition guidance
> differ meaningfully by ancestry, so sharing this — if you're
> comfortable — helps Bethany read your results more accurately instead
> of applying a one-size-fits-all range.
>
> It's used only for your own care, seen only by Bethany, and never
> shown anywhere else in the app. You can remove it at any time.

**Buttons:** `Skip this` (secondary) &nbsp;·&nbsp; `Share my background` (primary)

**Field-level note**, shown beside the input itself:
> Optional — helps Bethany interpret your results more precisely.

---

## Shared rules for both

- **Opt-in, not opt-out.** Sync stays off and the field stays blank until
  the client actively chooses otherwise — never pre-checked, never bundled
  into a broader "I agree" during onboarding.
- **Reversible, and said so out loud.** Every modal states plainly that
  the choice can be undone later.
- **No dead-ending.** "Not now" / "Skip this" must fully dismiss the
  modal with no nagging re-prompt beyond the normal Settings toggle being
  there whenever the client's ready.
- **Link out, don't restate.** Each modal should link to the full
  [Privacy Policy](https://houseoffigs.org/privacy-policy.html) for
  anyone who wants the complete picture, rather than repeating it inline.
