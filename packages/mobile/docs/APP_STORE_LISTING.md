# App Store listing pack (XChain Wallet, iOS)

**Item:**  §6 / §2. **Status:** drafted 2026-08-01 (stage S5a), not
submitted. The Play twin is `PLAY_LISTING.md` next to this file.

Every string App Store Connect asks for lives here, so a resubmission never
improvises and two versions of the truth never start. When a reviewer question
changes an answer, it changes **here** first and in the console second.

Privacy answers are not in this file: they are in
`PRIVACY_NUTRITION_LABELS.md`, derived from `packages/core/src/privacy/wireAudit.js`.

---

## App name, subtitle, keywords

    Name:     XChain Wallet
    Subtitle: Self-custody Bitcoin, Litecoin, Dogecoin

(Name 14 characters of 30; subtitle 46 of 30 **over the limit**, so pick one:)

    Self-custody BTC, LTC and DOGE          (38, still over)
    Self-custody crypto wallet              (26)
    Your keys, on your phone                (24)

**Keywords** (100 characters, comma separated, no spaces after commas, and
never repeat a word already in the name or subtitle):

    bitcoin,litecoin,dogecoin,seed,keys,token,send,receive,qr,offline,noncustodial,open,source

Do not put "crypto wallet" competitor names or "free" in here; keyword
violations are a metadata rejection, which is the cheap kind, but it still
costs a review cycle.

## Promotional text (170 chars, changeable without a new build)

    Your recovery phrase never leaves your phone. Sign transactions offline,
    scan a QR to receive, and hold tokens issued on the XChain protocol.

## Description

XChain Wallet is a self-custody wallet. Your recovery phrase and your keys are
generated on your device, encrypted with your password, and never leave it. We
cannot see your balance, we cannot move your coins, and we cannot help you
recover a lost recovery phrase. That is what self-custody means, and it is
worth understanding before you start.

What you can do with it:

- Hold and send Bitcoin, Litecoin and Dogecoin.
- Hold and send tokens issued on the XChain protocol, and see their history.
- Scan a QR code to receive, to send, or to sign a transaction from a wallet
  kept offline.
- Unlock with Face ID or Touch ID instead of typing your password every time.

How your wallet is stored on this iPhone:

- The wallet file is encrypted with a key held in the device Keychain, marked
  so it never reaches iCloud and never leaves this device. The file itself is
  excluded from iCloud and Finder backups.
- Moving to a new phone means importing your recovery phrase. Write it down
  when the app shows it to you. There is no other copy, and a device backup
  will not carry it.

What this app does not do:

- It does not hold your coins for you, and there is no account to sign into.
- It does not collect analytics, and there is no advertising.
- It is not an exchange, and it does not mine anything.

Open source, AGPL-3.0-or-later. Built by Dankest, LLC.

## Categorization and contact

| Field | Value |
|---|---|
| Primary category | Finance |
| Secondary category | Utilities |
| Bundle ID | `io.xchain.wallet.ios` (D1; immutable after first upload) |
| Support URL | xchain.io support page, or `info@dankest.llc`. **Corrected 2026-08-02 ( S20): `support@xchain.io` does NOT wait on.**  is the OUTBOUND relay on origin-host, so cron and alert mail can leave the box; it has nothing to do with receiving. `dig MX` puts both `xchain.io` and `dankest.llc` on Google Workspace (`aspmx.l.google.com`), re-measured 2026-08-02. What MX records do not prove is that a specific address has a mailbox, so drive any address end to end before publishing it, the way D1 drove `info@` and `privacy@`. `info@dankest.llc` is the one already proven to receive, and using it keeps one contact across all three stores |
| Marketing URL | `https://xchain.io` once the  apex flip lands |
| Privacy policy URL | **`https://xchain.io/wallet/privacy/`** (trailing slash; the un-slashed form 301s). Corrected 2026-08-02: this row used to name `dankest.llc/privacy.html` and blame a missing DNS A record. Both were wrong. The xchain.io URL returns 200 to a plain client, is what the Chrome listing already publishes, and all three store forms naming ONE url is the point. **✅ Ready as of 2026-08-02.** The blocker was never the URL but the deployed TEXT (), and it is cleared: the page now carries the corrected policy verbatim, confirmed by `node tools/release/verify-privacy-url.mjs` exiting 0 and by reading the live page, which says "we do not keep your IP address" with the 844-of-846 measurement and no trace of the old 14-day claim |
| Trader status (EU DSA) | Trader: Dankest, LLC, `info@dankest.llc`. **Use the same address the Play and Chrome listings use**; one legal entity with two public trader contacts is what a regulator notices |

