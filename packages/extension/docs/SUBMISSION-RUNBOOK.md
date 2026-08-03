<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright © 2026 Dankest, LLC -->

# Chrome Web Store Submission Runbook

**Date authored:** 2026-08-01  
**Ledger item:**  stage S8 ("submission ceremony support")  
**Scope:** the FIRST submission of the `io.xchain.wallet.extension` item to the Chrome Web Store, from account registration through the unlisted-to-public flip. Everything here is the operational sequence; the decisions behind it live in `claude/specs/wallet-publishing-chrome-extension.md` .  
**Audience:** the operator, sitting at the Chrome Web Store developer console, doing this for the first time. Read the whole thing before opening the console. Several steps below are irreversible or ordering-sensitive; doing them out of order is not recoverable by redoing them in the right order afterward.

**This runbook is NO LONGER BLOCKED.** Both spec decisions it waited on were answered on 2026-08-01: D2 (category `Productivity` → `Tools`, name `XChain Wallet`) and D1 in full, the public-identity set being entity `Dankest, LLC`, the registered-agent postal address in Sheridan WY, `info@dankest.llc`, and the published phone. Every value is written out at the step that needs it, and both former **STOP** blocks now carry answers instead of refusals. The rule that produced them still stands for anything that comes up later: do not invent a value to get past a step, because §8 of the spec is explicit that these are operator decisions, not defaults.

---

## Ground rules (apply to every phase below)

- **2FA is hardware security keys or passkeys only. Never SMS, never TOTP.** Phished publisher accounts pushing malicious updates is the dominant real-world extension-compromise pattern (spec §2 cites the December 2024 Cyberhaven wave, which was OAuth phishing of a publisher account, not a code vulnerability). Set this up before anything else in Phase 1.
- **The publisher identity grants OAuth to no third-party tool, ever.** Not a CI service, not a browser extension, not a "connect your Google account" integration, no matter how convenient. This is the same compromise class as the bullet above: an OAuth grant is a standing credential that does not show up in a password check.
- **This runbook never contains a real secret, credential, or recovery code.** It says where each one lives and how it is handled, never its value. If you find yourself about to paste a password, recovery code, or API key into this file (or into any file), stop; that is not what this document is for.
- **Credential custody:** the Chrome Web Store developer account is K7 in the rails credential inventory (`claude/specs/wallet-release-rails.md` §4). Per that spec's account-hygiene rule, K7 uses hardware-key 2FA with no SMS fallback, is org-owned (not a personal Gmail), and its recovery codes go into the recovery store (LastPass, per the rails custody split) alongside the other K-row recovery material, never into this repo, never into a chat, never into a screenshot.
- **One operator, claimed before touching the console.** The pending draft in the CWS console is a singleton; two people editing it clobbers silently (spec §6). Before you open the console, claim this release as the named operator in the ledger entry for this submission.
- **The worktree may hold other sessions' uncommitted work.** Nothing in this ceremony touches git state (no commit, no push, no tag) except where explicitly noted as already-done CI/release-pipeline steps that happened before you sat down. If a step below tells you to run a git command, it is read-only (`git diff`, `git log`).

---

## Phase 0: Preconditions (confirm before Phase 1)

⬜ You have read `claude/specs/wallet-publishing-chrome-extension.md` §2, §3, §4, §8 in full (not just this runbook).  
⬜ Stages S1 through S4 are built (docs pass, security audits, hardening, release tooling). Verify against `claude/OPEN-ITEMS.md` / the spec's own status line, not from memory.  
⬜ You have claimed this submission as the named release operator in the ledger.  
⬜ You have console access to `xchain.io` DNS / Google Search Console (or know who does), because Phase 2's domain verification needs it. This runbook cannot verify that access from the repo; confirm it now rather than discovering the gap mid-ceremony.

---

## Phase 1: Account registration and hygiene

