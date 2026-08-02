# Google Play submission runbook (XChain Wallet, Android)

**Item:** §6. Written 2026-08-02.
**Reads with:** `PLAY_ENROLLMENT.md` (getting the account, done), `PLAY_LISTING.md`
(the listing text), `DATA_SAFETY.md` (the form answers), `store-assets/play/`
(the graphics), `tools/release/android-ceremony.sh` (the build), and
`claude/specs/wallet-publishing-android.md` §6 and §7.

The enrollment doc ends where this one starts: the account exists, it is
identity-verified, and K9 and K10 were generated on the release machine on
2026-08-01. What has never happened is an upload.

---

## Ground rules

1. **Nothing launch-critical waits on a Play review clock.** First reviews of a
   wallet can take days and can draw a manual reviewer. The direct APK lane is the
   contingency channel and it never waits (§6).
2. **The bytes you upload were built and signed at the ceremony, not by CI.** CI
   builds the same two artifacts unsigned as a health check and nothing it produces
   is ever published (§7). If you are holding an artifact you did not watch get
   signed, stop.
3. **Fill no form from memory.** Every answer is in this repo. If a console field
   has no in-repo answer, that is a gap to register, not a field to improvise.
4. **The `applicationId` and the first upload's `versionCode` are permanent.**
   `io.xchain.wallet.android` cannot change after publishing, and Play refuses a
   duplicate `versionCode` even on the internal track: a replaced upload means a
   NEW TAG (`vX.Y.Z-respin.N` on the same commit), never a hand-edited number.

---

## Phase 0: the blocking gate

Do not open a store form until every row here is green. Measured from the release
machine on 2026-08-02 with cache-busting query strings and an empty user agent.

| # | Precondition | State 2026-08-02 |
|---|---|---|
| 0a | Play developer account, org, identity-verified | ✅ done 2026-08-01 |
| 0b | Hardware-key 2FA on the console account (K8) | 🟡 **passkey in place 2026-08-02; two hardware keys ordered, not yet enrolled.** Finish when they arrive: enrol both, then remove SMS/Authenticator fallback |
| 0c | K9 + K10 exist on the release machine | ✅ done 2026-08-01 |
| 0d | K10's sealed offline copy | ⬜ **operator, still owed** (K10 was generated online by decision; the offline copy is now the only protection against losing it) |
| 0e | Privacy policy at a fetchable public URL | ⚠️ URL exists (`https://xchain.io/wallet/privacy/` → 200) but the **deployed text is stale**; see below |
| 0f | Country availability decided (D8) | ✅ **decided 2026-08-02: worldwide minus named exclusions**, list in `PLAY_LISTING.md` |
| 0g | Data safety answers settled | ✅ settled 2026-08-02 |
| 0h | `verification-metadata.xml` committed | ⬜, reviewed, awaiting the commit |

### 0e: the URL, and the thing that is actually wrong with it

**The URL to enter is `https://xchain.io/wallet/privacy/`** (trailing slash; the
un-slashed form 301s). It returns **200** to a plain non-browser client, it is the
URL the Chrome listing already publishes, and it is the default in
`test/smoke/audits/privacy-url-check.smoke.js`. All three store forms naming one
URL is the point.

Two candidates that were on record and should not be used: `https://dankest.llc/privacy`
**404s** (that host serves `.html` URLs and has no extensionless rewrite - `/about`
404s while `/about.html` is 200, so `privacy.html` is its real page), and
`https://xchain.io/privacy` 404s. `PLAY_ENROLLMENT.md` recorded the first of those
as "the privacy policy still needs publishing", which was a URL shape mistaken for
a missing page. The Cloudflare 403 that pushed the choice to `dankest.llc` in the
first place no longer reproduces either ().

**⚠️ The real blocker is the CONTENT, not the URL ().** Fetched and read
2026-08-02, the live page is the **pre-correction** policy: it is dated 1 August
2026 and says the wallet's first-party hosts log "your IP address … kept for 14
days". `docs/Privacy_Policy.md` in this repo says the opposite, on the strength of
a measurement taken the next day: those hosts sit behind Cloudflare, so the address
written into our logs is **Cloudflare's, not the user's**, and the explorer log is
kept for **one day**, not fourteen.

That correction is **uncommitted**, so it is not deployed. And `DATA_SAFETY.md` and
`PRIVACY_NUTRITION_LABELS.md` were both rewritten against the corrected reading when was settled. So filling the forms today would put answers derived from the
new measurement in front of a reviewer who fetches the old text - which is exactly
the form-versus-policy mismatch §5 calls a rejection class, and a credibility hit
for a privacy-forward wallet.

