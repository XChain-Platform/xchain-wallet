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
   **Status 2026-08-02: a passkey is enrolled and two hardware keys are on
   order.** A passkey is a real improvement over nothing and it is not the
   control this row asks for: it is bound to a device rather than to something
   you can put in a safe, and it does not survive that device being lost or
   compromised. Finish the row when the keys arrive.
3. Turn OFF SMS and Authenticator-app fallback once the keys work. A phone
   number left on the account is a SIM-swap path around the key.
   **Not yet done, and it is the half that matters most**: while an SMS
   fallback is live, the passkey and the keys are both bypassable by a SIM
   swap, which is the exact attack the §4 K8 row calls the worst event in the
   table.
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
   `30 N Gould St Ste N, Sheridan, WY 82801, United States`,
   `info@dankest.llc`, `+1 949-510-5364`. All of it appears publicly on the
   listing, permanently. Settled in full 2026-08-01 ( D1): the address is
   a registered agent's, the phone is the operator's personal mobile published
   by explicit decision, and `info@dankest.llc` supersedes the
   `support@xchain.io` this step used to name, being the one proven to receive
   mail and the one the Chrome listing publishes. Transcribe all of it from
   `PLAY_LISTING.md` rather than from memory, and never substitute a different
   phone number here: the whole point of the block is that all three stores
   publish the same contacts.
3. Fill the **financial features declaration** and the **Data safety** form
   from the answers already written down in `PLAY_LISTING.md` and
   `DATA_SAFETY.md` in this directory. Do not improvise them in the console;
   if an answer needs to change, change it in those files first.
4. Set **country availability**. **D8 DECIDED 2026-08-02: worldwide minus named
   exclusions**; transcribe the list from `PLAY_LISTING.md`. Unlike the
   `applicationId`, this field is editable later, which is why it errs toward
   exclusion where the law is unsettled.

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

### CORRECTED 2026-08-02: the privacy policy URL was never the problem

    https://dankest.llc/privacy          404      <- what this doc measured
    https://dankest.llc/privacy.html     200      <- that host's real page
    https://xchain.io/wallet/privacy/    200      <- USE THIS ONE
    https://xchain.io/privacy            404

This section concluded "the policy still needs publishing" from the first line
alone. It did not. `dankest.llc` serves `.html` URLs with no extensionless rewrite
(`/about` 404s, `/about.html` is 200), so that 404 was a URL shape rather than a
missing page - and the product policy has been live at
`https://xchain.io/wallet/privacy/` the whole time, 200 to a plain non-browser
client. That is the URL the Chrome listing already publishes and the default in
`test/smoke/audits/privacy-url-check.smoke.js`; all three store forms naming one
URL is the point. The Cloudflare 403 that pushed this to `dankest.llc` in the first
place no longer reproduces either ().

**But the deployed TEXT is stale, and that is a real gate ().** The live
page is dated 1 August 2026 and still says the wallet's first-party hosts log "your
IP address … kept for 14 days". `docs/Privacy_Policy.md` in this repo says the
opposite after re-measuring the next day (the logged address is Cloudflare's, not
the user's; the explorer log is kept one day), that correction is **uncommitted and
therefore undeployed**, and the Data safety and nutrition-label answers were both
rewritten against the corrected reading. Deploy before opening any store form. Full
detail and the order of operations are in `PLAY_SUBMISSION_RUNBOOK.md` Phase 0e.

### App Links on `xchain.io`: the EDGE half cleared itself, the file half is ours

This one cannot move to `dankest.llc`. The App Links declared in S3 are for
`https://xchain.io/wallet`, so Android fetches
`https://xchain.io/.well-known/assetlinks.json` with its own client, and a 403
would mean verification fails **silently**: links open in the browser instead of
the app, with nothing anywhere saying why.

**Re-measured 2026-08-02 and the 403 no longer reproduces** ():
`https://xchain.io/wallet` returns 200 and the `.well-known` path returns **404
with `cf-cache-status: DYNAMIC`**, which is the origin being reached and the file
being genuinely absent - the correct answer today. Nothing here touched
Cloudflare, so it is an unattributed fix that could revert as quietly as it
arrived, and a 200 from this machine is not Android's verifier, which fetches
through Google's infrastructure.

**So the remaining blocker is ours, not the edge's**, and it cannot be cleared
before the first upload: `assetlinks.template.json` carries K10's real fingerprint
and a placeholder where GOOGLE's app-signing certificate goes, and that certificate
does not exist until an AAB has been uploaded. The order is upload → read Google's
cert → publish the real file → `adb shell pm get-app-links`, and it is Phase 3 and
Phase 6 of `PLAY_SUBMISSION_RUNBOOK.md`. The iOS lane hits the identical shape with
its AASA file.
## What happens next on my side

**DONE 2026-08-01: both keystores exist.** K9 `SHA256: 90:07:01:A5:…:32:CB` and K10
`SHA256: 4B:5D:E0:91:…:9E:28`, PKCS12, RSA 4096, on the release machine under
`~/.xchain-release/` (0700), with no passphrase ever on a command line or in a
transcript. K10's fingerprint is now in `SECURITY.md` (canonical) and in
`assetlinks.template.json`. `android-ceremony.sh` has been driven end to end as a
rehearsal and produced a K9-signed AAB plus a K10-signed universal APK derived from
that same bundle.

**Two custody rows are still owed by the operator**, and they are the two this
account cannot be left without: hardware-key 2FA on the console (§4 calls a console
compromise the worst event in the whole key table), and **K10's sealed offline copy**
- K10 was generated online on an explicit decision, which cannot be undone, so the
offline copy is now the only protection against losing a key that can never be
rotated.

From here, the procedure is `PLAY_SUBMISSION_RUNBOOK.md`.

<details>
<summary>The original plan, kept for the record</summary>

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

</details>
