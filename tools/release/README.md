# Release-signing pipeline - `tools/release/`

Spec reference: `claude/reports/xchain-wallet/XCHAIN_WALLET_SPEC.md` §51.
Release-engineering rails shared by every shell (versioning, channels,
credential inventory, CI matrix, the full release procedure and its
rollback story): `claude/specs/wallet-release-rails.md`.

This directory holds the scripts and conventions for cutting a signed
release. The gates all run today, and as of 2026-08-06 so does the
signing step: the maintainer's release key exists and its fingerprint
is published in `SECURITY.md`. `sign.sh` still exits with a clear error
when `XCHAIN_RELEASE_GPG_KEY` is unset, which now means "this run was
not told which key to use" rather than "there is no key". What is left
of G180 (in `claude/reports/xchain-wallet/SPEC_GAPS.md`) is publication
reaching a reader, which is a deploy rather than a key.

The companion verification side lives at [https://docs.xchain.io/components/wallet/release/verify-release](https://docs.xchain.io/components/wallet/release/verify-release) -
end users follow that recipe to verify what this pipeline produces.

---

## Inputs

The pipeline expects a built artifact directory. What may and must
appear in it is not prose: it is declared in
[`expected-artifacts.txt`](expected-artifacts.txt), which `sign.sh`
enforces before it writes a manifest. Each declared artifact also names
its **build profile** - `default` (web, desktop, extension) or `store`
(the mobile builds, which compile out the surfaces app-store review
posture hides) - and that mapping is written into the signed manifest,
one `# profile <name>: <artifact>` line each, so two artifacts of one
tag holding different code are distinguishable in the record (rails §3).
The manifest format itself is documented at the top of
[`lib.sh`](lib.sh), which both `sign.sh` and `verify.sh` source.

Each row also declares the **architectures** it must cover, and that
column is not cosmetic: the globs below are extension-shaped, so `*.dmg`
is satisfied by ONE dmg, and the release where all six lanes built a
single arch (§8 below) passed this gate with a clean manifest. Every
declared arch must now be present, and an artifact that matches an
arch-partitioned row while carrying no arch token at all is a hard
failure rather than a default-arch guess: a broken `artifactName` and a
deliberately multi-arch file look identical from here. `-` declares "not
arch-partitioned" out loud.

The one known multi-arch file, electron-builder's un-suffixed both-arch
NSIS installer, is not shipped (operator 2026-08-01) and is
suppressed at the source by `nsis.buildUniversalInstaller: false`. No row
declares the `multi` allowance, so if one ever reaches staging, that flag
has been lost and the release fails here rather than growing a third
installer on the feed.

- `*.dmg` / `*mac*.zip`     - desktop macOS (x64 + arm64)
- `*.exe` / `*win*.zip`     - desktop Windows (x64 + arm64)
- `*.AppImage` / `*.deb`    - desktop Linux (x64 + arm64)
- `xchain-wallet-extension-vX.Y.Z.zip`  - extension store bundle (its
  `manifest.json` permissions, `host_permissions`, and content-script
  matches are frozen against `packages/extension/docs/manifest-freeze.json`
  and gated in `pnpm test:smoke`; see that file and
  the [manual QA checklist](https://docs.xchain.io/components/wallet/release/qa-checklist) "Chrome Web Store release provenance" for the
  human diff step the freeze gate cannot replace)
- `xchain-wallet-web-vX.Y.Z.tar.gz`     - static web SPA bundle
- `xchain-wallet-android-vX.Y.Z.aab`    - Play upload bundle (K9-signed)
- `xchain-wallet-vX.Y.Z.apk`            - direct Android download (K10-signed)
- `xchain-wallet-ios-vX.Y.Z.ipa`        - App Store upload (dormant)

The mobile names are declared but optional: the Capacitor shells are
scoped post-v1.0 for both Android and iOS. They are pinned here so
both shells cannot invent divergent names later.

The two Android files are one build, not two: `tools/release/android-ceremony.sh`
produces the AAB and then derives the universal APK from that same bundle
with `bundletool --mode=universal`, so the store lane and the direct lane
ship identical code signed by different keys. Only the APK is hosted;
the AAB is hashed into the manifest as the record of what was submitted,
because Play re-signs and serves device-split APKs that cannot be verified
against our manifest at all.

Channel pointers (`stable.yml`, `stable-mac.yml`, `stable-linux.yml`,
`stable-linux-arm64.yml`) may sit in the same directory - they are
electron-updater's mutable pointers and are deliberately excluded from
the manifest (see "Manifest format" below). They are identified by
content, not by name: our channel is `stable`, so nothing is called
`latest` (§7.1).

Build invocation per shell is documented in `CONTRIBUTING.md` →
"Per-shell builds".

## Scripts

| Script | Purpose | Status |
|---|---|---|
| `lib.sh` | Shared manifest routines: which files a manifest covers, in what order, and what its header says. Sourced by the other scripts so they cannot drift apart. | Live |
| `sign.sh` | Run the release gates, compute the SHA-256 manifest, and GPG-sign it. `--lane <name>` signs a PARTIAL release covering only the named lanes. Gate DATA (`expected-artifacts.txt`, `shipped-lanes.txt`) and the dev-mock gate come from `--repo`, the tree at the tag; an executable check the release predates (`launch-probe.mjs`, `verify-signatures.mjs`) is run from THIS checkout instead, announced, because the alternative is no check at all (before that, signing any tag older than the newest check died on a `MODULE_NOT_FOUND` stack trace). | Live; needs `XCHAIN_RELEASE_GPG_KEY` (the key exists, G180's remaining half is publication) |
| `verify.sh` | Verify a manifest: hashes, header anchor, and GPG signature. Mirrors [https://docs.xchain.io/components/wallet/release/verify-release](https://docs.xchain.io/components/wallet/release/verify-release). A manifest whose tag is `<release>-resign<N>` anchors to `<release>` and is reported as a re-signature superseding what was published under that name; the reverse does not hold, so the superseded original cannot answer a request for the correction. | Live |
| `prepare-resign-tag.sh` | Cut a tag a published release can be RE-SIGNED from, when the defect was in the gate the tag itself supplies. Clones the release tag into a throwaway directory, replaces `tools/build-reproduce/check-no-dev-mock.sh` with the committed copy from this checkout (one file, and it refuses if the diff is wider), tags `<release>-resign<N>`, and PROVES it by running the new tag's own gate against the staged artifacts and requiring the receipt `sign.sh` requires. Refuses a source whose gate cannot read a staged bundle - measured behaviourally, since the gate that shipped with v0.336.0 does not reject `--artifacts`, it ignores it - and refuses a name whose X.Y.Z core is not the release's. Exits 0 cut and proved / 1 refused / 2 caller error / 3 nothing to prepare. Never pushes, never signs, never touches the checkout it runs from. | Live; driven end to end against the real v0.336.0 android set 2026-08-12 |
| `publish.sh` | §6 step 5: upload a signed release to the feed, channel pointers last, with an edge check between the two and a cache purge after. | Live (host pending) |
| `feed-sweep.mjs` | Runs on the feed host by cron: validates every published object against the union of the signed manifests, and every channel pointer against the bytes it names. | Live (host pending) |
| `rehearse.mjs` | §7.5: probes every shipped update lane against the staging feed (pointer, per-arch selection, download, sha512, signed manifest), records human-attested swaps, and gates the production publish on the result. Covers the direct Android lane too, by a second probe that drives the SHIPPED `directUpdateCheck.js` against the published `latest.json` in both directions and proves the APK its notice sends a user to is the one K1 signed. | Live (host pending) |
| `rehearsal-matrix.mjs` | The shipped update lanes and the named hardware each is smoked on (DD4). Two sets: `LANES` (electron-updater) and `DIRECT_LANES` (the sideloaded APK, whose feed carries a notice and no installer). Data, not code. | Live |
| `release-record.mjs` | The §6 release record, opened and enforced. `open --tag vX.Y.Z` instantiates `claude/reports/wallet-releases/vX.Y.Z.md` from `TEMPLATE.md` with the identity fields filled (store integers asked of `packages/mobile/scripts/version.js`, never recomputed from §2's formula) and never overwrites an existing record. `assert --tag` is the gate `publish.sh` runs before a production publish; an untouched copy of the template does not count. `coverage` checks that every `v*` tag AND the version the working tree declares have a record, and is run by `test/smoke/audits/release-record.smoke.js` inside `pnpm ci`. Exits 0 covered / 1 missing / 3 the records directory is not in this checkout. Tags whose commit declares a different version are reported, not failed: `release.yml`'s verify-tag refuses those, so they never produced a release. | Live, and gating since 2026-08-04 |
| `bump-version.mjs` | §6 step 1: write the release version into every place this repo declares it, in one pass. Membership is derived from the filesystem exactly as `test/smoke/audits/version-lockstep.smoke.js` derives it (the root `package.json`, every `packages/*/package.json`, the extension manifest's `version` and `version_name`, core's `WALLET_VERSION`, README's badge and Status line), so a package added tomorrow is reached without editing anything here. The CHANGELOG section is promoted from `## [Unreleased]`, and the tool REFUSES to bump while that section is empty: a release heading with no entries under it satisfied every gate in this repo and documented nothing. `--dry-run` prints the plan and writes nothing. | Live; driven by `test/smoke/audits/release-bump-version.smoke.js` |
| `deploy-web.sh` | §6 step 5b: verify the web tarball against the signed manifest, then unpack it into a versioned directory and flip a symlink. `--manifest` is required and `verify.sh` runs before anything is written (hash for this one artifact, tag anchor, signature bound to the release key), so the last hop of the web lane cannot serve bytes nobody signed. `--no-sig` forwards to `verify.sh`'s degraded mode for a webroot host with no gpg; there is no flag that skips the manifest. | Live |
| `expected-artifacts.txt` | The declared artifact set a release must contain. Data, not code. | Live |
| `verify-store.sh` | §4 post-publish verification: verifies the CI-built extension zip via `verify.sh`, then diffs it file-by-file against the store-served item (`--unpacked-dir` or `--crx`), skipping `_metadata/` and structurally diffing `manifest.json`. | Live |
| `manifest-diff.mjs` | Structural JSON diff helper for `verify-store.sh`: deep-equal ignoring named top-level keys (default `update_url`, `key`). | Live |
| `rollback-rerelease.sh` | §4 rollback-as-re-release recipe: validates preconditions and prints the manual re-release sequence. There is no rollback lever; see the script's own header. The new version must beat BOTH floors: the highest version in the repo's version-bearing set (which includes `packages/extension/manifest.json`, the only one the store reads) and the highest row in `publish-log.md`, read through the rogue-publish monitor's own `parsePublishLog`. The second floor is not redundant: the recipe tells the operator to work from a clone checked out at the good tag, where the repo is behind the store by construction. Exits 0 preconditions ok / 1 refused (no such tag, version not above the floor) / 2 caller error (no `--good-tag`, no `--new-version`, not a git checkout). A publish log that cannot be parsed is reported as could-not-tell and never as "nothing published". | Live, and driven end to end 2026-08-02 (S19); gated by `test/smoke/audits/rollback-rerelease.smoke.js` |
| `verify-privacy-url.mjs` | §5/D5 pre-submission check: is the public privacy-policy URL live, answering directly (no redirect hop), and serving the current [privacy policy](https://docs.xchain.io/components/wallet/privacy/privacy-policy) word for word. Compares prose, not bytes, since the hosted page is rendered Markdown. Exits 0 live / 1 not live, redirecting, or stale / 2 config error / 3 inconclusive (403, timeout, network - never folded into live) / 4 live and current but a contact address the policy publishes is JavaScript-gated at the edge (submittable; the store validates that the URL resolves and serves the policy, and it does). **Do not use `curl` for this instead: Cloudflare answers plain tooling with 403 on every path of this domain, live page or not.** (Correction 2026-08-02: that stopped being true when Super Bot Fight Mode was turned off; plain clients now get 200 zone-wide. The inconclusive-on-403 treatment stays, because the block can come back and this script must not report a false outage when it does. `verify-demo-endpoints.mjs` below deliberately takes the opposite view of a 403 on the API hosts, for a reason stated there.) Exit 4 exists because the script DECODES the edge's email obfuscation for its text comparison, which is right (the deployed bytes are innocent) but silent, and silence left the property unmeasured: the addresses are derived from the policy itself, and every run says whether each one is readable without JavaScript rather than only complaining when it is not. | Live, and green as of 2026-08-01: the apex flip landed and the URL serves the merged all-shells policy, confirmed through the edge in a browser and against the origin via `--html`. Takes operator-supplied bytes with `--html <file>` when Cloudflare 403s the host, the same way `verify-store.sh` takes a real store unpack rather than scraping |
| `verify-demo-endpoints.mjs` | §2.1 pre-submission gate: can a store REVIEWER reach the endpoints the scripted demo sends them to, from a plain client on no allowlist? Probe list is derived from `packages/core/src/registry/descriptors/`, never restated, and deduplicated by URL. A 200 is not a pass on its own: the hub's chain-registry Ed25519 signature is verified against the pinned federation key, the explorer must name the demo's coin in its `available` map, and the encoder's UTXO tracker must be reachable AND synced. Exits 0 live / 1 failure / 2 config error / 3 inconclusive (timeout, network - never folded into live). **403 is a FAILURE here, not inconclusive**: on these hosts it means the edge block is back, which is the regression this gate exists to catch. `--network mainnet`, `--json`, and `--burst [N]` for the bounded rate-limit probe (one request per host cannot see a 0.5 req/sec limit). **With no count, the burst size is MEASURED** by `cold-open-profile.mjs` below - the requests one wallet cold-open puts on the busiest single host - rather than the undefended 8 it used to be, and a CLEAN burst now reports what it measured: these hosts are on the zone's twelve-hostname rate-limit skip, so an unthrottled burst measures the SKIP and says nothing about the limit under it. No custom User-Agent, ever: looking like a browser defeats the point. **Every probe carries an `Origin` header and the reply's `Access-Control-Allow-Origin` is checked against it**, defaulting to `capacitor://localhost` (what the iOS store build sends) and re-pointable with `--origin`: the shipped app is a WebView with no native-HTTP bypass, so a service that answers this gate 200 and serves no ACAO is, to the app, down. A blocked origin is a FAILURE reported as `UNREACHABLE FROM THE APP`. The hub is probed twice for this reason - its chain-registry route is the one annotated cross-origin exception, so probing only that route hides a closed JSON-RPC surface. | **RED as of 2026-08-07, correctly, and this is what the CORS half was added for**: every probe was OK on 2026-08-02 and the demo still could not be performed. `encoder.xchain.io` serves no `Access-Control-Allow-Origin` on any path and neither does the hub's JSON-RPC surface, so the reviewer can read a balance and cannot send. Service health itself is green: registry signed, TBTC indexer current, all three encoder trackers synced at lag 0 |
| `cold-open-profile.mjs` | rate-limit sizing: how many requests does ONE wallet cold-open put on the xchain.io zone, and what must the two zone-wide Cloudflare rate limits be raised above before the twelve-hostname skip that currently suspends them can be narrowed? Answers the question `verify-demo-endpoints.mjs --burst` structurally cannot: a burst fired at a host ON the skip list measures the skip. The fan-out is DRIVEN out of the real `walletBalances`, coinpay and chain-registry flows against a real `SDKRegistry` and a real xchain-sdk, so it moves when they do; every request is recorded at the http/https socket layer and re-pointed at a refused port on loopback, so profiling the load never adds it. Reports per host, per step, and per zone rule, with the SDK retry multiplier and the poll cadence read from the app own constants. `--addresses N` models a wallet the user has added addresses to (the term is linear and nothing paces it); `--headroom N`, `--json`. Exits 0 every rule clears one cold-open / 1 a rule is set below it / 2 config. | Live, measured 2026-08-13 on testnet: a fresh three-chain wallet is 13 requests, 9 of them at `explorer.xchain.io`, 9 repeating every 20s while the wallet stays open. The General rule (1.5 req/sec = 15 per 10s) does NOT fit one cold-open once retries are counted; the API rule never sees the busiest traffic at all, because the wallet explorer paths are `/{COIN}/api/...` and that rule matches `/api/` |
| `verify-appstore-version.mjs` | Pre-submission gate for the half of the lane that lives on Apple's servers: would App Store Connect actually accept a submission? Reads the version record and writes nothing. Checks the version has a build ATTACHED (not merely uploaded), that it is VALID and unexpired, and that its store integer is what `packages/mobile/scripts/version.js` derives from the version string; `releaseType` is MANUAL per §5; all four App Review contact fields are filled, since those are a write lock on the whole page rather than a checklist item; the review notes Apple HOLDS carry the network-switch step and not the claim it replaced (§17's guard pointed at the console instead of the document); the per-submission demo seed is filled; both required screenshot sets are present and `COMPLETE`; the privacy URL is the canonical one the App Privacy form is published against; and the age rating accounts for what the binary ships, keyed on the same `HIDDEN_SURFACES` that `mobile-ios-shell.smoke.js` §16 reads so the two cannot drift. Exits 0 ready / 1 failure / 2 config / 3 inconclusive; failure outranks inconclusive. **The gambling answer reports LOUDLY and never fails**: it is a standing operator decision, re-read at submit, and a gate that vetoes a decision is a gate an operator routes around. **The unfilled demo seed is the one expected failure**, and when it is the only one the script says so rather than saying do-not-submit. Takes `APPLE_API_KEY` (or `APPLE_API_KEY_PATH`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. | Live, and driven against the real record 2026-08-06: exit 1 on the demo-seed placeholder alone, every other check green. Built because the uploaded build was NOT attached to the version and two consecutive runs had described the console as complete |
| `store-version-monitor.mjs` | §2 publish monitor: compares each configured item's live Chrome Web Store version against `packages/extension/docs/publish-log.md`; a live version with no matching log row is the rogue-publish (compromised-publisher) signal. Exits 0 clean / 1 alert / 2 config error (item id unset or log unreadable) / 3 inconclusive (fetch failure or unrecognized page shape - never folded into clean). Run `node tools/release/store-version-monitor.mjs --help` for flags and the origin-host cron line. | **LIVE on origin-host since 2026-08-10** for the Play and direct lanes (`--no-chrome`, every six hours); the Chrome lane stays disarmed until an item id exists (see the [manual QA checklist](https://docs.xchain.io/components/wallet/release/qa-checklist) "Chrome Web Store release provenance"). Before that install the host carried a Chrome-only copy behind a commented-out cron line and had **run zero checks**. **THREE lanes as of run 20, not two:** Chrome (version, against the publish log), Play (presence and identity; no version, because a Play listing does not publish one), and **direct** - the lane watching the only artifact this project has actually shipped to the public. The direct lane fetches `android/latest.json`, the signed manifest for the version it names, and the APK itself, and ALERTS if the served binary's SHA-256 does not match the digest its own signed manifest claims. It needs no absence latch, unlike Play: this lane is published now, so a 404 is always an outage rather than a "not yet". It does NOT verify the manifest's GPG signature - that needs a keyring and a trust decision, and a monitor that imports a key from the host it audits proves nothing - so verifying K1 stays the documented human step. Disable with `--no-direct`. |
| `phase4-rehearsal.mjs` | Row 89 ceremony Phase 4 rehearsal recorder: drives the signing preconditions against a tag tree, reports the deepest step reached, and pins that observation in `docs/phase4-rehearsal-pin.json` so a later stage can tell whether the signing path has moved since. Records BOTH refs a signing run reads from (scripts from the invoking checkout, lane roster and dev-mock gate from `--repo`), refuses to pin from a dirty signing path, and never claims the signature step, which needs K1 at a pinentry. `check` is the drift gate. | Live |
| `verify-signatures.mjs` | The signature gate, run by `sign.sh` BEFORE the manifest is written: does each staged artifact actually carry the OS code signature its row says it should? The ordering is the point, because K1 attests the bytes and not the publisher, so a manifest written over unsigned installers verifies perfectly forever and every downstream check agrees with it. | Live, and refusing: it is what stops `v0.336.0` being signed, on two unsigned macOS zips and two unsigned Windows installers |
| `launch-probe.mjs` | Row 144, the only release gate that RUNS an artifact instead of reading one: it launches the packaged app for the current host in a throwaway `--user-data-dir`, requires the process to still be alive after a few seconds with no crash banner in its output, then kills the process group and deletes the profile. Invoked by `sign.sh` after `verify-signatures.mjs` and BEFORE the manifest is written, for the same reason: once K1 has attested the bytes, an app that cannot start verifies perfectly forever. An artifact this host cannot launch (wrong platform, wrong architecture, no GUI session, no display) reports `NOT PROBED` by name and is counted apart from the passes, and a run that launched NOTHING prints a standing banner rather than an ok line. `--expect-log <regex>` (repeatable) additionally requires a pattern in the app's output; `--require-probed [n]` demands at least n real launches and is for CI, where the host and the lane match by construction. | Live. Driven against both real builds on 2026-08-11: `v0.339.0` arm64 passes, `v0.338.0` arm64 fails on the verbatim `Fatal process out of memory: Failed to reserve virtual memory for CodeRange` that reached users past every other gate |
| `verify-validated-commit.mjs` | §6 step 1 as a gate instead of a sentence: is this commit one that green CI already validated? Written as procedure and enforced by nothing until now, which is how the first release this project ever cut was tagged on a commit whose CI had not passed. Refuses a short SHA and a missing token rather than guessing. **`--wait` makes it §6 step 1b as well**: under the develop/master policy the tag is cut on master's MERGE commit, whose CI starts at merge time, so the gate polls (`--wait-timeout`, default 1800s) until every required workflow concludes. Waiting changes when it answers, never what it accepts: a concluded non-success refuses at once rather than being waited out, a timeout refuses, and a commit with no run at all refuses however long it waits. release.yml keeps the no-`--wait` fail-fast posture, because by the time a tag exists the ceremony has already waited. | Live |
| `verify-ci-controls.mjs` | Measures the PUBLIC release-CI page against the repository's live settings, because nothing else ever did: the page is what a reader uses to decide a release could only have come from an intentional run, and prose about settings drifts silently since the prose and the settings are edited in different places by different acts. One probe per control the page names (environment restricted to the release tag pattern, credentials environment-scoped, signed-tag requirement, artifact signature check, trigger surface, fork-run approval) plus the two absences the page states out loud, so a reviewer gate or tag ruleset quietly coming into existence is also red. A numbered section with no probe is the headline failure - that is how the page grows an unmeasured claim. Fail-closed: no `gh`, no token, an endpoint this plan tier hides, all refuse. Needs network and an authenticated `gh`, so it is NOT in `npm run ci`; `pnpm run release:verify-controls`. | Live, and refusing on its first run (2026-08-12): all ten macOS signing and notarization credentials are REPOSITORY-wide while §2 of the page says they are environment-scoped and "never stored as a repository-wide secret". Third false claim found on that page in nine days |
| `verify-release-key.sh` | Proves the release signing key (K1) by DRIVING the real pipeline end to end rather than by listing commands in a runbook, and records what it saw in `docs/release-key-pin.json`: a key that signed a manifest, a signature that verified, a manifest that anchors to its tag. Only a real run can write that note, which is what ceremony Phase 4b reads. | Live; K1 generated and proved 2026-08-05 |
| `run-verdict.mjs` | Turns a CI run's colour into a VERDICT, which is not the same thing. A job's state comes from its STEPS, never from its `conclusion`: a step that concluded `failure` is a stated assertion and makes the run red, while a job with an empty steps array never got to state anything and reports as `cancelled` or `not-started` - twice a run painted `failure` carried no finding at all (cancelled jobs that never ran a step; a billing block that started nothing), and each cost days in the wrong direction. Exits 0 green or no-verdict, 1 red with a stated assertion, 2 unreadable. | Live; wired into `.github/workflows/ci.yml` and gated by `ci-master-verdict.smoke.js` |
| `verify-listing-assets.mjs` | Row 42, extended to the Play set: do a store listing's assets depict the build being submitted? Their pixel dimensions are checked in two places and their SUBJECT was checked nowhere, so the Chrome images captured at v0.333.1 sat ready to upload beside a v0.336.0 release, and the four Play screenshots depict v0.334.0 against that same release. FOUR lanes, selected with `--set`: `extension` (Chrome Web Store, the default), `mas` (Mac App Store), `ios` (App Store, both idioms, where the eight listing images were not merely unpinned but `.gitignore`d, so they existed on one disk and in no history) and `play` (Google Play, pin-only: no capture harness exists for it). Compares each set's `capture-pin.json` against the bytes on disk and against the commits touching the surfaces each asset depicts. Exits 0 clean / 1 stale / 2 inconclusive. Read-only unless `--write`. | Live on all four sets; the pin half is gated by `release-tools.smoke.js` (extension), `ios-listing-assets.smoke.js` (ios) and `play-listing-assets.smoke.js` (play), the drift half is asked at each store's upload step, ceremony Phase 5 for Chrome. The Play pin reads `how: derived` because that set has no capture harness to write it, and the set reports STALE today, which is the finding this check registered |
| `upload-listing-assets.mjs` | Row 63: push the PINNED iOS listing screenshots to App Store Connect through the same API key the gates read with, so a red `verify-appstore-version.mjs` has a remedy that is a command rather than the sentence "upload them from a signed-in console session". Uploads the PIN and never a directory, because an image the pin does not name re-creates the accurate-metadata exposure (Apple 2.3.3) the pin exists to close; refuses unless the pin`s commit is what the version`s attached build was cut from (`--allow-unpinned-build` is the deliberate override); refuses on any version state but `PREPARE_FOR_SUBMISSION`, since changing listing images on a version that is waiting for review or live is a different act with different consequences; and waits for Apple to publish each asset's CHECKSUM rather than stopping at COMPLETE, because the gate that verifies this upload reads the checksum and the two moments are not the same one. Sets the order explicitly afterwards: Apple serves the first three images on install sheets and a multi-file upload lands in completion order. No browser involved. | Live (iOS lane), driven against the real listing 2026-08-10: 8 images on both idioms, and `verify-appstore-version.mjs` went from 4-of-4 mismatched per set to `screenshots-pinned` OK on both |
| `cws-upload.mjs` | D4: upload a signed release zip to the Chrome Web Store through the store's own API. Every safeguard in it is a refusal, because a refresh token that can publish to the store IS the publisher account: credentials come from the environment and no path can print one, it refuses a zip no signed manifest describes, and it refuses to publish publicly without being told twice. | Live, and driven against the real staged artifacts, where it refuses correctly (no signed manifest exists yet) |
| `capture-update-check.mjs` | §7.6: records what an update check actually transmits, so the download page's privacy copy is derived from an observation rather than from a belief. Writes `docs/update-check-capture.json`. | Live |
| `update-info.mjs` | §7.1: what is a channel pointer, and what did this build actually emit? electron-builder names its update-info files after the CHANNEL rather than after the word "latest", so a lane that assumes `latest-mac.yml` is looking for a file a real build never wrote. | Live |
| `verify-edge-cache.mjs` | §3: the caching contract, measured instead of assumed. Channel pointers must be served no-cache and binaries may cache freely, and that takes two mechanisms rather than one (the origin's `no-store` and a Cloudflare cache-bypass rule on the same paths), so checking one of them proves nothing. **Probes FIVE pointers as of run 20, not four:** desktop's `stable*.yml` quartet, which all still 404 because desktop has never published, plus the direct-APK lane's `android/latest.json`, which is the only channel pointer this project has ever actually published. Both name sets are DERIVED - desktop's from `update-info.mjs`, Android's from the app's own `UPDATE_FEED_URL` - because a probe aimed at a name no client fetches produces a green result and protects nothing. `--artifact` takes a bare desktop name, or a lane-qualified path (`android/xchain-wallet-v0.336.0.apk`) to measure the binary half. **That half requires `immutable`, not merely a `max-age` (run 22):** a bare `max-age` is what a CDN falls back to when no origin rule covers the name, so accepting it certified a platform default as the contract. **And the POINTER half cannot be read from `cf-cache-status` at all (row 35):** a live pointer behind a bypass rule proven to match it by Cloudflare Trace reads `DYNAMIC`, and so does a path no rule touches - measured against `RELEASE_HASHES/v0.336.0.txt`, which asks to be cached with `max-age=300`, is covered by no rule, and reads `DYNAMIC` anyway, because none of `.yml`, `.json` or `.txt` is in Cloudflare's default cacheable-extension set. `DYNAMIC` therefore tracks the file extension, not the rule, and now scores **`UNMEASURED`** (exit 3) rather than the `PASS` it scored for the tool's whole life; only `BYPASS` proves the rule from a header, and reading the rule itself needs Cloudflare's Trace API. | Live. The origin config fix has LANDED: probed 2026-08-11, `android/latest.json` answers `no-store` and the APK answers `public, max-age=31536000, immutable` / `HIT`, so the binary half now PASSES on a rule rather than on a default. Currently exits 2: the four desktop names are `UNPROVEN` (nothing published), and `android/latest.json` is `UNMEASURED` per the row-35 finding above |
| `verify-android-manifest.mjs` | §5/§7: asserts the manifest facts of a BUILT Android bundle rather than of the source that was meant to produce it. | Live |
| `verify-apk-play-protection.mjs` | §6: keeps Google's bytes out of the direct-download lane. Play's `Prevent unofficial installs` is code injected into the artifact Google signs (`com.pairip.*`, a licence-check activity, `com.android.vending.CHECK_LICENSE`, a source stamp), and sideloading that artifact bounces the user to the Play Store on first launch. A console-downloaded APK published here would pass every signature and hash check in the ceremony and break only for the self-custody audience, so `publish.sh` runs this over every `.apk` in the set before it uploads anything. | Live, called by `publish.sh` |
| `android-ceremony.sh` | The Android signing ceremony, run on the operator's machine and never in CI: no password is ever passed on a command line or read from the environment, since `jarsigner` and `apksigner` both prompt. | Live, operator-run |
| `ios-archive.sh` | §5: archives the iOS shell for distribution with CLOUD-MANAGED signing, handing `xcodebuild` the App Store Connect API key (K4) rather than installing a distribution certificate on the runner, so the signing identity materializes transiently and is never stored. | Live |
| `ios-export.sh` | §5: exports the archive to an `.ipa`, NAMED here rather than wherever Xcode leaves it, because rails §3 names it and `expected-artifacts.txt` matches on that name: an ipa called `App.ipa` is an undeclared file and hard-fails signing. Carries the lane suffix (`-beta.N`, `-respin.N`). | Live |
| `verify-ios-artifact.mjs` | The iOS twin of `verify-android-manifest.mjs`: asserts the `Info.plist` and entitlement facts of a BUILT `.app` or `.ipa` rather than of the source meant to produce it. Both iOS ceremony scripts call it, so the archive is checked when it is written, the archive is checked again before any key is used to export it, and the exported ipa is checked for the three facts only a signed export can carry (distribution profile, no `get-task-allow`, one app in the `Payload`). Expectations are derived from the pbxproj, `Version.xcconfig`, the URI parser and the source plists, never pasted. Unlike the Android control it also runs on every tag with no Apple account, because the unsigned archive lane calls it too. | Live |
| `android-applinks-verify.sh` | Takes the App Links verdict for `xchain.io` as a repeatable measurement instead of a session that has to be rediscovered: provisions a `google_apis_playstore` AVD (the image is the whole finding - a `google_apis` image carries the verification agent and never invokes it for a sideloaded package, so the domain holds at `none`, which is the ABSENCE of a verdict and proves nothing either way), installs the artifact, resets and re-verifies, then polls `pm get-app-links` for a real state. Refuses every venue whose answer would not mean what it says: a non-Play image string, an AVD whose `tag.id` is `google_apis`, API 30 (where the command does not exist and the singular `pm get-app-link` returns a user preference from the same-shaped output), and an image with no `com.android.vending`. `--falsify` additionally proves the verdict is contingent on fetching the live `assetlinks.json` by taking the device offline and requiring it to change. Exits 0 verified / 2 caller / 3 this venue cannot answer / 4 no verdict / 5 a stated non-verified verdict / 6 missing tool or artifact / 7 not contingent. **The one step it cannot automate**: an install carrying Google's CURRENT app-signing certificate, which reaches a device only through a real Play delivery to a tester account - run that install by hand, then `--no-provision --no-install`. | Live; the decision table is driven by `test/smoke/audits/android-applinks-verify.smoke.js` against fake `adb`/`sdkmanager`/`avdmanager` shims, so it is checked with no emulator present |
| `emulation-preflight.sh` | Decides BEFORE a reproduce run starts whether this host can actually execute the amd64 build. Every reproduce lane pins an amd64-only base image, so an arm64 verifier runs the whole build under emulation and two different emulators can serve that platform flag. | Live |
| `drills/deb-update-swap.mjs` | The install/launch/swap half of a §7.5 rehearsal for the `.deb` lane, watching a real update install itself. It installs and upgrades system packages, so it runs inside a throwaway container and nowhere else. | Drill |
| `drills/win-update-swap.mjs` | The same half for the Windows nsis lane, on NATIVE x64. DD4 puts both Windows lanes on one Parallels VM where `win-x64` runs under Windows-on-ARM emulation, and a hosted `windows-latest` runner is a free native x64 machine, so this installs the previous build, drives the real `NsisUpdater` against a local feed, and requires both that the installed binary's hash changed and that its ProductVersion moved. It writes evidence for `rehearse.mjs check` and can never produce an attestation: nobody watched it. Refuses any host that is not a CI runner unless told it is disposable. | Drill; runs as `.github/workflows/windows-swap-check.yml` |
| `electron-cadence.mjs` | §9 CVE clock: is the Chromium we ship still getting security fixes? Reads the version out of `pnpm-lock.yaml` (the caret in `package.json` is not the pin - every release lane installs `--frozen-lockfile`), then compares it against the registry's dist-tags: newer patches on our own major, newer majors past §9's 28-day rule, and upstream's three-major support window. Exits 0 current / 1 behind / 2 unreadable pin / 3 inconclusive - a registry that cannot be reached is never folded into "current". `--json` for a cron, `--offline <packument>` for tests. | Built 2026-08-02, and it went red on its first run: shipped 41.3.0 while 41.10.3 existed, with 42 and 43 both past the rule. Not yet installed anywhere |
| `credential-expiry.mjs` | §6 credential clock: are the release signing credentials still valid? Reads `credential-expiry.json`, which declares the five dated rows (K3 Developer ID, K18 Apple Distribution, K19 3rd Party Mac Developer Installer, and both provisioning profiles) with what each one breaks, and reports them against a 60-day renewal lead time. **The declaration is not the authority**: every row names the artifact that carries its expiry, and wherever that artifact is reachable the tool reads `notAfter` out of it and fails on any disagreement - a date file nothing measures is how `expected-artifacts.txt` declared artifact classes and never counted them. A row it cannot reach reports `DECLARED-ONLY` with the reason rather than being trusted. Exits 0 current / 1 due, expired or drifted / 2 unreadable declaration. `--json` for a cron. | Built 2026-08-08 and green: K3 has 177 days, the other four 363. Installed weekly as `.github/workflows/credential-expiry.yml`; deliberately NOT a release gate, because once a credential enters its lead time it would block every release for sixty days and be switched off |

### Installing the store-version monitor (DEPLOYED 2026-08-01, DISARMED)

**Status 2026-08-10 (run 21): LIVE on origin-host for the Play and
direct lanes; the Chrome lane is still deliberately disarmed.** The Chrome
disarm below needs one thing that cannot exist yet, the store-assigned
extension ID, so it waits for the first upload (§4 exit criteria; also a row
in the [manual QA checklist](https://docs.xchain.io/components/wallet/release/qa-checklist) "Chrome Web Store
release provenance"). It is disarmed rather than absent on purpose: with
`CWS_MAIN_ITEM_ID` unset the script exits 2 and writes to stderr, so an
armed cron would mail a config error every six hours and train everyone
to ignore the one alert that matters.

**That disarm quietly became the reason nothing was watched at all.** It was
written on 2026-08-07 against a Chrome-only script, and it is a whole-run
refusal: with the id unset, the lanes that need no id do not run either.
`c1779605` then added the Play lane and row 130 the direct lane -
the one watching the only artifact this project has published to the public -
and neither reached the host. Measured 2026-08-10: `/opt/xchain` carried a
19,244-byte Chrome-only copy from before the Play lane existed, behind a
commented-out cron line, with no state file, so the monitor had **run zero
checks**. The armed `--no-chrome` line is now installed, and `/opt/xchain`
carries `.store-version-monitor.provenance` recording the copied commit and
sha256 so a future re-copy is deliberate rather than a guess.

**A third correction, and it is the kind that only shows up on the day it
costs something.** `/opt/xchain` is root-owned, so the cron user cannot write
the Play latch into it. That does not fail today: with no listing published
the run exits **0**, and only the FIRST SIGHTING of a live listing tries to
write the latch. Driven on the host against a real live listing (Signal) with
the default path, it dies `EACCES` exit 2 - on the exact promote day the latch
exists to arm itself on, with no human step. The install therefore points
`PLAY_STATE_PATH` at `/opt/xchain/state/`, a `jdog`-owned directory beside the
script, proven writable by driving the same first-sighting into it.

**Arming means REPLACING the staged line with step 3's, not uncommenting
it.** The commented entry on the host is a third home for this line, and
nothing in this repository can see it or check it: it predates the Play
lane support added, so it carries neither `PLAY_STATE_PATH` nor
`--no-play`. Uncommenting it and pasting the item ID in is therefore the
one arming gesture that reproduces the fault step 3 exists to avoid, and
it stays silent until the first sighting of a live listing. Paste over
it; do not edit around it.

Everything else was verified running on the deployed host: the log refresh, the
parse, and a real request to the Chrome Web Store (exit 3, inconclusive,
which is the correct answer for an item ID that does not exist).

**Two things the original recipe below got wrong, corrected by doing it:**

1. **`/opt/xchain` is root-owned**, so `scp` straight into it fails with
   permission denied even though the files inside are `jdog`-owned. Copy
   to `/tmp` and `sudo install -o jdog -g jdog -m 0755` into place.
2. **`PUBLISH_LOG_PATH` is required and the recipe omitted it.** The
   script defaults the log path relative to its own location in the repo,
   which on the host resolves to `/packages/extension/docs/publish-log.md`
   and does not exist, so the monitor would have exited 2 forever with a
   valid item ID. The staged crontab line refreshes the log from
   `origin/master` on each run and points `PUBLISH_LOG_PATH` at that copy,
   which keeps ONE source of truth: a hand-copied log on the host goes
   stale the moment a publish row is appended, and a stale log turns a
   legitimate release into a rogue-publish ALERT.

The original steps follow, still accurate for what they cover.

1. Copy the script to the host - it is not part of any existing deploy,
   same as `feed-sweep.mjs` beside it (see that row's "host pending"
   status above):
   ```bash
   scp tools/release/store-version-monitor.mjs <release-host>:/opt/xchain/store-version-monitor.mjs
   ```
   Record the copied commit hash somewhere on the host (a sibling
   `.store-version-monitor.provenance` file, same pattern as the
   watchdog's hand-deployed copy) so a future re-copy is deliberate,
   not a guess at whether the host is stale.
2. Confirm Node 22 on the host: `node --version` (this repo's suites and
   scripts require exactly Node 22; the script uses the global `fetch`
   Node 18+ ships, but stay on the pinned version anyway).
3. Add the crontab entry. `MAILTO` is what makes cron's own mail
   delivery reach a human - the same mechanism already proven live
   elsewhere for similar refresh-status checks. Redirect stdout only, so a
   clean run (silent on stderr) mails nothing and a run that finds
   something (ALERT or INCONCLUSIVE, both write to stderr) always does:
   ```
   MAILTO=<shared inbox - spec §2 "Correspondence routing" / D1, not yet decided;
           interim per the spec, point this at whatever mailbox is currently
           live for store correspondence>
   0 */6 * * * CWS_MAIN_ITEM_ID=<recorded extension id> \
     CWS_BETA_ITEM_ID=<recorded beta extension id, once that item exists> \
     PLAY_STATE_PATH=/opt/xchain/state/store-monitor-state.json \
     /usr/bin/node /opt/xchain/store-version-monitor.mjs >/dev/null
   ```
   `PLAY_STATE_PATH` is here because this line runs BOTH lanes, and the
   Play one keeps a latch (see the Play section below). Without it the
   latch defaults beside the script in `/opt/xchain`, which is root-owned:
   measured on the host 2026-08-10, `jdog` cannot create a file there. A
   404 still exits 0, so the fault stays invisible until the first sighting
   of a live listing, which is the exact day the latch is supposed to arm
   itself - and from then on this line mails a config error every six hours,
   which is the alarm fatigue the disarm above exists to prevent. The
   armed Play-only line already carries this variable; a
   combined line without it is a step BACKWARDS from what is deployed.
   Item IDs are not secrets (they are already public in every installed
   user's `chrome-extension://<id>/` URL and in the store listing link),
   so they can sit in the crontab in plain text like any other config
   value; nothing this script needs is a credential.
4. The ops-channel leg (posting the same alert to a chat channel, not
   just the inbox) rides the still-open channel decision. Do not
   build or wire that leg speculatively; add it as a second crontab
   command (or a second sink inside the script) once that decision
   lands, not before.
5. Verify the install without waiting for a real incident: run
   `CWS_MAIN_ITEM_ID=<id> node /opt/xchain/store-version-monitor.mjs`
   by hand on the host once, confirm it exits 0 with a clean summary on
   stdout and nothing on stderr, then leave the cron to carry it going
   forward.

### The Play lane, and why it installs before Chrome

The script now carries a second lane, for the Android listing. It runs by
default and needs no id, because the `applicationId` is fixed. Two things
about it change the install above.

**It can, and should, be installed before a Chrome item exists.** Android is
ahead of Chrome in this programme. A whole-run config error (no
`CWS_MAIN_ITEM_ID`) stops BOTH lanes, so until the extension is uploaded,
install the Play-only form and move to the combined line later:

```
0 */6 * * * PLAY_STATE_PATH=/opt/xchain/state/store-monitor-state.json \
  /usr/bin/node /opt/xchain/store-version-monitor.mjs --no-chrome >/dev/null
```

`PLAY_STATE_PATH` is not optional on this host, which is why it is in the
line rather than in the prose underneath it: the default sits beside the
script in root-owned `/opt/xchain`, and the failure it produces is silent
until the day it matters (see the latch note below). This is what is
actually deployed and armed today.

**It keeps state, which the Chrome lane does not.** The Play lane checks that
the listing is PRESENT and is ours, not what version it is, because a Play
listing page does not publish one. A 404 is the correct and clean answer
until the listing goes public, so tolerating it forever would leave the check
useless on the day it mattered. Instead the first sighting of a live listing
writes a latch, and from then on a 404 is an ALERT. That file defaults to
`/opt/xchain/store-monitor-state.json`, beside the script:

- **The directory must be writable by the cron user, and on origin-host the
  default one is not.** This bullet used to say the failure is loud rather
  than silent. **Measured on the host 2026-08-10, that is wrong, and the way
  it is wrong is the dangerous direction.** The latch is only written when
  there is something to latch, so while the listing 404s the run exits **0**
  and reports clean however unwritable the directory is. The first sighting of
  a live listing is the first write, and with a root-owned `/opt/xchain` it
  dies `EACCES` exit 2 there - on the exact promote day the lane exists to arm
  itself on, having reported clean every six hours until then. Driven both
  ways against a real live listing to settle it. So set `PLAY_STATE_PATH` to a
  directory the cron user owns (`/opt/xchain/state/` here) at install time;
  waiting for the check to complain does not work.
- **Do not delete it.** Deleting it disarms the latch back to "never seen",
  which is precisely the state that cannot tell a listing that was taken down
  from one that was never published.
- Override it with `PLAY_STATE_PATH` or `--state <path>` if `/opt/xchain` is
  not the right home on that host.

**What this lane does NOT detect, stated so nobody assumes it does:** a
silent rollback to an older version. Suspension and unpublishing are presence
changes and are caught; a version moving underneath us is invisible without
the authenticated Play Developer API (`androidpublisher`), which this script
deliberately holds no credential for. Verify the Play half by hand the same
way as step 5 but with `--no-chrome`: before the listing is public it should
print `no public Play listing yet` and exit 0.

### Verifying one artifact

`verify.sh` checks the whole manifest by default, which is what the
maintainer wants and not what a user who downloaded one installer
wants. `--artifact <name>` narrows the hash check to that file while
still checking the signature and the tag anchor in full:

```bash
bash tools/release/verify.sh --input ~/Downloads \
  --manifest ~/Downloads/v0.333.1.txt \
  --artifact 'xchain-wallet-0.333.1-x86_64.AppImage'
```

### Which key signed it

`verify.sh` refuses a signature that is good but not from the expected
key (S37). It takes the expectation from `--key <fingerprint>`,
then `XCHAIN_VERIFY_KEY`, then `docs/release-key-pin.json`, and refuses
to call anything verified when none of the three resolves. Both halves
of a key are accepted, because K1's published fingerprint is a
certify-only primary while its signing subkey is what gpg reports.

This existed as a bare `gpg --verify` until 2026-08-06, which answers
whether somebody in your keyring signed the manifest rather than whether
the release key did. The two are the same answer on a keyring holding one
key and different answers on this machine, which holds three by design.
It was found by rehearsing the Chrome ceremony's Phase 4 against the real
release zip: the manifest had been signed with the tag-signing key and
the check said `ok`.

### Re-signing a release that was already published

**A signing run reads TWO trees, and this is what to do when the wrong
one was right.** The scripts come from whichever checkout invokes
`sign.sh`; `check-no-dev-mock.sh`, `shipped-lanes.txt` and
`expected-artifacts.txt` come from `--repo`, the pristine clone at the
release tag. So a defect fixed in the gate cannot reach a release that is
already tagged.

That is not hypothetical. `RELEASE_HASHES/v0.336.0.txt`, the only signed
manifest this project has published, says `# dev-mock-gate: enforced` for
a gate that read zero bytes: the tag's copy predates `--artifacts`, so it
ignored the flag, scanned a pristine clone's absent `dist/` trees, printed
three SKIP lines and `OK`, and exited 0. `sign.sh` now refuses that
combination - it requires the gate's own receipt, `OK - N bundle(s)
scanned` - which stops it recurring and does nothing for a record already
published.

Correcting the record means re-signing from a tag whose own gate runs:

```bash
bash tools/release/prepare-resign-tag.sh --tag v0.336.0 \
    --work-dir ~/xchain-resign/v0.336.0 \
    --input ~/xchain-release-artifacts/0.336.0/
```

That cuts `v0.336.0-resign1` in a throwaway clone: the release tag's tree
with `tools/build-reproduce/check-no-dev-mock.sh` replaced by the
committed copy from this checkout, and nothing else changed, so the
artifacts it re-signs are still the artifacts the release built. It then
PROVES the tag by running its own gate against the staged artifacts and
requiring the same receipt `sign.sh` requires. It never pushes and never
signs: K1's passphrase belongs at a pinentry in front of a person.

Then sign it, from a CURRENT checkout, with the new tag in `--repo`:

```bash
XCHAIN_RELEASE_GPG_KEY=<K1 fingerprint> \
  bash tools/release/sign.sh --tag v0.336.0-resign1 \
    --repo ~/xchain-resign/v0.336.0 --lane android \
    --input ~/xchain-release-artifacts/0.336.0/
```

**The corrected manifest is republished under the RELEASE's name**,
`RELEASE_HASHES/v0.336.0.txt`, which is where every existing link points.
`verify.sh` anchors `v0.336.0-resign1` to `v0.336.0` and says out loud
that it is a re-signature superseding what was published there; the
relation is one-way, so being handed the superseded original when asking
for the correction still fails. `feed-sweep.mjs` reads the same rule, so a
channel pointer naming the plain version still finds its manifest.

Two things the operator owns and these tools do not: K1's passphrase, and
pushing the new tag so a verifier can obtain the tree it names.

### One signature, checked three ways

The manifest is signed once, by K1, with GPG. That single signature is
checked by `verify.sh`, by a user following
[https://docs.xchain.io/components/wallet/release/verify-release](https://docs.xchain.io/components/wallet/release/verify-release), and at runtime by the desktop updater
before it installs anything
(`packages/desktop/main/updateVerify.js`, which bundles openpgp.js
and checks against a key pinned in the app).

One key, one ceremony, one thing to rotate. See
`claude/reports/launch/GPG-KEY-CEREMONY-RUNBOOK.md`.

## Environment variables

| Var | Purpose | Used by |
|---|---|---|
| `XCHAIN_RELEASE_GPG_KEY` | GPG key fingerprint or email used for signing. | `sign.sh` |
| `XCHAIN_RELEASE_TAG` | Default `--tag` value. | both |
| `XCHAIN_RELEASE_DIR` | Default `--input` value (the artifact directory). | both |
| `XCHAIN_RELEASE_REPO` | Default `--repo` value: the pristine clone the artifacts were built from. Defaults to the checkout the script lives in. | `sign.sh` |
| `XCHAIN_RELEASE_LANES` | Default `--lane` value, comma-separated: signs a PARTIAL release covering only those lanes, whose globs come from `shipped-lanes.txt`. Inside that scope the artifact-set gate is stricter than the full list, not weaker, and the manifest records `coverage: partial` in its signed header. | `sign.sh` |
| `GNUPGHOME` | Optional override for the GPG home directory. | both |
| `SIGN_SKIP_DEV_MOCK_CHECK` | Set to `1` to skip the pre-sign dev-mock gate. Recorded in the signed header. Release runs never set it. | `sign.sh` |
| `XCHAIN_WALLET_RELEASE_RECORDS` | Where the §6 release records live. Defaults to `../claude/reports/wallet-releases` beside this checkout. It relocates the records; it does not waive them, and there is no variable that does. | `release-record.mjs`, `publish.sh` |

**One-shot pnpm wrappers.** The root `package.json` exposes
`pnpm release:sign` and `pnpm release:verify`, which target
`release-artifacts/<version>` and pass `--tag v<version>`, both read
from the root `package.json` at invocation time.

## Per-release procedure

The authoritative checklist is §6 of
`claude/specs/wallet-release-rails.md`, instantiated per release as
`claude/reports/wallet-releases/vX.Y.Z.md`. What this directory owns:

0. Open the release record, before anything else:

   ```
   node tools/release/release-record.mjs open --tag vX.Y.Z --manager <you>
   ```

   Not optional and not last: step 1's own gate refuses a version bump
   whose record does not exist, and step 5 refuses to publish without
   one. v0.334.0 was tagged and built with no record open, and a day
   later its only account was a CI summary job someone had to
   reconstruct from.
1. Run the release gate: `pnpm release:gate` (the full CI suite plus
   the **prod-build** regtest e2e venue). Only the latter proves real
   transaction signing - the dev server silently substitutes the
   dev-mock SDK, so a green `pnpm test:e2e` says nothing about it.
2. Tag the validated commit and clone it fresh into a throwaway
   directory. Build every shell there.
3. Stage all artifacts into a single directory:
   `release-artifacts/vX.Y.Z/`.
4. `XCHAIN_RELEASE_GPG_KEY=<fingerprint> pnpm release:sign`. The
   pristine-clone, dev-mock and artifact-set gates run first.
4b. Sign the staging set too. K1 signs both (operator decision
   2026-07-31), so the order is sign prod -> sign staging -> rehearse ->
   publish prod, and the rehearsal exercises the key that actually
   matters rather than a stand-in.
4c. Rehearse the update against the staging feed (§7.5). Publish
   the staging set, then probe every lane, then attest the swap you
   watched:

   ```
   bash tools/release/publish.sh --input release-artifacts/vX.Y.Z-staging/ \
     --tag vX.Y.Z --target <staging target> --staging
   node tools/release/rehearse.mjs run --feed <staging base url> \
     --tag vX.Y.Z --channel staging --prod-input release-artifacts/vX.Y.Z/
   # install the PREVIOUS release's rehearsal build, watch it take this one:
   node tools/release/rehearse.mjs attest --record release-artifacts/REHEARSAL-vX.Y.Z.json \
     --lane mac-arm64 --from <previous version> --by <who watched it>
   ```

   `run` checks the half that needs no hardware - the pointer resolves,
   each arch selects its OWN installer, the bytes match, and the K1-signed
   manifest covers them - for all eight lanes from one machine. `attest`
   records the half that does: an observed install and swap on named
   hardware. `rehearse.mjs requirement` says whether this release needs
   one OS or all of them, from the diff rather than from judgement.
   No production pointer goes up before this passes, and step 5 refuses
   without the record.

   **The direct Android lane is probed by the same command**,
   and it is a different shape: its feed is a one-field `latest.json`, the
   app downloads nothing, and the user performs the install. `run` drives
   the shipped client against the staging feed in both directions (an
   install on this version is told nothing, an install on the previous one
   gets the notice naming this one) and proves the APK that notice sends
   them to is covered by the K1-signed manifest. Its third half, whether an
   APK installs OVER its predecessor, needs a device DD-A has not named, so
   `assert` prints `unrehearsed, not proven` rather than passing quietly.
   It runs whenever the release directory contains an `.apk`; there is no
   flag to remember.

   **The deb lane has a drill of its own**, `drills/deb-update-swap.mjs`,
   because its install step is the only one that ends in a root-privileged
   `dpkg -i` and no feed-side probe can reach it. Run inside a throwaway
   container against two real builds one version apart, it installs the
   older `.deb`, drives the real `DebUpdater` against a local feed, and
   requires both that the escalated command line was produced and that the
   installed package version actually moved. It refuses to run anywhere
   that is not obviously disposable - it installs a system package. First
   run 2026-08-02, arm64: `0.334.0 -> 0.334.1`.

   **The Windows lane has a drill and a CI job**, `drills/win-update-swap.mjs`
   and `.github/workflows/windows-swap-check.yml`, and what they produce is
   a second KIND of evidence rather than more of the same. DD4 names one
   Parallels VM for both Windows lanes, so `win-x64` - the largest desktop
   audience here - is attested on emulated silicon. A hosted
   `windows-latest` runner is a free native x64 Windows machine, so the job
   builds the tree twice one patch apart, installs the first build, drives
   the real `NsisUpdater` against a local feed and requires the installed
   binary to be replaced. File its result with `rehearse.mjs check --record
   <record> --from-result <json>`.

   **It is not an attestation and cannot become one.** `attest` demands
   `--by <who watched it>` because whether the download replaced the running
   app is an OS-level fact no process observes about itself; it refuses to
   run in CI, `check` refuses `--by`, a filed check lands in
   `automated-checks` rather than `swaps`, and no number of them satisfies
   §7.5's per-release swap requirement. A check that reports `fail` DOES
   stop a publish. The DD4 human attestation stays required for both
   Windows lanes.
5. `bash tools/release/publish.sh --input release-artifacts/vX.Y.Z/
   --tag vX.Y.Z --target <deploy target>
   --public-base https://downloads.xchain.io/wallet --dry-run`, then for
   real. It requires a passing rehearsal record bound to the manifest in
   hand, verifies before uploading, refuses a version that already
   exists, refuses a rehearsal build (or the wrong feed), publishes the
   manifest under its versioned name, fetches every artifact back through
   the edge, and uploads the channel pointers last.
5b. `bash tools/release/deploy-web.sh --tarball <the published tarball>
   --manifest RELEASE_HASHES/vX.Y.Z.txt --tag vX.Y.Z --webroot <webroot>`
   for the SPA. Deploy the tarball that was signed, never a fresh local
   build: the script verifies it against the signed manifest and refuses
   to flip if it does not match, so carry the manifest and its `.asc` to
   the webroot host alongside the tarball. `--dry-run` runs the same
   verification, which makes it a preflight rather than an echo.
6. `pnpm release:verify` from a clean checkout to confirm the round
   trip.

The reproducible-build verification is a separate step. Each shell ships
its own third-party reproduce script + digest-pinned Dockerfile:

- `pnpm --filter @xchain-wallet/desktop reproduce`
- `pnpm --filter @xchain-wallet/web reproduce`
- `pnpm --filter @xchain-wallet/extension reproduce`

See [`tools/build-reproduce/`](../build-reproduce/) and the
[reproducible-builds doc](https://docs.xchain.io/components/wallet/reproducible-builds),
which carries a section per shell, for the per-shell verification protocol.

## Status today

- ✅ Scripts, gates, manifest header and the artifact-set list are live and covered by `test/smoke/audits/release-tools.smoke.js`.
- ✅ Dev-mock gate scans every shipped shell bundle, including the desktop renderer.
- ✅ GPG signing works: the release key was generated 2026-08-05 and has signed a manifest end to end. G180's remaining half is publication reaching readers (both channels and the desktop pin are written, the deploy has not run); ceremony runbook is S3.
- ✅ CI release lanes exist (`.github/workflows/release.yml`); the repository-settings half is a checklist at [https://docs.xchain.io/components/wallet/release/ci-setup](https://docs.xchain.io/components/wallet/release/ci-setup) and is NOT yet configured, so the workflow must not run with real secrets until it is.
- ⏸ `downloads.xchain.io` not yet stood up (S6); the upload tooling (`publish.sh`), the monitoring (`feed-sweep.mjs`) and the host runbook exist, the host does not. The [verify-release page](https://docs.xchain.io/components/wallet/release/verify-release) still points at GitHub release assets.
- ✅ `publish.sh` and `feed-sweep.mjs` are driven for real, against a signed fixture and a live local HTTP origin, by `test/smoke/audits/publish-feed.smoke.js` and `feed-sweep.smoke.js`. The older coverage of `publish.sh` was greps over its own source, which is how the stage-1 defect survived: the comments and the code disagreed and both read as correct.
- ✅ The §7.5 rehearsal is enforced, not merely written down: `publish.sh` refuses a production publish without a rehearsal record bound to the signed manifest in hand, so a re-cut release cannot inherit the previous cut's green. Driven end to end, with every refusal path, by `test/smoke/audits/rehearsal.smoke.js`.
- ⏸ The swap half of the rehearsal is blocked on DD4 for seven of eight lanes (the two Linux deb lanes were added 2026-08-02, §5): `rehearse.mjs coverage` reports which, and refuses to call a lane launch-ready with no named device. `mac-arm64` is the only lane with hardware today.
- ⏸ The direct Android lane's INSTALL-OVER is blocked on the same kind of open question, DD-A: no device is named, so `attest` refuses it and `assert` prints `unrehearsed, not proven` on every publish that carries an APK. Its feed and client halves ARE rehearsed, by `test/smoke/audits/android-update-rehearsal.smoke.js`. Naming a device in `rehearsal-matrix.mjs` is what turns the note into a requirement; nothing else changes.
- ⏸ Cross-platform reproduce (macOS / Windows pre-signing artifacts) pending the desktop reproducibility follow-ups.
- ✅ **Every desktop lane built ONE architecture, not two, and nothing said so** (found 2026-08-01 by running the reproduce container for the first time). All six invocations read `pnpm -C packages/desktop dist -- --linux --x64 --arm64`. pnpm 9 forwards that `--` into the script's argv verbatim (npm strips it), and electron-builder is yargs-based, so a bare `--` ends option parsing and every flag behind it lands in `argv._` unread. electron-builder then packaged the runner's own arch: linux-x64 from ubuntu, one arch per OS across the matrix. `expected-artifacts.txt` matches by extension rather than per arch, so the signing gate would have passed the release, `stable-linux-arm64.yml` would never have been written, and every arm64 install would have had no download and no update - permanently, and silently. Separator dropped in all six lanes and in `packages/desktop/scripts/build.sh`; `test/smoke/audits/reproducible-toolchain.smoke.js` fails on any pnpm invocation that reintroduces it.
- ✅ **And the gate that let it through is closed** (2026-08-01). Dropping the separator fixed the cause; the reason it went unseen was that `expected-artifacts.txt` declared artifact CLASSES and never counts, so `*.dmg` was satisfied by one dmg. Rows now carry a fourth arch column, `lib.sh` attributes each artifact to an architecture using electron-builder's own naming tokens, and a release missing either arch of any of the six lanes fails by name. The same check refuses an artifact that belongs to NO architecture, which is the un-suffixed combined NSIS installer - so that decision is now blocking rather than silent. `test/smoke/audits/release-arch-coverage.smoke.js`, 8 drift mutations driven, 8 killed.
- ✅ The release toolchain is pinned end to end (`tools/release/toolchain.json`): the lanes asked `actions/setup-node` for major `22` while the reproduce container pinned `20.18.0`, so no verifier could ever have matched a release. Same guard file.

**Known naming gap.** Desktop installers use electron-builder's default
names, which embed `productName` ("XChain Wallet", with a space) and an
arch suffix that varies by target. `expected-artifacts.txt` therefore
matches them by extension rather than by a convention, with the arch
column above carrying the per-arch requirement the globs cannot. Pinning
an explicit `artifactName` that matches the
`xchain-wallet-<surface>-vX.Y.Z` convention belongs to the desktop spec
(§7.1, with the operator).