**And it is not simply "commit and deploy", which is what this said first.** That
file's own header reads `DRAFT, not yet publishable`, and one question is still
open in `docs/Data_Collection.md`: **Q3, whether a GDPR lawful-basis statement or
a CCPA notice is required**, which depends on where the company operates and
where the apps are listed. Publishing the corrected text while that section is
missing trades a stale accuracy problem for a fresh completeness one.

**Order of operations:**

1. Answer Q3 (operator/legal). It is the last open question in
   `docs/Data_Collection.md`.
2. Drop the DRAFT header from `docs/Privacy_Policy.md` and commit it.
3. Deploy to `xchain.io/wallet/privacy/`.
4. Re-fetch and confirm the live page says "we do not keep your IP address" and
   is dated 2 August 2026 or later.
5. Only then open the store form.

**0b and 0d are the two custody rows, and they are the ones a schedule quietly
eats.** §4 calls the console account the worst compromise in the table: an attacker
inside it can reset the upload key and ship a malicious update to every Play
install.

---

## Phase 1: build and sign (the ceremony)

Run on the release machine, at a keyboard, with the tree clean and HEAD on the tag.
The script refuses otherwise, and refuses to run in CI at all.

```
export XCHAIN_K9_KEYSTORE=...   XCHAIN_K9_ALIAS=...
export XCHAIN_K10_KEYSTORE=...  XCHAIN_K10_ALIAS=...
bash tools/release/android-ceremony.sh --tag vX.Y.Z --output release-artifacts/X.Y.Z
```

No password is passed on a command line or read from the environment: `jarsigner`
and `apksigner` prompt, or read a 0600 file **by path**. That is what makes it a
ceremony rather than a script.

It produces, into the output directory:

| File | Signed by | Where it goes |
|---|---|---|
| `xchain-wallet-android-vX.Y.Z.aab` | K9 | Play only. **Never hosted publicly.** |
| `xchain-wallet-vX.Y.Z.apk` | K10 | `downloads.xchain.io/wallet/android/` |
| `PROVENANCE.txt` | - | beside the bytes, every run |
| `DO-NOT-PUBLISH.txt` | - | only on `--rehearsal` |

The APK is derived from **that same bundle** with `bundletool --mode=universal`,
never a second build, so the two files are provably the same code.

Then run `tools/release/sign.sh` over the output directory so both artifacts land
in `RELEASE_HASHES` and the GPG manifest. Both names are declared in
`tools/release/expected-artifacts.txt`; an artifact whose name matches no declared
line is a hard failure there, not a cosmetic mismatch.

**Before you upload, check the bundle is what you think it is:**

```
bundletool dump manifest --bundle xchain-wallet-android-vX.Y.Z.aab
```

Expect `package="io.xchain.wallet.android"`, the `versionCode` that
`node packages/mobile/scripts/version.js vX.Y.Z` derives, `allowBackup="false"`,
`usesCleartextTraffic="false"`, exactly one exported component, and exactly four
permissions.

---

## Phase 2: the console forms

Every answer is in this repo. Copy, do not compose.

| Console field | Source |
|---|---|
| Store name, short + full description | `PLAY_LISTING.md` |
| Categorization, contact details | `PLAY_LISTING.md` |
| Trader declaration (EU DSA) | `PLAY_LISTING.md`, and it appears publicly on the listing |
| Financial features declaration | `PLAY_LISTING.md` |
| Review notes + App access credentials | `PLAY_LISTING.md` (demo wallet is regtest/testnet, never a funded mainnet wallet) |
| Data safety form | `DATA_SAFETY.md` |
| Privacy policy URL | Phase 0e |
| Country availability | D8, Phase 0f |
| Icon, feature graphic, screenshots | `store-assets/play/` (see its README for provenance) |

Two things in `DATA_SAFETY.md` are easy to get wrong under form pressure and are
written down there for that reason: the **issuer-chosen token metadata host**, which
is a third-party contact that is ON by default, and the **update feed**, which is
declared even though a Play-installed build never requests it ().

---

## Phase 3: internal track

Upload the AAB to **internal testing** first. This is the cheapest place to discover
that the console rejects something about the bundle.

Immediately after the first upload, do the thing that only becomes possible now:

**Read Google's app-signing certificate.** Play App Signing is mandatory for new
apps, so Google generates its own signing key on first upload and re-signs
everything it serves. Console → Test and release → Setup → App signing → copy the
**SHA-256 certificate fingerprint** of the *app signing key* (not the upload key).

