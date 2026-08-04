# @xchain-wallet/mobile

Capacitor shell for XChain Wallet. It wraps the **same built SPA the web shell
ships** and adds native seams; it contains no UI of its own and must never grow
any. One Capacitor project holds every mobile platform: `android/` and `ios/`.

Spec: `claude/specs/wallet-publishing-android.md`  in the platform repo.
Release rails: `claude/specs/wallet-release-rails.md` .

## What is here today (stage S1)

⬜ → ✅ Scaffold, wired to the web build, with the store-facing numbers pinned:

✅ Capacitor project + generated `android/` native project  
✅ `applicationId io.xchain.wallet.android` (**D1**, revised 2026-07-31: one suffix per shell under the `io.xchain.wallet` parent)  
✅ `minSdkVersion 26` / Android 8 (**D2**)  
✅ `versionCode` / `versionName` derived from the release tag alone (§7)  
✅ Smoke CI workflow: unsigned AAB + universal APK on tags and on PRs that
touch this package

✅ Generated `ios/` native project (** S1**), with:
`PRODUCT_BUNDLE_IDENTIFIER io.xchain.wallet.ios` (**iOS D1**), deployment target
**iOS 16** (**D5**, in the project *and* `Package.swift`), universal device family
(**D6**), camera + Face ID usage strings, the `xchain:` scheme as inbound
compatibility only, `applinks:xchain.io` in `App/App/App.entitlements`, default
App Transport Security, and the export-compliance flag. Pinned by
`test/smoke/shells/mobile-ios-shell.smoke.js`.

> **Two ids, one config key.** Capacitor has a single `appId`, and it is the
> Android one. `cap add ios` seeds the Xcode project from it, so a regenerated
> iOS platform comes back saying `io.xchain.wallet.android`. After any
> `cap add ios`, reset `PRODUCT_BUNDLE_IDENTIFIER` in both build configurations;
> the iOS smoke asserts both ids in opposite directions so the seam stays open
> and visible.

> **The iOS version numbers now come from the tag** ( S4a, 2026-08-01).
> `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` are gone from the pbxproj
> entirely and are read from the generated, git-ignored `ios/App/Version.xcconfig`
> instead, so there is no template `1.0`/`1` left to upload by accident. Both
> stores share one integer now that is settled, and iOS's proposed
> dotted re-upload suffix was deleted in favour of the formula's respin band.

SPM, not CocoaPods: the project is generated with `--packagemanager SPM`, so a
Mac needs Xcode but no `pod`.

✅ **S2:** the `XChainVault` plugin (Keystore AES-256-GCM vault blob + kdfParams
meta, atomic writes, ABSENT/LOCKED/CORRUPT statuses) and biometric unlock
(BiometricPrompt Class 3, auth-per-use, sidecar wrap)

✅ **S3:** deep links (auto-verified App Links on `https://xchain.io/wallet/link/`
plus inbound `xchain:`, delivered by the `XChainLinks` plugin with a
cold-start queue), the camera permission for the shared QR scanner, UR input
bounds, and `tools/release/android-ceremony.sh`

> The App Link prefix is `/wallet/link/`, the same range the iOS association
> file claims and the shared parser unwraps. The wider `/wallet` it used to
> claim also caught `/wallet/privacy/` and `/wallet/support/` - the URLs both
> store listings publish - so a reviewer tapping either got the app instead of
> the page ().

✅ **S4:** shell hardening (no cloud backup or device transfer, cleartext refused,
R8 pinned off, no WebView debugging), route-scoped FLAG_SECURE, the capability
floor checked before React mounts, the hardened update-notice client, and the
listing pack under `docs/`

**All four build stages are done.** What remains is operator-side (S0):
D-U-N-S, Play enrollment, and the K9/K10 key ceremony, which is also what
unblocks the assetlinks fingerprints and the `SECURITY.md` slot.

> **No App Link has been verified end to end.** That needs a signed build, a
> published `assetlinks.json` carrying real fingerprints, and
> `adb shell pm get-app-links io.xchain.wallet.android`. The failure mode is
> silent: an unverified link just opens in the browser.