## Territories (D7)

**DECIDED 2026-08-02 (operator): mirror the Android D8 list exactly.** One
policy across both stores, mapped onto Apple's storefronts. This closes D7, the
last decision on `claude/specs/wallet-publishing-ios.md` that did not need the
Apple account.

The reasoning is not restated here; it is in `PLAY_LISTING.md` under D8, and
the two lists are cross-checked by `test/smoke/shells/mobile-ios-shell.smoke.js`
so they cannot drift into two different answers to one question. Guideline
3.1.5 compliance is judged **per territory the app is available in**, so this
field is a legal position, not a reach setting.

**The same load-bearing fact applies on the App Store:** availability is
editable in App Store Connect at any time, unlike the bundle id and the first
build number. Starting conservative costs a few clicks; starting open and being
wrong costs a regulator.

### Tier 1: excluded, no further input needed

| Storefront | Why |
|---|---|
| **United Kingdom** | The financial-promotions regime is the reason crypto apps have been delisted there. Declined rather than accepted, same as Play |
| Cuba, Iran, North Korea, Syria | Comprehensive US sanctions. Apple does not operate storefronts there; excluding them explicitly states the position rather than relying on Apple's list staying the same |
| Crimea, Donetsk, Luhansk | Same, region-scoped |
| Russia, Belarus | Sanctions. Note the App Store's Russia posture has changed more than once; the exclusion is ours regardless of Apple's |
| Mainland China | A wallet app requires a local ICP filing and the China storefront has its own crypto rules entirely. Out of scope for v1 |

### Tier 2: excluded now, worth a legal look before opening up

Excluded at launch on the basis that the law has moved more than once, **not on
a current legal reading**, because the field is editable and re-opening a market
is cheap:

Bangladesh, Nepal, Algeria, Egypt, Qatar, Bolivia, Morocco.

Whoever wants one of these opened should get a current answer for that specific
country rather than a general one. Nothing here blocks the build or the first
submission.

### The one place iOS differs from the Android decision

Android's D8 came with an asymmetry stated plainly: the exclusions bind the Play
listing only, because the direct APK is jurisdiction-blind and reaches every
excluded country. **iOS has no direct lane at all** (§7 names alternative
marketplaces a non-goal, and there is no sideload path), so these exclusions are
the whole story on this platform. The wallet is simply not available in an
excluded storefront, which makes the iOS list the more consequential of the two
even though it is the same list.

## Age rating questionnaire

| Question | Answer |
|---|---|
| Unrestricted web access | **No.** The app embeds no general-purpose browser. External links open in the system browser |
| Gambling, contests | **No** |
| Simulated gambling | **No** |
| Horror, violence, mature themes | **No** |
| Medical, drug references | **No** |
| Frequent/intense profanity | **No** |

Expected rating 4+. If the DEX surface is ever submitted (D2), re-answer the
questionnaire rather than assuming it carries over.

## Screenshots

Simulator-generated, which the responsive UI makes cheap. **iPad is mandatory,
not polish**: the app ships universal (D6), and a missing iPad set blocks
submission rather than degrading the listing.

**Generate both sets with one command** :

    packages/mobile/scripts/screenshots.sh