⬜ **Register the developer account** at **https://chrome.google.com/webstore/devconsole** (URL confirmed against Google's own docs 2026-08-01), signed in as **dankestllc@gmail.com** (operator decision 2026-08-01: reuse the Play publisher identity rather than mint a second one). That account is already identity-verified with Google under `Dankest, LLC` with the D-U-N-S, so the trader details this listing later publishes will match what Play already shows, and reviewers cross-check exactly that. Check the avatar before you click anything: a Chrome profile signed into a different Google account is the easy way to register the wrong identity, and the extension ID that follows is permanent. One-time registration fee ($5 historically; Google's current docs do not state the amount, so read what the console asks for before paying).  
⬜ **If the console asks for a publisher display name during signup, use `Dankest, LLC`** to match Play. That field is editable later, unlike the trader details, so it is not a D1 commitment; it just avoids two stores disagreeing in the meantime.  
⬜ **The blast-radius trade this decision accepts:** one phished account now reaches both stores. That is what the group-publisher conversion in Phase 2a exists to unwind, so do not skip it before first public release.  
⬜ **Set up 2FA with a hardware security key or passkey.** Do this at registration time, before anything else touches the account. Never enable SMS or TOTP as a fallback; if the console offers one as a "backup" option, decline it.  
⬜ **Grant no OAuth access to any third-party tool from this identity.** This includes CI/automation tools you may be tempted to wire up early "to save time later." Post-launch CI automation (D4, spec §6) is deliberately not decided yet, and when it is, the token it uses is scoped narrowly and reviewed, not a blanket OAuth grant to the publisher account itself.  
⬜ **Record the recovery codes into the K7 slot of the recovery store** (LastPass, per rails §4), in the same sitting you generate them. A generated credential with nowhere durable to live is a future outage, not a future convenience.  
⬜ **Set the account's contact email to a forwarding address that lands in a monitored shared inbox.** Do not point it at a personal inbox.

### Prove the inbox is actually live

Compliance clocks on this account run as short as 7 days (rejection responses, policy warnings, takedown notices). An unread inbox is how a listing dies quietly, not loudly, so prove receipt before you submit anything, not after the first rejection arrives.

⬜ From an **external** account (not anything that already forwards into the same inbox), send a test email to the console's registered contact address.  
**Done 2026-08-01, at the SMTP layer, for both addresses.** Sent from origin-host (external to Google Workspace) and Google ACCEPTED both: `info@dankest.llc` and `privacy@dankest.llc`, each `status=sent (250 2.0.0 OK ... gsmtp)` via `aspmx.l.google.com`. That proves the aliases exist and the path works, since a nonexistent address is refused at RCPT. **It does NOT prove inbox placement:** neither domain publishes SPF, so an unauthenticated message can be accepted and then filed as spam. Confirm visually, spam folder included, and treat a send from an unrelated provider (a personal Gmail) as the stronger test, because our own infrastructure carries its own reputation.  
⬜ Confirm it arrives in the monitored shared inbox, and confirm someone is actually watching that inbox on a cadence shorter than 7 days.  
⬜ **Correction, measured 2026-08-01:** this runbook previously said inbound mail to `@xchain.io` depends on , and that was wrong.  is the OUTBOUND relay on origin-host (so cron and alert mail can leave the box); inbound is unrelated. `dig MX` shows BOTH `dankest.llc` and `xchain.io` pointing at Google Workspace (`aspmx.l.google.com` et al), so either domain can receive. What MX records do NOT prove is that a given address resolves to a mailbox or alias, so confirm the specific address in Google Admin (or mail it) before you put it in the console. Note also that neither domain publishes SPF, which is a deliverability risk for anything you send FROM them, not a receiving problem. Interim: point the console's contact email at an existing, known-working mailbox, and migrate later via the console's contact-email change flow once  lands. Do not wait on  to do this test; test whatever mailbox you are actually using today.

---

## Phase 2: Account-shape changes before first submission

**Why this phase exists as a separate, ordered block:** the spec is emphatic that group-publisher conversion, domain verification, and the trader declaration all happen **before** first submission, so an account-shape change never races a pending review. Doing any one of these after a submission is pending risks the review clock resetting or the listing entering an inconsistent state mid-review. Do all three now, while there is nothing in flight to race.

### 2a. Group publisher conversion

