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
enforces before it writes a manifest.

- `*.dmg` / `*mac*.zip`     - desktop macOS
- `*.exe` / `*win*.zip`     - desktop Windows
- `*.AppImage` / `*.deb`    - desktop Linux
- `xchain-wallet-extension-vX.Y.Z.zip`  - extension store bundle
- `xchain-wallet-web-vX.Y.Z.tar.gz`     - static web SPA bundle
- `xchain-wallet-android-vX.Y.Z.aab`    - Play upload bundle (dormant)
- `xchain-wallet-ios-vX.Y.Z.ipa`        - App Store upload (dormant)

The two mobile names are declared but optional: the Capacitor shells
are scoped post-v1.0 ( Android,  iOS). They are pinned
here so both shells cannot invent divergent names later.

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
| `publish.sh` | §6 step 5: upload a signed release to the feed, channel pointers last, with an edge check between the two and a cache purge after. | Live |
| `feed-sweep.mjs` | Runs on the feed host by cron: validates every published object against the union of the signed manifests, and every channel pointer against the bytes it names. | Live |
| `deploy-web.sh` | §6 step 5b: unpack the web tarball into a versioned directory and flip a symlink. | Live |
| `expected-artifacts.txt` | The declared artifact set a release must contain. Data, not code. | Live |

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
4b. Rehearse the update against the staging feed ( §7.5): publish
   the staging set with `--staging`, then install the PREVIOUS release's
   rehearsal build and watch it take the new one. No production pointer
   goes up before this passes.
5. `bash tools/release/publish.sh --input release-artifacts/vX.Y.Z/
   --tag vX.Y.Z --target origin-host-downloads:wallet
   --public-base https://downloads.xchain.io/wallet --dry-run`, then for
   real. It verifies before uploading, refuses a version that already
   exists, refuses a rehearsal build (or the wrong feed), publishes the
   manifest under its versioned name, fetches every artifact back through
   the edge, and uploads the channel pointers last.

   Needs GNU rsync, not the openrsync macOS ships: the feed's deploy key
   is pinned to a forced `rrsync` command, and openrsync sends an option
   its allowlist rejects. `publish.sh` refuses rather than letting you
   debug the resulting syntax error.
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
- ✅ The feed host is stood up on origin-host (tree, restricted deploy key, staging feed, hourly `feed-sweep.mjs` cron) and was exercised with a real signed publish end to end. **DNS, the Cloudflare cache rules and the purge token are still outstanding**, so nothing resolves at `downloads.xchain.io` yet and the edge check has never run against Cloudflare. `docs/Verify_Release.md` still points at GitHub release assets.
- ✅ `publish.sh` and `feed-sweep.mjs` are driven for real, against a signed fixture and a live local HTTP origin, by `test/smoke/audits/publish-feed.smoke.js` and `feed-sweep.smoke.js`. The older coverage of `publish.sh` was greps over its own source, which is how the  stage-1 defect survived: the comments and the code disagreed and both read as correct.
- ⏸ Cross-platform reproduce (macOS / Windows pre-signing artifacts) pending the desktop reproducibility follow-ups.

**Known naming gap.** Desktop installers use electron-builder's default
names, which embed `productName` ("XChain Wallet", with a space) and an
arch suffix that varies by target. `expected-artifacts.txt` therefore
matches them by extension rather than by a convention. Pinning an
explicit `artifactName` that matches the
`xchain-wallet-<surface>-vX.Y.Z` convention belongs to the desktop spec
.