It builds at the `store` profile and REFUSES to run against a `default`
bundle, because a listing image showing a surface the shipped store build
compiles out is a §2.3 rejection all by itself, and nothing about such a
screenshot looks wrong. It uninstalls the app before each run, since the
wallet persists onboarding and a second run would otherwise photograph an
already-open wallet. Output lands in `packages/mobile/screenshots/<device>/`.

⬜ iPhone set, largest current required size (confirm the exact pixel set in
   App Store Connect at submission; Apple changes it)
⬜ iPad set, largest current required size
⬜ ** fixed first.** The current sets show app chrome under the iOS
   status bar on both idioms. Re-run the harness after the safe-area fix
⬜ Same four scenes on both idioms: balances, receive with QR, send
   confirmation, and Settings showing Face ID unlock
⬜ **No screenshot may show a mainnet address holding real funds.** Use the
   demo data convention; testnet only
⬜ Rehearse the §2 demos on both idioms before submission, since iPad is a
   review surface too

## Review notes (the free-text field the reviewer reads)

    XChain Wallet is a non-custodial cryptocurrency wallet from Dankest, LLC,
    an enrolled organization. Keys are generated on the device, encrypted with
    a user-chosen password, and stored in the iOS Keychain marked
    ThisDeviceOnly and non-synchronizable. There is no account system, no
    server-side custody, no exchange, no mining, and nothing is sold in the
    app.

    This build is a wallet, not a wrapped website. Native integrations you can
    verify on device:

      * Keychain-backed vault with a Face ID / Touch ID access control. Turning
        Face ID on in Settings, then backgrounding and reopening the app,
        raises the system biometric prompt before the wallet is readable.
      * Native camera QR scanning (Receive and Send both scan).
      * Offline transaction signing. See the airplane-mode demo below; it is
        the quickest way to confirm the private keys are on the device.
      * Universal Links on xchain.io.
      * App-switcher privacy: the window is covered when the app resigns
        active, so the recovery phrase cannot land in the snapshot cache.

    Demo steps (about three minutes):

      1. Open the app and choose "Import wallet". Enter the recovery phrase
         below and any password. The wallet opens on the balances screen.
      2. The wallet is already set to a public test network, so no real funds
         are involved. Balances are read from a public blockchain indexer; no
         account is involved.
      3. Tap Receive. The app shows an address and a QR code. Tap the camera
         icon to scan one; this uses the device camera directly.
      4. **Turn on Airplane Mode.** Tap Send, enter the address shown below and
         any small amount, and confirm. The app builds and SIGNS the
         transaction on the device and shows you the signed result. It cannot
         broadcast it, and says so. Turn Airplane Mode off and the same signed
         transaction broadcasts. Nothing about the signing step needed a
         server.
      5. Settings > Networks shows the network selector used in step 2, and
         Settings > Privacy shows the two switches that turn off the only
         third-party requests the app makes.

    The app is open source under AGPL-3.0-or-later.

**Rules this text obeys, and must keep obeying:**

- It never mentions regtest, and it never asks a reviewer to reach anything
  private. App Review cannot reach regtest.
- There is no review-only configuration and no review detection anywhere in the
  build. An app that behaves differently for a reviewer is the 2.3.1
  termination pattern, and termination takes desktop notarization with it.

## Demo account (the App Review "Sign-In Required" section)

There is no sign-in, so the account fields stay empty and the demo wallet goes
in the notes. Fill at submission:

    Network:          testnet
    Recovery phrase:  <FILL AT SUBMISSION - testnet only, never mainnet>
    Password:         <FILL AT SUBMISSION>
    Send-to address:  <FILL AT SUBMISSION - a testnet address we control>

**Burn it.** The seed is public the moment it enters review notes. One seed per
submission, never reused across stores or releases: a shared seed is a mutable
resource two concurrent reviewers can race into a "does not work" rejection.
Fund it, and check the balance again on the morning of submission.

---

## Pre-submission gate

**✅ The demo path works. Was RED, fixed 2026-08-01.**

