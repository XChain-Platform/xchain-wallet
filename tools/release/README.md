# Release-signing pipeline - `tools/release/`

Spec reference: `claude/reports/xchain-wallet/XCHAIN_WALLET_SPEC.md` §51.
Release-engineering rails shared by every shell (versioning, channels,
credential inventory, CI matrix, the full release procedure and its
rollback story): `claude/specs/wallet-release-rails.md` .

This directory holds the scripts and conventions for cutting a signed
release. The gates all run today; the GPG signing step itself is
blocked on the maintainer's release key being generated and published
(G180 in `claude/reports/xchain-wallet/SPEC_GAPS.md`), so `sign.sh`
exits with a clear error pointing at `SECURITY.md` until then.

The companion verification side lives at `docs/Verify_Release.md` -
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
  `docs/QA_Checklist.md` "Chrome Web Store release provenance" for the
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
| `sign.sh` | Run the release gates, compute the SHA-256 manifest, and GPG-sign it. | Gates live; signing blocked on G180 |
| `verify.sh` | Verify a manifest: hashes, header anchor, and GPG signature. Mirrors `docs/Verify_Release.md`. | Live |
| `publish.sh` | §6 step 5: upload a signed release to the feed, channel pointers last, with an edge check between the two and a cache purge after. | Live (host pending) |
| `feed-sweep.mjs` | Runs on the feed host by cron: validates every published object against the union of the signed manifests, and every channel pointer against the bytes it names. | Live (host pending) |
| `rehearse.mjs` |  §7.5: probes every shipped update lane against the staging feed (pointer, per-arch selection, download, sha512, signed manifest), records human-attested swaps, and gates the production publish on the result. | Live (host pending) |
| `rehearsal-matrix.mjs` | The shipped update lanes and the named hardware each is smoked on (DD4). Data, not code. | Live |
| `deploy-web.sh` | §6 step 5b: unpack the web tarball into a versioned directory and flip a symlink. | Live |
| `expected-artifacts.txt` | The declared artifact set a release must contain. Data, not code. | Live |
| `verify-store.sh` |  §4 post-publish verification: verifies the CI-built extension zip via `verify.sh`, then diffs it file-by-file against the store-served item (`--unpacked-dir` or `--crx`), skipping `_metadata/` and structurally diffing `manifest.json`. | Live |
| `manifest-diff.mjs` | Structural JSON diff helper for `verify-store.sh`: deep-equal ignoring named top-level keys (default `update_url`, `key`). | Live |
| `rollback-rerelease.sh` |  §4 rollback-as-re-release recipe: validates preconditions (tag exists, new version is strictly higher) and prints the manual re-release sequence. There is no rollback lever; see the script's own header. | Live |
| `verify-privacy-url.mjs` |  §5/D5 pre-submission check: is the public privacy-policy URL live, answering directly (no redirect hop), and serving this repo's current `docs/Privacy_Policy.md` word for word. Compares prose, not bytes, since the hosted page is rendered Markdown. Exits 0 live / 1 not live, redirecting, or stale / 2 config error / 3 inconclusive (403, timeout, network - never folded into live). **Do not use `curl` for this instead: Cloudflare answers plain tooling with 403 on every path of this domain, live page or not.** | Live, and green as of 2026-08-01: the apex flip landed and the URL serves the merged all-shells policy, confirmed through the edge in a browser and against the origin via `--html`. Takes operator-supplied bytes with `--html <file>` when Cloudflare 403s the host, the same way `verify-store.sh` takes a real store unpack rather than scraping |
| `store-version-monitor.mjs` |  §2 publish monitor: compares each configured item's live Chrome Web Store version against `packages/extension/docs/publish-log.md`; a live version with no matching log row is the rogue-publish (compromised-publisher) signal. Exits 0 clean / 1 alert / 2 config error (item id unset or log unreadable) / 3 inconclusive (fetch failure or unrecognized page shape - never folded into clean). Run `node tools/release/store-version-monitor.mjs --help` for flags and the origin-host cron line. | Script built; NOT installed anywhere yet (see `docs/QA_Checklist.md` "Chrome Web Store release provenance") |

### Installing the store-version monitor on origin-host (DEPLOYED 2026-08-01, DISARMED)

**Status: the script is on the host and the crontab entry is staged and
commented out.** Arming it needs one thing that cannot exist yet, the
store-assigned extension ID, so the last step waits for the first upload
(§4 exit criteria; also a row in `docs/QA_Checklist.md` "Chrome Web Store
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
  --artifact 'XChain Wallet-0.333.1.AppImage'
```

### One signature, checked three ways

The manifest is signed once, by K1, with GPG. That single signature is
checked by `verify.sh`, by a user following
`docs/Verify_Release.md`, and at runtime by the desktop updater
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
| `GNUPGHOME` | Optional override for the GPG home directory. | both |
| `SIGN_SKIP_DEV_MOCK_CHECK` | Set to `1` to skip the pre-sign dev-mock gate. Recorded in the signed header. Release runs never set it. | `sign.sh` |

**One-shot pnpm wrappers.** The root `package.json` exposes
`pnpm release:sign` and `pnpm release:verify`, which target
`release-artifacts/<version>` and pass `--tag v<version>`, both read
from the root `package.json` at invocation time.

## Per-release procedure

The authoritative checklist is §6 of
`claude/specs/wallet-release-rails.md`, instantiated per release as
`claude/reports/wallet-releases/vX.Y.Z.md`. What this directory owns:

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

See [`tools/build-reproduce/`](../build-reproduce/) and each package's
`REPRODUCIBLE_BUILDS.md` for the per-shell verification protocol.

## Status today

- ✅ Scripts, gates, manifest header and the artifact-set list are live and covered by `test/smoke/audits/release-tools.smoke.js`.
- ✅ Dev-mock gate scans every shipped shell bundle, including the desktop renderer.
- ⏸ Actual GPG signing pending G180 (release key generation + publication; ceremony runbook is  S3).
- ✅ CI release lanes exist (`.github/workflows/release.yml`); the repository-settings half is a checklist in `docs/Release_CI_Setup.md` and is NOT yet configured, so the workflow must not run with real secrets until it is.
- ⏸ `downloads.xchain.io` not yet stood up ( S6); the upload tooling (`publish.sh`), the monitoring (`feed-sweep.mjs`) and the host runbook exist, the host does not. `docs/Verify_Release.md` still points at GitHub release assets.
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
