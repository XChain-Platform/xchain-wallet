# App Store submission runbook (XChain Wallet, iOS)

**Item:** §5/§6. Written 2026-08-02.
**Reads with:** `APP_STORE_LISTING.md` (every string a console form asks for),
`PRIVACY_NUTRITION_LABELS.md` (the privacy answers and the measurement behind
them), `PLAY_SUBMISSION_RUNBOOK.md` (the Android twin; the two lanes share a
binary's worth of decisions and none of their clocks),
`docs/Release_CI_Setup.md` (the secrets), `tools/release/ios-archive.sh` and
`ios-export.sh` (the build), and `claude/specs/wallet-publishing-ios.md` §5,
§6 and §9.

The Android twin opens by saying the account exists and only the upload never
happened. **This one opens earlier than that.** As of 2026-08-02 the Apple
Developer Program organization enrollment is SUBMITTED and Apple is verifying
the entity (), so nothing in Phases 1 onward has ever been possible,
let alone done. Everything that did not need the account is built: the shell,
the vault, both SSC-1 doors, the icons, the version wiring, the store-profile
compile-out, the screenshots, the listing text, the privacy answers, and the CI
lane's ungated half.

---

## Ground rules

1. **The lane exports an ipa and stops.** `test/smoke/audits/release-ci.smoke.js`
   forbids `altool --upload`, `fastlane` and every other publish shape in the
   release path, because a tag-triggered lane holding signing credentials AND
   uploading is a signed-malware factory. A human uploads and a human presses
   submit. Changing that means changing the smoke first, deliberately.
2. **Fill no form from memory.** Every answer is in this repo. A console field
   with no in-repo answer is a gap to register, not a field to improvise.
3. **The bundle id and the first upload's build number are permanent.**
   `io.xchain.wallet.ios` (D1) pins every later artifact, entitlement, AASA
   entry and provisioning profile. App Store Connect cannot release a spent
   build number, which is why the project carries no `MARKETING_VERSION` or
   `CURRENT_PROJECT_VERSION` literal at all and reads both from the generated
   `ios/App/Version.xcconfig` (, S4a). A burned upload is a new tag,
   `vX.Y.Z-respin.N` on the same commit, never a hand-edited number.
4. **The App Store has no rollback.** Unlike the desktop feed, a bad build can
   only be paused and superseded through another review cycle. Expedited review
   is a favour, not a lane. Anything shipped here must be forward-compatible or
   in-app reversible.
5. **No review-only configuration, ever, and no review detection.** An app that
   behaves differently for the reviewer is the same 2.3.1 termination-level
   pattern as a remotely-toggled hidden surface, and termination takes every
   Apple surface with it, desktop notarization included.

---

## Phase 0: the blocking gate

Do not open a console form until every row is green. State as of 2026-08-02.

| # | Precondition | State |
|---|---|---|
| 0a | Apple Developer Program, ORGANIZATION enrollment (K2) | ⬜ **SUBMITTED 2026-08-01, Apple verifying the entity** (). Blocks 0b, 0c and every phase below |
| 0b | Account Holder named, and hardware-key 2FA on that Apple ID | ⬜ needs 0a. One named human accepts program agreements; pending agreements silently block uploads |
| 0c | K4 (ASC API key) and K5 (Apple Distribution cert + provisioning profile) exist, and the four secrets are installed | ⬜ needs 0a. Phase 1 and Phase 2 |
| 0d | Privacy policy URL resolves **and serves the current text** | ✅ ** RESOLVED 2026-08-02**, measured not assumed: `node tools/release/verify-privacy-url.mjs` exits 0 ("resolves directly and carries the current policy verbatim"), and the live page says "we do not keep your IP address" with the 844-of-846 measurement, dated 2 August 2026, with the old 14-day claim absent entirely. **Re-run it before each submission**, since it checks the deployed TEXT and not just the URL |
| 0e | Privacy answers settled, and both stores answer alike | ✅ ** settled 2026-08-02**: `PRIVACY_NUTRITION_LABELS.md` is "Data Not Collected", derived from a measurement, and `DATA_SAFETY.md` agrees |
| 0f | Territories decided (D7) | ✅ **DECIDED 2026-08-02 (operator): mirror Android D8 exactly.** The list is in `APP_STORE_LISTING.md` under Territories, cross-checked against `PLAY_LISTING.md` by smoke so the two stores cannot drift into two answers. Note the one iOS difference recorded there: Android's exclusions bind the Play listing only because the direct APK is jurisdiction-blind, whereas **iOS has no direct lane**, so here the list is the whole story |
| 0g | Demo-path endpoints reachable from a plain client | ✅ automated: `node tools/release/verify-demo-endpoints.mjs`, green testnet and mainnet 2026-08-02. **Re-run immediately before every submission**, it is the gate that caught |
| 0h | Support URL | ⬜ `support@xchain.io` waits on, or point at an xchain.io page instead |
| 0i | The tree is committed and pushed | ⬜ the whole iOS shell is worktree-only as of 2026-08-02. A submission built from an uncommitted tree has no record of what was submitted |
| 0j | External TestFlight beta (D3) | ⬜ operator. Recommendation stands: yes. It is the cheapest real-device coverage available and it creates the review history D2 wants |

**D2 is already answered by the build, and should not be reopened at the
console.** The recommendation was "flag the DEX surface off preemptively for
submission 1", and built exactly that: the store profile does not
carry the eight DEX route components at all, and the build FAILS if anything
imports them. There is no switch to turn back on, which is the point of the
compile-time-only constraint. The reviewer sees a wallet without a DEX because
the binary has no DEX, not because a flag says so.

**0j is not the same shape as the others.** It gates the release schedule, not
the submission: an external beta adds a Beta App Review clock of its own.

---

## Phase 1: the portal, once the account exists

All of it in the Apple Developer portal, as the Account Holder, at a keyboard.

1. **Register the App ID** `io.xchain.wallet.ios`, and enable the
   **Associated Domains** capability on it. The entitlement is already in the
   repo (`App/App.entitlements`, `applinks:xchain.io` and nothing else); an
   App ID without the capability makes that entitlement unsignable and the
   archive fails with a provisioning error that does not name it.
2. **Create the Apple Distribution certificate (K5)** and an App Store
   provisioning profile for that App ID. Custody per rails §4.
3. **Create the App Store Connect API key (K4)** with the **minimum role cloud
   signing accepts**. In this mode the key is cert-minting-capable, which is
   exactly why it gets the smallest role that works rather than Admin.
4. **Route Apple's certificate-issuance notification emails to a monitored
   inbox.** A certificate minted by someone who is not you is the only signal
   that K4 has leaked, and it arrives by email or not at all. Feeds the rails
   §4 K4 custody row.
5. **Note the Team ID.** Phase 8 and both need it, and it is the one
   fact the AASA file cannot be written without.

---

## Phase 2: the secrets

The `mobile-ios` job reads one switch, `ASC_KEY_ID`, and its presence IS the
"is Apple set up yet" condition: everything from `archive` onward is skipped
while it is empty, so the lane degrades to "built, not archived" rather than
turning every release red.

Install into the **`release-signing`** GitHub environment:

| Secret | What |
|---|---|
| `APPLE_API_KEY` | the K4 `.p8` **contents** (the scripts write it to a `umask 077` file, because xcodebuild wants a path) |
| `APPLE_API_KEY_ID` | K4 key id |
| `APPLE_API_ISSUER` | K4 issuer id |
| `APPLE_TEAM_ID` | K2 team id |

These are the same four `docs/Release_CI_Setup.md` lists under *notarization*.
The iOS lane reuses them rather than minting a second key, so setting them
arms two lanes at once: check the desktop notarization lane's next run too.

---

## Phase 3: the first archive, which has never run

Tag as usual. On the first tag after Phase 2, `tools/release/ios-archive.sh`
and `ios-export.sh` execute **for the first time ever** ( §10 S4b says
so explicitly). Treat that run as the thing under test, not the release.

What the lane does, in order: builds the web shell at the `store` profile,
runs the dev-mock gate, stages the bundle and writes `Version.xcconfig` from
the **tag** (not from package.json), builds for the simulator unsigned, then
archives with `-allowProvisioningUpdates` authenticated by K4 and exports with
`method: app-store-connect` into `xchain-wallet-ios-vX.Y.Z.ipa`.

Watch for, in this order, because each masks the next:

- **`Version.xcconfig`** is echoed by the job. It must carry the tag's numbers.
  An empty `CURRENT_PROJECT_VERSION` uploads as a build number you can never
  reuse.
- **Provisioning.** `-allowProvisioningUpdates` will create what is missing,
  which is convenient and also means a failure here is usually the App ID
  capability from Phase 1.1, not the certificate.
- **The exported name.** `ios-export.sh` renames the export because an ipa
  called `App.ipa` is an undeclared file that hard-fails `sign.sh`.
- **The artifact upload step is gated on the same secret.** If it is skipped,
  the lane produced nothing and **the release gate will not tell you**: the ipa
  row in `expected-artifacts.txt` is `optional`, and (the gate
  declares artifact classes without counting them) is still open. Check the
  run's artifacts by eye on the first release.

Then run `tools/release/sign.sh` over the staging directory so the ipa lands in
`RELEASE_HASHES` and the signed manifest, recorded as profile `store`.

**What the manifest does and does not prove here.** Per rails §3 it proves what
was submitted, not what the store delivered. iOS is the extreme case: Apple
re-signs, thins and FairPlay-encrypts, so no user can hash their installed app.
The verify page must not overclaim for iOS.

---

## Phase 4: the app record and the upload

1. **Create the app record** in App Store Connect against the Phase 1 App ID.
   This is the step that pins the bundle id publicly.
2. **Opt OUT of "Mac (Designed for iPhone/iPad)" availability.** It is ON by
   default. D1 removed the *collision* reason to opt out, not the product
   reason: it would put a WKWebView wallet on macOS beside the Electron one,
   with two vaults, two update paths and a surface nobody smoke-runs. Revisit
   post-launch as a deliberate decision.
3. **Upload the ipa by hand**, Transporter or Xcode Organizer. Not CI, ever
   (ground rule 1).
4. **Answer export compliance.** `ITSAppUsesNonExemptEncryption = NO` is
   already in `Info.plist`; the self-classification note and its two recurring
   obligations (the annual BIS report, France's separate declaration) are in
   `PRIVACY_NUTRITION_LABELS.md`. The wallet's ECDH messaging uses standard
   algorithms and stays inside the exemption; that is pre-justified there so
   the form is not answered from scratch.
5. Wait for ASC processing. A build that fails processing is burned:
   `vX.Y.Z-respin.N` on the same commit, never a hand-edited number.

---

## Phase 5: TestFlight

Internal testers first, no review. Then external per D3, which does draw
**Beta App Review on the first build of EACH version** (usually hours,
occasionally real). It is a recurring clock, not a one-time gate.

**TestFlight builds hard-expire 90 days after upload.** No other channel has
this clock. The beta lane needs a re-upload cadence or an explicit decision to
let it lapse, named as an operational duty.

This is also the venue for the §2.1 demo rehearsal: run the scripted demo end
to end on an iPhone **and** an iPad, including the airplane-mode signing step,
before anything is submitted. iPad is a shipped surface because D6 says
universal, so it is a review surface too.

---

## Phase 6: the console forms

Every answer is in this repo. Copy, do not compose.

| Console field | Source |
|---|---|
| App name, subtitle, keywords | `APP_STORE_LISTING.md` (the drafted subtitle is over Apple's 30-char limit; three that fit are offered, pick one) |
| Promotional text, description | `APP_STORE_LISTING.md` |
| Category, contact details | `APP_STORE_LISTING.md` |
| Age rating questionnaire | `APP_STORE_LISTING.md` (unrestricted-web access: **NO**, the app embeds no general browser) |
| Review notes, including the scripted airplane-mode demo | `APP_STORE_LISTING.md` |
| Demo account (App Review "Sign-In Required") | `APP_STORE_LISTING.md`. The seed is **per-submission and burned the moment it enters review notes**: never reused across stores or releases, because a shared seed is a mutable resource two concurrent reviewers can race into a "does not work" rejection |
| Privacy nutrition labels | `PRIVACY_NUTRITION_LABELS.md`, gated on Phase 0d |
| Privacy policy URL | Phase 0d |
| Territories | D7, Phase 0f |
| Screenshots, iPhone AND iPad | `packages/mobile/screenshots/`, regenerated by `packages/mobile/scripts/screenshots.sh`. Confirm the required pixel sizes in ASC at submission rather than trusting any pinned list; Apple changes them |

The iPad set is **mandatory** for a universal app. A missing iPad set blocks
submission; it does not degrade.

---

## Phase 7: submit

- **"Manually release this version", always.** Automatic release on approval
  lands at Apple's whim and must not ship a wallet ahead of its encoder. The
  release button is pressed only after the release's server-side prerequisites
  are deployed, encoder first, per the standing coupling rule.
- **Phased Release ON** for version updates, understood as partial cover only:
  it throttles automatic updates while manual updates and new installs get the
  new build immediately.
- **Announce the submission window in the ledger** so a concurrent session does
  not reset a venue or halt a service mid-review.

**If it is rejected:** a metadata or review-notes fix may resubmit the same
build. **Any code change made to pass review cuts a new patch tag across all
shells** per the rails §2 hotfix pattern, even if only iOS consumes it. Never
ship iOS-only code under an already-released version number.

---

## Phase 8: close the Universal Links loop

Only possible once the Team ID exists, and the §2 review-defense demo shows a
broken Universal Link without it.

1. Write `TEAMID.io.xchain.wallet.ios` into the association file (;
   the generator lives in xchain-websites).
2. Publish at `https://xchain.io/.well-known/apple-app-site-association`, **no
   redirect**, served to an unauthenticated client: iOS fetches it with its own
   client through Apple's infrastructure, not from the user's browser. Measured
   2026-08-02, the Android sibling path at that host returns 404 `DYNAMIC`, so
   the origin is reachable and the file is simply absent.
3. **Claim one narrow versioned prefix and nothing else**, `/wallet/link/*`.
   Explorer and docs URLs must keep opening in the browser, both for UX and to
   keep the untrusted-input funnel into the wallet small.
4. Verify on a real install. The failure mode is silent: links just open in
   Safari with nothing saying why.

Scheme-delivered payloads (`xchain:`) stay untrusted input either way: any app
may claim a custom scheme and iOS resolution between claimants is undefined.
Every link WE publish is an https Universal Link, which is domain-attested.

---

## What this runbook deliberately does not cover

- Getting the account. That is and an operator action.
- What the listing says. That is `APP_STORE_LISTING.md`.
- The Android lane, which is and a different set of clocks.
- Mac App Store distribution of the DESKTOP wallet, which is and
  shares only the enrollment.
- App Store Connect UI navigation more specific than a menu path. Apple changes
  it faster than this file can, and a stale click-path reads as authority.

## Open decisions this runbook is waiting on

| Decision | Blocks |
|---|---|
| D7 territories | Phase 6, and the legal thread |
| D3 external TestFlight | Phase 5's shape, and the review history D2 wanted |
| the deployed privacy text | Phase 0d, and therefore the labels in Phase 6 |
| the release gate counts artifact classes | Phase 3's "check by eye", which exists only because the gate does not |