First health-check of the named endpoints found every host in the `xchain.io`
zone returning 403 to any non-browser client. Root cause was **Super Bot Fight
Mode** blocking anything that does not fingerprint as a browser, confirmed at
the rule level (Ray `a24891a01a662f46` -> ruleset "Bot Fight Mode for Definite
Bots", rule "manage definite bots"), and it surfaced because a Cloudflare
load-balanced hostname is always proxied. Fixed with a scoped Skip rule; see. Current state, measured:

    200  https://explorer.xchain.io/BTC/api/status
    200  https://hub.xchain.io/api/v1/chain-registry   (real JSON, 9817 bytes)
    200  https://xchain.io/

Keep the check anyway. It caught a live functionality-rejection risk that no
test in this repo could have, and the same class of edge change can recur: records that these hosts are reachable because rate limiting is
skipped for them, not because the limits are survivable.

Every submission, in this order:

⬜ `node tools/release/verify-demo-endpoints.mjs` exits 0. It is the health
   check this row used to describe in prose, built 2026-08-02: probe list
   derived from the shipped descriptors, and a 200 is not accepted on its own
   (hub signature verified, explorer must serve the demo's coin, encoder's
   tracker must be reachable and synced). **Exit 3 is not a pass**: it means
   something could not be reached, so re-run from a network you trust before
   deciding. `--burst 8` for the rate-limit residual
⬜ `npx vitest run test/unit/mobile/wireAudit.test.js` green, and
   `PRIVACY_NUTRITION_LABELS.md` matches what it asserts
✅ **D9 answered 2026-08-02** (this row previously said "D8", which is the
   Android number for a different question): the labels and the Play Data
   safety form now give the same answer, Data Not Collected, on the same
   measurement. settled
⬜ `node tools/release/verify-privacy-url.mjs` exits 0. It checks the deployed
   TEXT, not just that the URL resolves, which is the distinction was
   about. Green 2026-08-02; re-run it every submission, because the page can go
   stale again the moment the policy is edited. **Exit 4 is not a failure:** it
   means live and current, but a contact address the policy publishes is
   JavaScript-gated at the edge ( S20). Submit anyway and fix the edge
   setting; the script prints both ways out
⬜ Demo seed funded, balance checked, and never used before
⬜ Demo rehearsed end to end on an iPhone **and** an iPad, including the
   airplane-mode step
⬜ Pending App Store Connect agreements accepted (they silently block uploads)
⬜ The submission window announced in the ledger, so a concurrent session does
   not reset a venue mid-review

## TestFlight

- Internal testers get builds immediately, with no review.
- External testers need **Beta App Review on the first build of each version**.
  Usually hours, occasionally a real review: a recurring clock, not a one-time
  gate.
- **Builds hard-expire 90 days after upload.** No other channel has this clock.
  Either a re-upload cadence is a named duty or the lapse is a deliberate
  decision; drifting into it is what turns a beta channel into a dead one.
- This is the pre-submission QA venue for the demos above. Rehearse there, not
  in the simulator, because the reviewer is on a device.

## Release control

- Every submission uses **"Manually release this version"**. Automatic release
  on approval is never enabled: approval lands at Apple's whim and must not
  ship a wallet ahead of its encoder (encoder first, always).
- Phased Release is ON for updates, and understood as partial cover: it
  throttles automatic updates only. Manual updates and new installs get the new
  build immediately.
- **The App Store has no rollback.** A bad build can only be paused and
  superseded through another review cycle. Any vault or storage migration must
  therefore be in-app reversible or forward-compatible, and a fix must never
  exist only on the faster surfaces while iOS users sit on a corrupting build.

## Still gated on the Apple account ()

Nothing above needs the account. These do, and are S5b:

- Entering any of it into App Store Connect, which does not exist until
  enrollment completes
- The app-record creation that pins the bundle ID
- TestFlight itself
- The AASA file's contents, which need the Team ID ()