> **The Java compiles as of 2026-08-01.** This Mac is now the provisioned
> release machine (Homebrew `openjdk@21`, Android platform 36 + build-tools 36,
> bundletool) and `./gradlew bundleRelease` passes. The first build paid for
> itself twice: it found a real compile error in `VaultStore`, and it found an
> exported `ProfileInstallReceiver` that `androidx.profileinstaller` merges in
> transitively, so the shipped manifest had two exported components while this
> source tree had one. Both are fixed, and CI now re-checks the count against
> the BUILT bundle, because no source-level assertion can see what the merger
> adds.
>
> **It has now run on Android (2026-08-01).** The §7 emulator matrix (API 26 +
> API 36, `google_apis` arm64) is stood up, and it found two things reading had
> not: the wallet was a **blank white screen on its own `minSdkVersion`**
> (Chromium 58 ignores `<script type="module">` silently, so the bundle - and
> with it the capability floor that exists for exactly that device - never
> ran; fixed by `packages/web/public/boot-check.js`, a pre-bundle ES5 tier),
> and **one deep link reached the SPA twice** (a retained cold-start event
> replayed to the listener attached right after the queue was read; fixed to
> queue XOR notify). BiometricPrompt has now been shown and the whole SSC-3
> lifecycle driven; FLAG_SECURE has taken effect; the vault's
> ABSENT/OK/CORRUPT statuses are measured rather than asserted. Report:
> `claude/reports/2026-08-01_xc999-android-emulator-first-run.md`.
>
> **Two things an emulator cannot tell you.** `setWebContentsDebuggingEnabled(false)`
> cannot be checked on any `google_apis` image (`ro.debuggable=1` makes WebView
> expose DevTools for every app regardless), and no App Link has been verified
> end to end - that needs a signed build, a published `assetlinks.json` with
> real fingerprints, and `adb shell pm get-app-links`, which today reports
> `xchain.io: legacy_failure`. Both need the physical device §7 names as a
> release gate.
>
> **Rebuilding for a device: `pnpm --filter @xchain-wallet/mobile build` stages
> `www/` only.** The APK reads `android/app/src/main/assets/public`, which only
> `cap sync android` populates, so a build without it silently ships the
> previous web assets.

### Where the mobile JS actually lives

`packages/web/src/storage/`, not here. This package ships no JavaScript of its
own on purpose (`www/` is the web build verbatim), so anything that must run
inside the SPA has to be in the SPA's bundle; the alternative, web importing
mobile, is a dependency cycle. Those files are written shell-agnostically -
`nativeVault.js` defines the plugin contract the iOS shell implements over the
Keychain.

| File | Role |
|---|---|
| `nativeVault.js` | plugin detection + the status contract (`ABSENT`/`OK`/`LOCKED`/`CORRUPT`) |
| `CapacitorStorageBackend.js` | vault blob + kdfParams meta over the bridge |
| `backends.js` | picks native vs IndexedDB once; publishes the wipe hook |
| `nativeBiometricProvider.js` | the biometric provider core's shared UI calls |
| `../deeplinks/nativeDeepLinks.js` | App Link / `xchain:` intake, feeding the shared `?uri=` handler |

## Build

```bash
pnpm install
pnpm -r build                                   # web first, then this package
pnpm --filter @xchain-wallet/mobile sync        # stage assets + cap sync android
cd packages/mobile/android && ./gradlew bundleRelease
```

`pnpm --filter @xchain-wallet/mobile build` is Node-only: it copies
`packages/web/dist` into `www/` verbatim and writes `android/version.properties`
from the tag. That is why it can run in the ordinary CI lane, which has no JDK.

The Gradle build additionally needs **JDK 21** and the Android SDK
(compileSdk 36). Neither is installed on the release Mac by default, so the
native build is exercised by `.github/workflows/mobile.yml` on a Linux runner
until the release machine is provisioned (§6).

### Versions come from the tag, never from a counter

```bash
node scripts/version.js v0.333.1        # -> 3330150 0.333.1
XCHAIN_RELEASE_TAG=v0.333.1 pnpm --filter @xchain-wallet/mobile build
```

`storeVersion = MAJOR·10⁷ + MINOR·10⁴ + PATCH·10² + BUILD`, owned by rails §2
and shared by both stores: Android reads it as `versionCode`, iOS as
`CFBundleVersion`. BUILD is banded so the three kinds of upload sort correctly
in one field: `-beta.N` takes 1-49, a stable release takes 50, and `-respin.N`
(a re-upload of identical source after a metadata rejection or a burned
upload) takes 51-99. Betas have to sort BELOW the stable they precede or Play
will not move a closed-track tester up to production. A hotfix is not a respin:
it changes code, so it bumps PATCH.

Without the tag the build numbers itself from `package.json`, which is the same
value the tag will carry. Both generated files are git-ignored:
`android/version.properties`, whose absence fails the Gradle build rather than
falling back to a default, and `ios/App/Version.xcconfig`, which is the only
place the Xcode project gets a version from (the pbxproj carries no literal to
fall back to). A default build number uploaded once is spent for the life of
the app on both stores.

## Rules this package lives by

- **No second SPA build.** `www/` is a verbatim copy of `packages/web/dist`;
  `test/smoke/shells/mobile-shell.smoke.js` hashes both trees against each
  other. A bundler here would mean two sets of shipped bytes and two CSPs.
- **Plugins arrive one at a time, with the feature that needs them.** Any script
  running in the WebView can call every registered Capacitor plugin, so the
  plugin list *is* the native attack surface (spec §1). `plugins` in
  `capacitor.config.json` is empty and stays that way until S2/S3 need entries.
- **One exported component.** The launcher activity, and nothing else. Enforced
  by the smoke.
- **No keystore ever enters this repo or a CI runner.** K9 (Play upload) and
  K10 (direct APK) are custody rows in the key-rotation runbook; K10 cannot be
  rotated at all. Release artifacts are built *and* signed in the maintainer
  ceremony (§7).
- **No Firebase / Play Services.** The template's google-services wiring was
  removed, not left inert; push notifications are an explicit non-goal.