That fingerprint is the missing half of `packages/mobile/assetlinks.template.json`,
which ships with K10's real fingerprint and a placeholder where Google's goes. Phase
6 is what it unblocks.

Then: install from the internal track on a real device and smoke it. §7 names a
**physical device** as a release gate for two things an emulator structurally cannot
check: biometric optics, real-camera QR, and
`setWebContentsDebuggingEnabled(false)` (every `google_apis` emulator image sets
`ro.debuggable=1`, which starts a DevTools server for every app regardless of the
flag, so the emulator always looks like a failure there).

---

## Phase 4: closed track (the beta cohort)

Promote the same bundle. This is the Android face of the rails D1 beta channel.
Beta tags sort **below** the stable they precede, which is the ordering Play needs
to move a closed-track tester up to production.

---

## Phase 5: production, staged

Promote at a staged rollout percentage, and **name the halt lever in the incident
runbook before you start it**: halting a staged rollout is the only Play-side
incident control that exists.

---

## Phase 6: close the App Links loop

This can only happen now, and it is the last open item in §7's verification list.

1. Fill Google's app-signing SHA-256 (Phase 3) into
   `packages/mobile/assetlinks.template.json`, beside K10's, which is already real.
   Both fingerprints under the one `applicationId`, per D3(a).
2. Publish it at `https://xchain.io/.well-known/assetlinks.json`. It is a
   websites-repo deploy with its own owner. The file is extensionless, so it needs a
   `ForceType application/json`, and the edge must serve `/.well-known/*` to an
   unauthenticated client because **Android fetches it with its own client, through
   Google's infrastructure, not from the user's browser**.
3. Verify on a signed install:

   ```
   adb shell pm get-app-links io.xchain.wallet.android
   ```

   Expect `verified`. The failure mode is silent: links simply open in the browser
   with nothing anywhere saying why.

**Measured 2026-08-02 from the release machine:** `https://xchain.io/wallet` returns
200 and `https://xchain.io/.well-known/assetlinks.json` returns **404, `cf-cache-status:
DYNAMIC`** - the origin is reached and the file is genuinely absent, which is the
correct answer today. The blanket 403 that registered no longer reproduces.
Two caveats before ticking anything: nobody knows *why* it changed, so it could revert
as quietly as it arrived; and a 200 from this machine is not Android's verifier.

---

## Phase 7: the direct lane

Publish the APK and its GPG-signed manifest under `wallet/android/` on
`downloads.xchain.io`, **after** the staged rollout reaches 100% or on an explicit
operator promote. That gate exists only so the direct lane never receives a release
the Play lane could still halt; it orders steps within one release and never drops
or delays one. Whenever Play stalls, rejects or suspends, the promote is the normal
path.

Publish beside it:

- the K10 certificate SHA-256 and the one-liner users actually run:
  `apksigner verify --print-certs xchain-wallet-vX.Y.Z.apk`. `SECURITY.md`'s copy is
  canonical; the download-page copy is convenience, because a fingerprint served by
  the same origin as the file is circular under origin compromise.
- **`latest.json`, and only after the APK is in place.** It is the direct lane's
  only update channel (); the template and its ordering warning are at
  `packages/mobile/latest.json.template`. A feed naming a version nobody can
  download is an alarm with no exit.

Measured 2026-08-02: `https://downloads.xchain.io/wallet/android/latest.json`
returns 404 `DYNAMIC`, so the origin is reachable and will serve the file once it
is placed there.

**There is no halt, no rollback and no downgrade on this lane.** Android forbids a
versionCode regression without an uninstall, and an uninstall wipes the vault. The
remedy for a bad direct release is a signed advisory plus a fixed higher-versionCode
build plus the feed notice. Nothing else exists.

---

## What this runbook deliberately does not cover

- Getting the account (that is `PLAY_ENROLLMENT.md`).
- What the listing says (that is `PLAY_LISTING.md`).
- The iOS lane, which is and a different set of clocks.
- Anything about the Play Console UI more specific than a menu path. Console
  navigation changes faster than this file can, and a stale click-path reads as
  authority.

## Open decisions this runbook is waiting on

| Decision | Blocks |
|---|---|
| D7 whether K7 (Chrome) and K8 (Play) share one Google identity | account hygiene, not this release |
| the direct APK is declared `store`, so it ships the store feature set | Phase 7's download-page copy, which must say so if the answer is "accept it" |
| committing `verification-metadata.xml` | the supply-chain control protects one machine until it lands |
