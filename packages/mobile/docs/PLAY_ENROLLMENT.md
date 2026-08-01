# Play Console enrollment: the operator walkthrough

**Item:**  S0. **Written:** 2026-08-01, when the D-U-N-S number landed.

**DONE 2026-08-01: the Play developer account exists.** Created under
`dankestllc@gmail.com`, an account dedicated to the LLC, with organization
`Dankest, LLC` and the D-U-N-S. Identity verification is with Google.

**Operator decision taken at signup, and it is the right shape:** the contact
email and website are ORG-level (`info@dankest.llc`, `https://dankest.llc`),
not XChain-specific, because the account is a publisher that will carry more
than one app. Per-app support routing does not need this field: each app's
Store listing has its own contact details, so a future app can point somewhere
else without touching the account.

Everything here is operator work: it needs your identity, your card, and your
hardware key. Nothing in this file needs to come back to the repo, and
**nothing in it should be pasted into a chat**: not the D-U-N-S, not the
account address, not a recovery code.

Field labels move around as Google revises the console. The **values** below
are what matters; if a label reads slightly differently, match it by meaning.

---

## Step 0: decide which Google account this is (D7)

**Do this before anything else, because the account you sign up with becomes
K8 and cannot be swapped later.**

The recommendation on record is a **new, org-controlled Google account used
only for Play**, separate from the Chrome Web Store identity:

- one account compromise or loss then orphans one store, not two;
- the Play account is the highest-stakes credential in the whole release
  surface. An attacker inside it can reset the upload key and ship a
  malicious update to every install (§4, the K8 row).

Not a personal Gmail. Something like `play@` or `store-play@` on the org
domain, owned by the LLC.

**What was actually done:** `dankestllc@gmail.com`, dedicated to the LLC. That
satisfies the point of the rule, which is that the account is not tied to one
person's personal identity. The one durability difference worth writing into the
K8 custody row: a `gmail.com` account has no administrator above it, so recovery
is entirely Google support, whereas a Workspace account on `dankest.llc` (the
domain already runs Workspace) could be reset by an org admin. Not worth redoing
a completed signup over, but it makes the two hardware keys and the backup codes
the ONLY recovery path that is under our control, which raises the stakes on
Step 1 rather than lowering them.

## Step 1: harden that account BEFORE it has anything to lose

1. https://myaccount.google.com/security → 2-Step Verification → **Passkeys
   and security keys**.
2. Register **two** hardware keys: one you carry, one that stays somewhere
   safe. Two, because a single key is a single point of failure and Google's
   recovery path for an org account is slow.
3. Turn OFF SMS and Authenticator-app fallback once the keys work. A phone
   number left on the account is a SIM-swap path around the key.
4. Generate backup codes. They go into the K8 custody slot per rails §4
   (LastPass note, same pattern as the backup runbook Part A).
5. Optional but recommended: enrol the account in
   https://landing.google.com/advancedprotection/, which hard-blocks the
   phishing flows that took out other extension and app publishers.

## Step 2: create the developer account

**URL:** https://play.google.com/console/signup
**Cost:** $25, one time, non-refundable.

| Field | What to enter |
|---|---|
| Account type | **Organization** (not Individual, and it cannot be changed later) |
| Legal name / organization name | `Dankest, LLC`, exactly as registered, matching the D-U-N-S record |
| D-U-N-S number | the number you obtained (no dashes if it rejects them) |
| Organization address | the LLC's registered address, matching the D-U-N-S record |
| Organization phone | a number you can answer; Google may call or SMS it to verify |
| Organization email | the org-controlled address for this account |
| Developer name (PUBLIC) | `Dankest, LLC`. This is what appears under the app name on the store, and it must match the trader declaration |
| Contact email (PUBLIC) | `info@dankest.llc` |
| Website | `https://dankest.llc` |
| App category (asked later) | Finance |

**The name and address must match the D-U-N-S record character for
character.** Mismatches there are the single most common cause of a stalled
verification, and each round trip costs days.

## Step 3: identity verification

Google verifies the organization against the D-U-N-S record, and separately
verifies **you** as the person creating it. Expect to upload a government ID
and possibly a document showing the organization address. Budget days, not
hours, and note that nothing about this blocks the engineering work: all
four build stages are already done.

## Step 4: after approval, before the first upload

1. **Convert to a group publisher if the console offers it**, or add a second
   org identity as an admin. One login losing access should not orphan the
   listing. Record the members in the K8 custody row.
2. Complete the **trader declaration** (EU DSA): trader, `Dankest, LLC`,
   `support@xchain.io`. It appears publicly on the listing.
3. Fill the **financial features declaration** and the **Data safety** form
   from the answers already written down in `PLAY_LISTING.md` and
   `DATA_SAFETY.md` in this directory. Do not improvise them in the console;
   if an answer needs to change, change it in those files first.
4. Set **country availability** (D8). Still an open operator/legal decision;
   see `PLAY_LISTING.md`.

---

## Blocker status (re-measured 2026-08-01, after the org-level change)

### CLEARED: the contact mailbox

`dankest.llc` publishes Google Workspace MX records (`aspmx.l.google.com`), so
`info@dankest.llc` is a real mailbox on infrastructure that already works. The
worry with `support@xchain.io` was that inbound mail depends on , which is
still open; choosing the org address routed around that entirely. Still worth one
test mail from an outside account, because a mailbox that exists and a mailbox
someone reads are different things, and store correspondence runs on clocks as
short as 7 days.

### CLEARED: the website Google fetches

`https://dankest.llc/` returns **200** to a plain non-browser client, where
`https://xchain.io/` returns **403** behind Cloudflare bot protection. The
account-level website field is now pointed at a URL Google can actually read.

### STILL OPEN: the privacy policy URL

    https://dankest.llc/privacy    404

Every listing needs a privacy policy at a URL the reviewer and Google can fetch,
and it must match the Data safety answers. The text already exists in this repo at
`docs/Privacy_Policy.md`, including the mobile section written in S4; what is
missing is publishing it. Two options, and the org-level decision above argues for
the first:

- `https://dankest.llc/privacy`, a studio-wide policy, on the host that already
  serves 200. Fastest, and consistent with an account that will publish several
  apps.
- `https://xchain.io/privacy`, per-product, which needs the  apex flip and
  the Cloudflare allow first, or Google fetches a 403.

### STILL OPEN, and unrelated to the account: App Links on `xchain.io`

This one cannot move to `dankest.llc`. The App Links declared in S3 are for
`https://xchain.io/wallet`, so Android fetches
`https://xchain.io/.well-known/assetlinks.json` with its own client, and the
current 403 means verification fails **silently**: links open in the browser
instead of the app, with nothing anywhere saying why. It needs the  apex
flip plus an explicit edge allow for `/.well-known/*`. The iOS lane hits the
identical problem with its AASA file.
## What happens next on my side

Once the console is up and the hardware keys are on it, say so and I will
generate the two keystores here on the provisioned release machine:

- **K9**, the Play upload key. Recoverable if lost: Google accepts a new
  upload key after an identity check.
- **K10**, the direct-APK key. **Not recoverable, ever.** Losing or leaking
  it means every direct-install user must uninstall (wiping their vault) and
  reinstall across a trust break.

You supply the two passphrases at the prompts; I never see them and they
never reach a command line. After that I can run
`tools/release/android-ceremony.sh` end to end for the first time, and the
K10 fingerprint fills the slots already waiting for it in `SECURITY.md` and
`assetlinks.template.json`.