⬜ Convert the item to a group publisher, with the group holding at least two org identities, each with independent recovery.

**Read this before clicking anything:**

- **This conversion is IRREVERSIBLE.** There is no console flow to convert back to a solo publisher.
- **It moves the publish credential into the Google Group itself.** Once converted, whoever administers that group, including the Workspace admin sitting above it, can add a publisher to the item. You are trading "one lost login kills the extension" for "the group's admin surface is now part of the trust boundary." That is the intended trade (it removes a single point of failure), but go in knowing what you're accepting, not discovering it later.
- **Both group-member identities go into the K7 custody row** (rails §4) in the same step as the conversion. A group conversion with only one member recorded has recreated the single point of failure it exists to remove.

### 2b. Domain verification

⬜ Complete domain verification against `xchain.io` so the listing carries the verified-publisher badge before first submission.

This is the access you confirmed you had (or knew who to ask for) in Phase 0. If you do not have it now, stop and get it before proceeding; do not submit unverified and plan to verify later, since that is exactly the "account-shape change racing a pending review" pattern this phase exists to avoid.

### 2c. Trader declaration

**D1 IS CLOSED as of 2026-08-01. This stop is cleared.** The trader declaration publishes name, postal address, email, **and** phone number, permanently, on the public listing. This is not reversible in the sense that matters: even if you later edit the fields, the original values were public and indexed the moment they went live. Type these exactly, transcribed from here rather than from memory:

> **Entity:** `Dankest, LLC` (decided 2026-07-31)  
> **Postal address:** decided 2026-08-01, a registered-agent address, so it exists to be public:
>
> ```
> Dankest, LLC
> 30 N Gould St Ste N
> Sheridan, WY 82801
> United States
> ```
>
> **Email:** `info@dankest.llc` (decided 2026-08-01, identical to what the Play listing publishes, and proven to receive: accepted by Google from origin-host, arrival confirmed by the operator)  
> **Phone:** `+1 949-510-5364` (decided 2026-08-01)

**About the phone, so that nobody "corrects" it later.** It is the operator's personal mobile, and it was chosen knowingly, after the exposure was put to them explicitly: a number published permanently against a named crypto company is a SIM-swap targeting signal, and the carrier account behind it is the recovery path for mail, banking and exchange accounts that hardware-key 2FA on the publisher account does not protect. The operator decided to publish it anyway. Do not silently substitute a different number at the console: if this is ever swapped for a forwarding line (a VOIP number that rings the same phone satisfies the DSA requirement identically, since the rule is a working means of contact, not a carrier line), that change lands on all three store listings in the same pass, or the one-entity-two-contacts inconsistency this ceremony keeps warning about is one we created ourselves.

⬜ Trader declaration submitted, matching the reconciled identity above: entity, address, email and phone.

---

## Phase 3: Privacy-policy URL must be live before you open the store form

**This phase was BLOCKED and is now CLEAR.** On 2026-08-01 `https://xchain.io/wallet/privacy/` returned **404**: the page was built, correct and deployed, but only at `newsite.xchain.io`, because the apex still served an old placeholder docroot. The operator flipped the apex the same day () and the URL now serves the current policy, confirmed through the edge in a browser and against the origin directly. Re-confirm it yourself before you submit anyway, with the two checks below: this is exactly the kind of thing that is true on the day it is written down and false on the day someone needs it.

