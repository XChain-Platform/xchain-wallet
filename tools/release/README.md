# Release-signing pipeline - `tools/release/`

Spec reference: `claude/reports/xchain-wallet/XCHAIN_WALLET_SPEC.md` §51.
Release-engineering rails shared by every shell (versioning, channels,
credential inventory, CI matrix, the full release procedure and its
rollback story): `claude/specs/wallet-release-rails.md` .

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
tag holding different code are distinguishable in the record (,
rails §3). The manifest format itself is documented at the top of
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
NSIS installer, is not shipped (, operator 2026-08-01) and is
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
scoped post-v1.0 ( Android,  iOS). They are pinned here so
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
`latest` ( §7.1).

Build invocation per shell is documented in `CONTRIBUTING.md` →
"Per-shell builds".

## Scripts

| Script | Purpose | Status |
|---|---|---|
| `lib.sh` | Shared manifest routines: which files a manifest covers, in what order, and what its header says. Sourced by the other scripts so they cannot drift apart. | Live |
| `sign.sh` | Run the release gates, compute the SHA-256 manifest, and GPG-sign it. `--lane <name>` signs a PARTIAL release covering only the named lanes . | Live; needs `XCHAIN_RELEASE_GPG_KEY` (the key exists, G180's remaining half is publication) |
| `verify.sh` | Verify a manifest: hashes, header anchor, and GPG signature. Mirrors [https://docs.xchain.io/components/wallet/release/verify-release](https://docs.xchain.io/components/wallet/release/verify-release). | Live |
| `publish.sh` | §6 step 5: upload a signed release to the feed, channel pointers last, with an edge check between the two and a cache purge after. | Live (host pending) |
| `feed-sweep.mjs` | Runs on the feed host by cron: validates every published object against the union of the signed manifests, and every channel pointer against the bytes it names. | Live (host pending) |
| `rehearse.mjs` |  §7.5: probes every shipped update lane against the staging feed (pointer, per-arch selection, download, sha512, signed manifest), records human-attested swaps, and gates the production publish on the result. | Live (host pending) |
| `rehearsal-matrix.mjs` | The shipped update lanes and the named hardware each is smoked on (DD4). Data, not code. | Live |
| `release-record.mjs` | : the §6 release record, opened and enforced. `open --tag vX.Y.Z` instantiates `claude/reports/wallet-releases/vX.Y.Z.md` from `TEMPLATE.md` with the identity fields filled (store integers asked of `packages/mobile/scripts/version.js`, never recomputed from §2's formula) and never overwrites an existing record. `assert --tag` is the gate `publish.sh` runs before a production publish; an untouched copy of the template does not count. `coverage` checks that every `v*` tag AND the version the working tree declares have a record, and is run by `test/smoke/audits/release-record.smoke.js` inside `pnpm ci`. Exits 0 covered / 1 missing / 3 the records directory is not in this checkout. Tags whose commit declares a different version are reported, not failed: `release.yml`'s verify-tag refuses those, so they never produced a release. | Live, and gating since 2026-08-04 |
| `deploy-web.sh` | §6 step 5b: unpack the web tarball into a versioned directory and flip a symlink. | Live |
| `expected-artifacts.txt` | The declared artifact set a release must contain. Data, not code. | Live |
| `verify-store.sh` |  §4 post-publish verification: verifies the CI-built extension zip via `verify.sh`, then diffs it file-by-file against the store-served item (`--unpacked-dir` or `--crx`), skipping `_metadata/` and structurally diffing `manifest.json`. | Live |
| `manifest-diff.mjs` | Structural JSON diff helper for `verify-store.sh`: deep-equal ignoring named top-level keys (default `update_url`, `key`). | Live |
| `rollback-rerelease.sh` |  §4 rollback-as-re-release recipe: validates preconditions and prints the manual re-release sequence. There is no rollback lever; see the script's own header. The new version must beat BOTH floors: the highest version in the repo's  version-bearing set (which includes `packages/extension/manifest.json`, the only one the store reads) and the highest row in `publish-log.md`, read through the rogue-publish monitor's own `parsePublishLog`. The second floor is not redundant: the recipe tells the operator to work from a clone checked out at the good tag, where the repo is behind the store by construction. Exits 0 preconditions ok / 1 refused (no such tag, version not above the floor) / 2 caller error (no `--good-tag`, no `--new-version`, not a git checkout). A publish log that cannot be parsed is reported as could-not-tell and never as "nothing published". | Live, and driven end to end 2026-08-02 (S19); gated by `test/smoke/audits/rollback-rerelease.smoke.js` |
| `verify-privacy-url.mjs` |  §5/D5 pre-submission check: is the public privacy-policy URL live, answering directly (no redirect hop), and serving the current [privacy policy](https://docs.xchain.io/components/wallet/privacy/privacy-policy) word for word. Compares prose, not bytes, since the hosted page is rendered Markdown. Exits 0 live / 1 not live, redirecting, or stale / 2 config error / 3 inconclusive (403, timeout, network - never folded into live) / 4 live and current but a contact address the policy publishes is JavaScript-gated at the edge (submittable; the store validates that the URL resolves and serves the policy, and it does). **Do not use `curl` for this instead: Cloudflare answers plain tooling with 403 on every path of this domain, live page or not.** (Correction 2026-08-02: that stopped being true when turned Super Bot Fight Mode off; plain clients now get 200 zone-wide. The inconclusive-on-403 treatment stays, because the block can come back and this script must not report a false outage when it does. `verify-demo-endpoints.mjs` below deliberately takes the opposite view of a 403 on the API hosts, for a reason stated there.) Exit 4 exists because the script DECODES the edge's email obfuscation for its text comparison, which is right (the deployed bytes are innocent) but silent, and silence left the property unmeasured: the addresses are derived from the policy itself, and every run says whether each one is readable without JavaScript rather than only complaining when it is not. | Live, and green as of 2026-08-01: the apex flip landed and the URL serves the merged all-shells policy, confirmed through the edge in a browser and against the origin via `--html`. Takes operator-supplied bytes with `--html <file>` when Cloudflare 403s the host, the same way `verify-store.sh` takes a real store unpack rather than scraping |
| `verify-demo-endpoints.mjs` |  §2.1 pre-submission gate: can a store REVIEWER reach the endpoints the scripted demo sends them to, from a plain client on no allowlist? Probe list is derived from `packages/core/src/registry/descriptors/`, never restated, and deduplicated by URL. A 200 is not a pass on its own: the hub's chain-registry Ed25519 signature is verified against the pinned federation key, the explorer must name the demo's coin in its `available` map, and the encoder's UTXO tracker must be reachable AND synced. Exits 0 live / 1 failure / 2 config error / 3 inconclusive (timeout, network - never folded into live). **403 is a FAILURE here, not inconclusive**: on these hosts it means the edge block is back, which is the regression this gate exists to catch. `--network mainnet`, `--json`, and `--burst N` for the bounded rate-limit probe (; one request per host cannot see a 0.5 req/sec limit). No custom User-Agent, ever: looking like a browser defeats the point. | Live, and green as of 2026-08-02 on testnet and mainnet: all seven probes OK, encoder trackers synced at lag 0, and a burst of 8 unthrottled |
| `store-version-monitor.mjs` |  §2 publish monitor: compares each configured item's live Chrome Web Store version against `packages/extension/docs/publish-log.md`; a live version with no matching log row is the rogue-publish (compromised-publisher) signal. Exits 0 clean / 1 alert / 2 config error (item id unset or log unreadable) / 3 inconclusive (fetch failure or unrecognized page shape - never folded into clean). Run `node tools/release/store-version-monitor.mjs --help` for flags and the origin-host cron line. | Script built; NOT installed anywhere yet (see the [manual QA checklist](https://docs.xchain.io/components/wallet/release/qa-checklist) "Chrome Web Store release provenance") |
| `verify-signatures.mjs` | 's signature gate, run by `sign.sh` BEFORE the manifest is written: does each staged artifact actually carry the OS code signature its row says it should? The ordering is the point, because K1 attests the bytes and not the publisher, so a manifest written over unsigned installers verifies perfectly forever and every downstream check agrees with it. | Live, and refusing: it is what stops `v0.336.0` being signed, on two unsigned macOS zips and two unsigned Windows installers () |
| `verify-validated-commit.mjs` |  §6 step 1 as a gate instead of a sentence: is this commit one that green CI already validated? Written as procedure and enforced by nothing until, which is how the first release this project ever cut was tagged on a commit whose CI had not passed. Refuses a short SHA and a missing token rather than guessing. | Live |
| `verify-release-key.sh` | Proves the release signing key (K1) by DRIVING the real pipeline end to end rather than by listing commands in a runbook, and records what it saw in `docs/release-key-pin.json`: a key that signed a manifest, a signature that verified, a manifest that anchors to its tag. Only a real run can write that note, which is what ceremony Phase 4b reads. | Live; K1 generated and proved 2026-08-05 |
| `verify-listing-assets.mjs` |  row 42: do the four Chrome Web Store listing assets depict the build being submitted? Their pixel dimensions are checked in two places and their SUBJECT was checked nowhere, so images captured at v0.333.1 sat ready to upload beside a v0.336.0 release. Compares `packages/extension/docs/listing-assets/capture-pin.json` against the bytes on disk and against the commits touching the surfaces each asset depicts. Exits 0 clean / 1 stale / 2 inconclusive. Read-only unless `--write`. | Live; the pin half is gated by `release-tools.smoke.js`, the drift half is asked in ceremony Phase 5 |
| `cws-upload.mjs` |  D4: upload a signed release zip to the Chrome Web Store through the store's own API. Every safeguard in it is a refusal, because a refresh token that can publish to the store IS the publisher account: credentials come from the environment and no path can print one, it refuses a zip no signed manifest describes, and it refuses to publish publicly without being told twice. | Live, and driven against the real staged artifacts, where it refuses correctly (no signed manifest exists yet) |
| `capture-update-check.mjs` |  §7.6: records what an update check actually transmits, so the download page's privacy copy is derived from an observation rather than from a belief. Writes `docs/update-check-capture.json`. | Live |
| `update-info.mjs` |  §7.1: what is a channel pointer, and what did this build actually emit? electron-builder names its update-info files after the CHANNEL rather than after the word "latest", so a lane that assumes `latest-mac.yml` is looking for a file a real build never wrote. | Live |
| `verify-edge-cache.mjs` |  §3 /: the caching contract, measured instead of assumed. Channel pointers must be served no-cache and binaries may cache freely, and that takes two mechanisms rather than one (the origin's `no-store` and a Cloudflare cache-bypass rule on the same paths), so checking one of them proves nothing. | Live (host pending) |
| `verify-android-manifest.mjs` | §5/§7: asserts the manifest facts of a BUILT Android bundle rather than of the source that was meant to produce it. | Live |
| `android-ceremony.sh` | The Android signing ceremony, run on the operator's machine and never in CI: no password is ever passed on a command line or read from the environment, since `jarsigner` and `apksigner` both prompt. | Live, operator-run |
| `ios-archive.sh` | §5: archives the iOS shell for distribution with CLOUD-MANAGED signing, handing `xcodebuild` the App Store Connect API key (K4) rather than installing a distribution certificate on the runner, so the signing identity materializes transiently and is never stored. | Live |
| `ios-export.sh` | §5: exports the archive to an `.ipa`, NAMED here rather than wherever Xcode leaves it, because rails §3 names it and `expected-artifacts.txt` matches on that name: an ipa called `App.ipa` is an undeclared file and hard-fails signing. Carries the lane suffix (`-beta.N`, `-respin.N`). | Live |
| `emulation-preflight.sh` | Decides BEFORE a reproduce run starts whether this host can actually execute the amd64 build. Every reproduce lane pins an amd64-only base image, so an arm64 verifier runs the whole build under emulation and two different emulators can serve that platform flag. | Live |
| `drills/deb-update-swap.mjs` | The install/launch/swap half of a §7.5 rehearsal for the `.deb` lane, watching a real update install itself. It installs and upgrades system packages, so it runs inside a throwaway container and nowhere else. | Drill |
| `electron-cadence.mjs` |  §9 CVE clock: is the Chromium we ship still getting security fixes? Reads the version out of `pnpm-lock.yaml` (the caret in `package.json` is not the pin - every release lane installs `--frozen-lockfile`), then compares it against the registry's dist-tags: newer patches on our own major, newer majors past §9's 28-day rule, and upstream's three-major support window. Exits 0 current / 1 behind / 2 unreadable pin / 3 inconclusive - a registry that cannot be reached is never folded into "current". `--json` for a cron, `--offline <packument>` for tests. | Built 2026-08-02, and it went red on its first run: shipped 41.3.0 while 41.10.3 existed, with 42 and 43 both past the rule. Not yet installed anywhere |

### Installing the store-version monitor on origin-host (DEPLOYED 2026-08-01, DISARMED)

**Status: the script is on the host and the crontab entry is staged and
commented out.** Arming it needs one thing that cannot exist yet, the
store-assigned extension ID, so the last step waits for the first upload
(§4 exit criteria; also a row in the [manual QA checklist](https://docs.xchain.io/components/wallet/release/qa-checklist) "Chrome Web Store
release provenance"). It is disarmed rather than absent on purpose: with
`CWS_MAIN_ITEM_ID` unset the script exits 2 and writes to stderr, so an
armed cron would mail a config error every six hours and train everyone
to ignore the one alert that matters.

Everything else was verified running on origin-host: the log refresh, the
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
   scp tools/release/store-version-monitor.mjs origin-host:/opt/xchain/store-version-monitor.mjs
   ```
   Record the copied commit hash somewhere on the host (a sibling
   `.store-version-monitor.provenance` file, same pattern as the
   watchdog's hand-deployed copy) so a future re-copy is deliberate,
   not a guess at whether the host is stale.
2. Confirm Node 22 on the host: `node --version` (this repo's suites and
   scripts require exactly Node 22; the script uses the global `fetch`
   Node 18+ ships, but stay on the pinned version anyway).
3. Add the crontab entry. `MAILTO` is what makes cron's own mail
   delivery reach a human - the same mechanism already proven live on
   origin-host for the / refresh-status checks (
   closed the SMTP-relay half of that). Redirect stdout only, so a
   clean run (silent on stderr) mails nothing and a run that finds
   something (ALERT or INCONCLUSIVE, both write to stderr) always does:
   ```
   MAILTO=<shared inbox - spec §2 "Correspondence routing" / D1, not yet decided;
           interim per the spec, point this at whatever mailbox is currently
           live for store correspondence>
   0 */6 * * * CWS_MAIN_ITEM_ID=<recorded extension id> \
     CWS_BETA_ITEM_ID=<recorded beta extension id, once that item exists> \
     /usr/bin/node /opt/xchain/store-version-monitor.mjs >/dev/null
   ```
   Item IDs are not secrets (they are already public in every installed
   user's `chrome-extension://<id>/` URL and in the store listing link),
   so they can sit in the crontab in plain text like any other config
   value; nothing this script needs is a credential.
4. The ops-channel leg (posting the same alert to a chat channel, not
   just the inbox) rides the still-open  channel decision. Do not
   build or wire that leg speculatively; add it as a second crontab
   command (or a second sink inside the script) once that decision
   lands, not before.
5. Verify the install without waiting for a real incident: run
   `CWS_MAIN_ITEM_ID=<id> node /opt/xchain/store-version-monitor.mjs`
   by hand on the host once, confirm it exits 0 with a clean summary on
   stdout and nothing on stderr, then leave the cron to carry it going
   forward.

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
key ( S37). It takes the expectation from `--key <fingerprint>`,
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
   reconstruct from .
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
4c. Rehearse the update against the staging feed ( §7.5). Publish
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

   **The deb lane has a drill of its own**, `drills/deb-update-swap.mjs`,
   because its install step is the only one that ends in a root-privileged
   `dpkg -i` and no feed-side probe can reach it. Run inside a throwaway
   container against two real builds one version apart, it installs the
   older `.deb`, drives the real `DebUpdater` against a local feed, and
   requires both that the escalated command line was produced and that the
   installed package version actually moved. It refuses to run anywhere
   that is not obviously disposable - it installs a system package. First
   run 2026-08-02, arm64: `0.334.0 -> 0.334.1`.
5. `bash tools/release/publish.sh --input release-artifacts/vX.Y.Z/
   --tag vX.Y.Z --target <deploy target>
   --public-base https://downloads.xchain.io/wallet --dry-run`, then for
   real. It requires a passing rehearsal record bound to the manifest in
   hand, verifies before uploading, refuses a version that already
   exists, refuses a rehearsal build (or the wrong feed), publishes the
   manifest under its versioned name, fetches every artifact back through
   the edge, and uploads the channel pointers last.
5b. `bash tools/release/deploy-web.sh --tarball <the published tarball>
   --tag vX.Y.Z --webroot <webroot>` for the SPA. Deploy the tarball
   that was signed, never a fresh local build.
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
- ✅ GPG signing works: the release key was generated 2026-08-05 and has signed a manifest end to end. G180's remaining half is publication reaching readers (both channels and the desktop pin are written, the deploy has not run); ceremony runbook is  S3.
- ✅ CI release lanes exist (`.github/workflows/release.yml`); the repository-settings half is a checklist at [https://docs.xchain.io/components/wallet/release/ci-setup](https://docs.xchain.io/components/wallet/release/ci-setup) and is NOT yet configured, so the workflow must not run with real secrets until it is.
- ⏸ `downloads.xchain.io` not yet stood up ( S6); the upload tooling (`publish.sh`), the monitoring (`feed-sweep.mjs`) and the host runbook exist, the host does not. The [verify-release page](https://docs.xchain.io/components/wallet/release/verify-release) still points at GitHub release assets.
- ✅ `publish.sh` and `feed-sweep.mjs` are driven for real, against a signed fixture and a live local HTTP origin, by `test/smoke/audits/publish-feed.smoke.js` and `feed-sweep.smoke.js`. The older coverage of `publish.sh` was greps over its own source, which is how the  stage-1 defect survived: the comments and the code disagreed and both read as correct.
- ✅ The §7.5 rehearsal is enforced, not merely written down: `publish.sh` refuses a production publish without a rehearsal record bound to the signed manifest in hand, so a re-cut release cannot inherit the previous cut's green. Driven end to end, with every refusal path, by `test/smoke/audits/rehearsal.smoke.js`.
- ⏸ The swap half of the rehearsal is blocked on DD4 for seven of eight lanes (the two Linux deb lanes were added 2026-08-02,  §5): `rehearse.mjs coverage` reports which, and refuses to call a lane launch-ready with no named device. `mac-arm64` is the only lane with hardware today.
- ⏸ Cross-platform reproduce (macOS / Windows pre-signing artifacts) pending the desktop reproducibility follow-ups.
- ✅ **Every desktop lane built ONE architecture, not two, and nothing said so** (, found 2026-08-01 by running the reproduce container for the first time). All six invocations read `pnpm -C packages/desktop dist -- --linux --x64 --arm64`. pnpm 9 forwards that `--` into the script's argv verbatim (npm strips it), and electron-builder is yargs-based, so a bare `--` ends option parsing and every flag behind it lands in `argv._` unread. electron-builder then packaged the runner's own arch: linux-x64 from ubuntu, one arch per OS across the matrix. `expected-artifacts.txt` matches by extension rather than per arch, so the signing gate would have passed the release, `stable-linux-arm64.yml` would never have been written, and every arm64 install would have had no download and no update - permanently, and silently. Separator dropped in all six lanes and in `packages/desktop/scripts/build.sh`; `test/smoke/audits/reproducible-toolchain.smoke.js` fails on any pnpm invocation that reintroduces it.
- ✅ **And the gate that let it through is closed** (2026-08-01). Dropping the separator fixed the cause; the reason it went unseen was that `expected-artifacts.txt` declared artifact CLASSES and never counts, so `*.dmg` was satisfied by one dmg. Rows now carry a fourth arch column, `lib.sh` attributes each artifact to an architecture using electron-builder's own naming tokens, and a release missing either arch of any of the six lanes fails by name. The same check refuses an artifact that belongs to NO architecture, which is the un-suffixed combined NSIS installer  - so that decision is now blocking rather than silent. `test/smoke/audits/release-arch-coverage.smoke.js`, 8 drift mutations driven, 8 killed.
- ✅ The release toolchain is pinned end to end (`tools/release/toolchain.json`): the lanes asked `actions/setup-node` for major `22` while the reproduce container pinned `20.18.0`, so no verifier could ever have matched a release. Same guard file.

**Known naming gap.** Desktop installers use electron-builder's default
names, which embed `productName` ("XChain Wallet", with a space) and an
arch suffix that varies by target. `expected-artifacts.txt` therefore
matches them by extension rather than by a convention, with the arch
column above carrying the per-arch requirement the globs cannot. Pinning
an explicit `artifactName` that matches the
`xchain-wallet-<surface>-vX.Y.Z` convention belongs to the desktop spec
( §7.1, with the operator).