⬜ Confirm `https://xchain.io/wallet/privacy/` (trailing slash; this is the canonical form, see S6's note below) resolves and serves the current policy:

```bash
node tools/release/verify-privacy-url.mjs
```

Exit 0 means live, direct, carrying this repo's current policy word for word, and with the policy's contact address readable without JavaScript. The other exit codes are deliberately disjoint: **1** the URL does not resolve, redirects, or serves a stale policy (submission is blocked, and the fix is a deploy); **2** config error, nothing was checked; **3** could not tell, which is never an all-clear; **4** live and current, but a contact address is JavaScript-gated at the edge, which is **submittable** (see below).

**Exit 4 does not block you.** It means the URL resolves and serves the current policy, which is all the store's form validates, but Cloudflare's Email Address Obfuscation is rewriting the policy's `mailto:` links, so a reviewer or regulator reading the document without JavaScript sees `[email protected]` where the GDPR/DSA contact belongs. Submit, and fix the edge setting after: either turn Email Address Obfuscation off for `/wallet/privacy/*` in the Cloudflare dashboard, or publish the address as plain text as well, which the obfuscator does not rewrite. The script prints both ways out when it fires.

**This step used to tell you to EXPECT exit 3 and not read it as failure, and that instruction is now withdrawn.** It was true when Cloudflare answered non-browser clients with 403 on every path of this domain; turned Super Bot Fight Mode off, and as measured on 2026-08-02 a plain `curl` and this script's own fetch both get 200 and the live run exits 0. **Treat exit 3 as what it says it is: could not tell.** The withdrawn instruction was worse than merely stale, which is why it is called out rather than quietly deleted: it pre-armed you to shrug at an inconclusive verdict at the exact moment a real 404 would be producing one, and a 404 that survived every green check is precisely what happened on 2026-08-01.

Do both of the checks below anyway, because they prove different things:

1. **Load the URL in a real browser.** That is the only check that exercises the same path the store's validator will: DNS, the edge, the cache, the redirect behaviour.
2. **Check the bytes against this repo**, by fetching the origin directly and feeding the result back in:

```bash
curl -sS -o /tmp/policy.html --resolve xchain.io:443:<origin-ip> https://xchain.io/wallet/privacy/
node tools/release/verify-privacy-url.mjs --html /tmp/policy.html
```

That second one bypasses the edge on purpose, so it proves the deployed page is the current policy and says nothing about reachability, about a stale edge cache, or about the contact-address obfuscation above. The script declines to give a contact verdict on `--html` bytes for that reason, rather than answering confidently from evidence that cannot see the edge. Neither check subsumes the other.

**Why the trailing slash matters:** the page is generated from the wallet-wide `docs/Privacy_Policy.md` by `xchain-websites/xchain.io/build/privacy.build.js` (stage S6). The site's canonical URL carries a trailing slash. Paste `https://xchain.io/wallet/privacy/`, not `https://xchain.io/wallet/privacy` (no slash), into the console field, to avoid a redirect hop under review. The script treats a redirect as a failure for the same reason, and names the destination so you can paste that instead.

**Content drift is covered from both ends, and you should confirm both.** The hosted page and `docs/Privacy_Policy.md` are two copies of one source; a drift between them is the exact mismatch-rejection pattern spec §3.3 already found once (the Trezor claim). In the `xchain-websites` repo: run `node xchain.io/build/build.js` and confirm `test/wallet-privacy-policy-sync.test.js` passes, which proves the CHECKED-IN page matches. The script above proves the DEPLOYED page matches, which is a different claim: a repo can be correct and the deploy stale. This runbook does not own that repo or that test; it only tells you to check both.

⬜ Hosted policy confirmed live and in sync with `docs/Privacy_Policy.md` at the version you are about to submit.

** is done**, so the `newsite.xchain.io` fallback this phase used to describe is no longer needed and has been removed rather than left as a tempting shortcut: a provisional hostname on a permanent listing is a cost with nothing to buy any more.

---

## Phase 4: Build artifact provenance (the zip you upload)

**The uploaded artifact is exclusively the CI-emitted `xchain-wallet-extension-vX.Y.Z.zip`. Never a locally built zip.** This repo's shared worktree has a documented incident class of a build carrying a neighbour's uncommitted edits; the post-publish diff (Phase 8) would only catch that days later, after review, with the bad build already live. Do not run `pnpm --filter @xchain-wallet/extension build` on your own machine and zip the result for upload; that build is not the one this ceremony verifies.

### 4a. Get the CI artifact

The `.github/workflows/release.yml` `v*`-tag workflow builds the extension zip and leaves it as a run artifact named `unsigned-web-extension` (it does not publish or sign anything itself; see that workflow's own header). The release maintainer already downloaded it from the specific run ID matching the tag commit and staged it into `release-artifacts/vX.Y.Z/` as part of the normal release procedure (`tools/release/README.md`, "Per-release procedure"). Confirm that staging happened for the tag you are about to submit:

```bash
ls release-artifacts/vX.Y.Z/xchain-wallet-extension-vX.Y.Z.zip
ls release-artifacts/vX.Y.Z/RELEASE_HASHES.txt
```

If either is missing, stop; go back to the release procedure, not around it. Submitting a zip you built or found without a signed manifest behind it defeats the entire provenance chain this phase exists to enforce.

### 4b. Check the sha256 before upload

```bash
bash tools/release/verify.sh --input release-artifacts/vX.Y.Z/ \
  --tag vX.Y.Z --artifact xchain-wallet-extension-vX.Y.Z.zip
```

Confirm it reports the hash as OK (and, once G180 / the release key ceremony lands, the signature as OK too; today signing is blocked on that, per `tools/release/README.md` "Status today"). This is the same command `docs/QA_Checklist.md`'s "Chrome Web Store release provenance" section already asks for; this runbook does not duplicate that checklist, it points at the one command you need at this exact moment.

⬜ `verify.sh` reports the zip's hash as OK against `RELEASE_HASHES.txt`.  
⬜ The checked sha256 is ready to record in `publish-log.md` (next step happens at upload time, Phase 6, not now: the log row is written in the same step as the actual upload, not before it).

---

## Phase 5: Fill in the store listing form

Everything paste-ready lives in `packages/extension/docs/STORE_LISTING_PACK.md`. This runbook does not duplicate that copy; it tells you which field takes which section and where the form still cannot be completed.

| CWS console field | Source |
|---|---|
| Single purpose | `STORE_LISTING_PACK.md` §1 |
| Permission justification, per permission (`storage`, `sidePanel`, `notifications`, `alarms`, content script, `web_accessible_resources`) | `STORE_LISTING_PACK.md` §2 |
| Content-script / host-permission justification | `STORE_LISTING_PACK.md` §3 |
| Listing name, summary, full description | `STORE_LISTING_PACK.md` §4 |
| Screenshots (1280x800 popup, side panel, sign approval) and small promo tile (440x280) | `packages/extension/docs/listing-assets/` (four PNGs, generated by `packages/extension/scripts/capture-listing-screenshots.mjs`) |
| Privacy-policy URL | `https://xchain.io/wallet/privacy/` (Phase 3; confirm it is still live right before you paste it) |
| Privacy practices: remote code, and the data-usage checkboxes | `packages/extension/docs/DATA_DISCLOSURE.md`, which answers the whole tab field by field. **One answer on it is blocked; see the stop below.** |

⬜ Single-purpose, permission justifications, and content-script justification pasted from `STORE_LISTING_PACK.md`.  
⬜ Listing name and description pasted (name **`XChain Wallet`**, decided 2026-08-01; it must equal `manifest.json`'s own `name`, which a smoke now enforces).  
⬜ Four listing assets uploaded from `packages/extension/docs/listing-assets/`.  
⬜ Remote-code answer and the unblocked data-usage categories ticked from `DATA_DISCLOSURE.md` §2, §5 and §6, and every category the console shows that document does not name recorded back into it before submitting.  
⬜ Privacy-policy URL field set to `https://xchain.io/wallet/privacy/`.

###  CLEARED 2026-08-02: this phase is no longer blocked

The data-usage checkboxes were blocked for one day on whether the wallet
"collects" user data. **It does not, and that is now a measured fact rather than
a position.** The 2026-08-01 premise (client IPs retained for 14 days beside
request lines carrying wallet addresses) was read off the Apache format string:
`combined` starts with `%h`, and `%h` behind a reverse proxy is the proxy. All
three API hosts are Cloudflare-proxied with no `mod_remoteip` loaded, so 844 of
846 distinct sources on explorer are Cloudflare edge addresses, 119 of 120 on
encoder, 162 of 162 on hub. No wallet user IP is retained. The one real residue,
wallet addresses in explorer's request lines, now has 1-day retention (applied
and verified on origin-host 2026-08-02).

All three store forms answer "not collected", together, and
`test/smoke/audits/extension-data-disclosure.smoke.js` fails if they ever stop
agreeing. Fill the tab from `DATA_DISCLOSURE.md` §2, §5 and §6.

⬜ Before ticking anything, re-measure: `docs/Data_Collection.md` Q1 carries two
commands. Enabling `mod_remoteip` or moving the explorer log back under
`/var/log/apache2/*.log` would each silently make the answer false again.

**D2 DECIDED 2026-08-01 (operator), so this stop is cleared.** Both fields on this form now have answers:

- **Category: `Productivity` → `Tools`.** Where comparable browser wallets sit, and what the listing pack assumed throughout. It needs no explanation under review, and the single-purpose statement already reads as a tool. The console's own taxonomy is the authority on the exact wording of the two levels: if it offers something other than a `Tools` subcategory under `Productivity`, pick the nearest and record what you actually chose in `STORE_LISTING_PACK.md` §5 rather than assuming this document was right about a menu it cannot see.
- **Final store name: `XChain Wallet`.** It must equal `manifest.json`'s `name`, because CWS takes the listing title from the package; `test/smoke/audits/extension-listing-pack.smoke.js` fails if the two ever differ, so do not retype it here from memory.

⬜ Category and name fields filled from `STORE_LISTING_PACK.md` §4 and §5.

**Support email and trader-declaration fields on this form are the same D1 gate as Phase 2c.** If you reached this phase with D1 still open, you should not have gotten past Phase 2; if you did, stop here and go back.

---

## Phase 6: First upload

⬜ Upload `xchain-wallet-extension-vX.Y.Z.zip` from `release-artifacts/vX.Y.Z/` (the file you hash-checked in Phase 4, not a re-download, not a re-build).  
⬜ **Set visibility to UNLISTED, not public.** This is the first-submission rule from spec §4: the listing is installable only via a direct link until the exit criteria in Phase 8 all pass.  
⬜ Submit for review.

### Immediately after upload

⬜ **Record the assigned extension ID.** Chrome assigns this 32-character (`a`-`p`) hash at first upload, and it is permanent: losing the account means losing the ID, and every installed user is orphaned with no update path. There is no retry on this one; write it down correctly the first time.
  - Add it to the rails K7 row (`claude/specs/wallet-release-rails.md` §4).
  - Add it to `docs/BRIDGE.md`, wherever it documents `chrome-extension://<id>/...` for dApp integrators (currently a placeholder `<id>`), so provider-detection guidance stops being hypothetical.  
⬜ **Append the publish-log.md row**, in the same sitting as the upload, not later: version, the zip sha256 from Phase 4b, item (`main`, since this is the first submission), operator, date. Follow the format already scaffolded in `packages/extension/docs/publish-log.md` (its current row is a labeled EXAMPLE; replace-with-real-entry conventions are documented at the top of that file).

---

## Phase 7: While the review clock runs

Expect days for a new wallet listing; budget two weeks. This is a waiting phase, not an idle one:

⬜ If any correspondence arrives (a question, a warning, a rejection), log it in `packages/extension/docs/store-correspondence.md` in full **before** responding, using the entry format already scaffolded there. Respond via the console's appeal/reply flow. Never resubmit blind: read the reviewer's stated reason, check it against `STORE_LISTING_PACK.md`'s existing justification language first, and reuse language a reviewer has already accepted where it applies.  
⬜ If the review rejects the submission, fix the specific finding, log the outcome and the follow-up action taken in `store-correspondence.md`, and resubmit through the same unlisted-first path. Do not skip Phase 2's ordering rule on a resubmission either: if any account-shape change is pending when a resubmission goes in, that is the exact race this ceremony was built to avoid.

---

## Phase 8: Exit criteria before the public flip

Do not flip visibility to public until every item below is checked. These are concrete and checkable, not a vibe:

⬜ Installed from the store link (the unlisted item's direct URL, not a sideload) on at least 2 machines.  
⬜ A patch version published and observed auto-updating on both of those machines within 24 hours, **measured from the patch showing as PUBLISHED in the console**, not from when it was uploaded (its own review clock sits in between the two).  
⬜ Connect + sign driven end to end against the test dApp (`packages/extension/docs/TEST_DAPP_RUNBOOK.md`), from the **store-installed** build specifically, not a local dev build. This matters because the dev server silently substitutes a dev-mock SDK; only a store-installed build proves the real signing path.

> **Serve the test dApp on the machine you are testing from.** These two criteria combine into a trap: "at least 2 machines" invites pointing the second machine at the first one's `http-server` by LAN address, and `http://192.168.x.x:5500` is neither `localhost` nor `127.0.0.1`, so after D6 the content script does not run there. `window.xchain` never appears and it reads exactly like a wallet bug, which is the symptom D6 already produced once in the co-sign e2e spec. Run the server on each machine, or put it behind TLS. Do not widen the manifest to make a test setup work: `test/smoke/audits/extension-provider-origins.smoke.js` will fail, and widening triggers CWS re-review and can disable the extension for installed users until they re-accept.  
⬜ **The store-version monitor (spec §2 "Publish monitoring", stage S5) is live.** The script exists: `tools/release/store-version-monitor.mjs` was built on 2026-08-01 and its parser is gated by `test/smoke/audits/store-version-monitor.smoke.js`. What does NOT exist yet is the running job, and that is what this box is about. Two things are still missing and both come out of this ceremony: the item ID (Chrome assigns it at first upload, Phase 6) and an operator running the install documented in `tools/release/README.md` "Installing the store-version monitor on origin-host". Do not flip to public before it is running: this monitor is what turns a rogue or compromised publish into a same-day alert instead of a silent one, reading `publish-log.md` against the live store version. Confirm its cron is actually installed on origin-host and has fired at least once before treating this box as checked, not merely that the script exists. **The script itself refuses to be mistaken for a running check:** with no item ID set it exits 2 (config error), never 0, precisely so a cron that never really ran cannot read as an all-clear.

⬜ **All boxes above checked** before flipping visibility to public.

Once public: the store's staged-rollout percentage is not available to this listing yet (Chrome requires more than 10,000 users for that). Every subsequent release soaks in the beta lane first per spec §4, a separate ceremony from this one (this runbook covers first submission of the main item only; the second unlisted beta item's own setup follows D3, spec §8, and is not part of this document).

---

## What this runbook deliberately does not cover

- **Rollback.** There is no rollback lever on the Chrome Web Store; a previous version can never be re-served. If you need one, read `tools/release/rollback-rerelease.sh`'s own header first, then `claude/reports/launch/INCIDENT-RUNBOOK.md` section 14 ("Chrome extension: emergency levers") before reaching for the script during an actual incident. The recipe is prepared and driven (stage S19, gated by `test/smoke/audits/rollback-rerelease.smoke.js`), so nothing about it is outstanding; it is simply a different ceremony from this one, run under different conditions, and it is the SLOW path in every case.
- **Post-publish byte verification.** Once you are live, `bash tools/release/verify-store.sh` checks the store-served item against the signed reference (required at first publish, and after any account-security event). Its usage and flags are documented in its own header; this runbook does not repeat them since the command differs by whether you have an unpacked install directory or a raw CRX.
- **CWS API upload automation.** Not decided (D4, spec §8). Nothing here assumes it exists.
- **Second unlisted item for beta-lane QA soak.** Contingent on D3 (spec §8), a separate setup ceremony once decided.

---

## Appendix A: Everything blocked on an open decision, in one place

| Where | Blocked on | What it needs |
|---|---|---|

**This table is EMPTY again as of 2026-08-02.** It held one row for part of that day: stage S15 built the Chrome data-disclosure answers and found that the mobile forms' blocker () blocked this ceremony too. It was settled the same day by measuring the live hosts, which showed the premise was false. Every row this table has ever held now has an answer, and they are recorded at the steps that need them rather than here, so that nobody transcribes a value out of an appendix:

- **D1, closed.** Publisher `Dankest, LLC`, support `info@dankest.llc`, privacy contact `privacy@dankest.llc` (created and proven to receive that day), domain `xchain.io`, postal address `30 N Gould St Ste N, Sheridan, WY 82801, United States` (a registered agent's), phone `+1 949-510-5364` (the operator's personal mobile, chosen knowingly; see Phase 2c). Covers both the Phase 2c declaration and the Phase 5 form fields, which were the same gate surfacing twice.
- **D2, closed.** Category `Productivity` → `Tools`, final name `XChain Wallet`, which must equal `manifest.json`'s `name` and is now enforced by a smoke.
- **Phase 3, cleared.** The privacy-policy URL went live on 2026-08-01 with the apex flip.

**Nothing in this ceremony is blocked on a decision.**, which blocked the Phase 5 data-usage checkboxes for part of 2026-08-02, was settled that day: the wallet does not collect user data, measured rather than argued, and all three store forms say so together. What stands between here and a submitted listing is the ceremony itself: an operator at the console, working Phases 1 through 8 in order.

Two open decisions remain on the ITEM, and neither gates this document: **D3**, the beta/soak lane, which governs §4's soak for every release after the first and is a separate setup ceremony; and **D4**, CWS API upload automation, explicitly post-launch.

## Appendix B: Things this runbook could not verify against the repo, or is not certain about

- **Exact Chrome Web Store console menu paths and field labels** (where "convert to group publisher" or "trader declaration" literally live in the current console UI). Google changes this console's layout without much notice, and this repo has no record of the live console to check against. Treat every console-navigation instruction above as "this feature exists and works this way," not as "click here"; confirm the actual click-path against the live console at the time, and if a described feature seems to have moved or been renamed, that is more likely a console change than an error in this runbook, but stop and re-verify rather than assuming.
- **Whether the console still requires the trader/non-trader declaration in the same form step as support email.** The spec (§2) describes it as a forced declaration; this runbook could not confirm the exact console flow's field ordering from the repo.
- **The precise wording the CWS review process uses for a domain-verification failure or a group-conversion prompt.** Not something a text search of this repo can confirm; treat this runbook's description of Phase 2 as the sequencing rule (what must happen before what), not a transcript of console copy.
- **Whether `docs/BRIDGE.md` already has a placeholder for the extension ID or needs one added fresh.** Confirm the exact line to edit when you get there; this runbook only confirms the file is the right one (it documents `chrome-extension://<id>/...` for dApp integrators).

## Appendix C: References

- `claude/specs/wallet-publishing-chrome-extension.md`  - the spec this runbook operationalizes.
- `claude/specs/wallet-release-rails.md`  §4 - the K7 credential row and custody rules.
- `packages/extension/docs/STORE_LISTING_PACK.md` - paste-ready listing copy and permission justifications.
- `packages/extension/docs/publish-log.md` - the row you append at upload time.
- `packages/extension/docs/store-correspondence.md` - reviewer exchange log.
- `packages/extension/docs/listing-assets/` - screenshots and promo tile.
- `docs/Privacy_Policy.md` - the policy the hosted page and the data-disclosure tab must both match. It covers every shell (web, extension, desktop, Android, iOS); `packages/extension/PRIVACY_POLICY.md` is a signpost pointing here and holds no prose.
- `packages/extension/docs/manifest-freeze.json` and `docs/QA_Checklist.md` "Chrome Web Store release provenance" - the pre-upload gates (manifest freeze, human diff, sha256 check) that run before this ceremony's Phase 4.
- `tools/release/README.md`, `tools/release/verify.sh`, `tools/release/verify-store.sh`, `tools/release/rollback-rerelease.sh` - the artifact-provenance and post-publish tooling this runbook points at rather than duplicates.
- `tools/release/verify-privacy-url.mjs` - Phase 3's check: is the policy URL live, direct, and serving this repo's current policy.
- `docs/BRIDGE.md` - where the assigned extension ID gets recorded for dApp integrators.
- `claude/reports/launch/INCIDENT-RUNBOOK.md` section 14 - emergency levers if something goes wrong after publish.
