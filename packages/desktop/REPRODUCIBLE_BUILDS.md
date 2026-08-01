# Reproducible builds - @xchain-wallet/desktop

XChain Wallet aims for **Level-2 reproducibility of the pre-signing
artifact** per §51 of `XCHAIN_WALLET_SPEC.md`. Any independent
verifier can rebuild from source and produce the exact same unsigned
`.app` / `.exe` / `.AppImage` content that the maintainer signs for an
official release. Combined with the published `RELEASE_HASHES.md` for
each tag, that closes a real verification loop without the
operational overhead of multi-party signing (Level 3).

This document describes the protocol: what we promise, what we
explicitly don't, and how to verify a release.

---

## What's reproducible

- **The pre-signing Linux app bundles** produced by `dist:unpacked`
  (electron-builder's `--dir` mode), for **both shipped architectures**:
  `linux-unpacked/` (x64) and `linux-arm64-unpacked/`, inside
  `packages/desktop/dist/`. Each contains the asar archive + the
  Electron binary + supporting resources.
- **The SHA256 of every file in both directories** as captured in
  `RELEASE_HASHES.txt` (emitted by `scripts/build.sh` at the end of
  each run).

Both arches are listed because both are released (§2 of the publishing
spec). Until 2026-08-01 `build.sh` passed no architecture flags, so it
built whatever the host was and this document's promise silently covered
x64 only: the arm64 bundle real users install had no published
pre-signing hash and no way for anyone to check it. The set now comes
from `tools/release/toolchain.json`, and the guard test holds the release
lane to the same list so neither side can quietly ship an arch the other
does not cover.

## What a third party cannot do yet, and why

**Reproduction currently requires both repositories, so it is available to
the maintainer and not to the public.** `packages/desktop` depends on the
SDK as `"xchain-sdk": "link:../../../xchain-sdk"` - a filesystem link to a
sibling repository, three levels above this one. Someone who follows the
protocol below against a clone of `xchain-wallet` alone gets:

```
[vite]: Rollup failed to resolve import "xchain-sdk/src/wallet.js"
```

`xchain-sdk` is `private: true` and unpublished, so there is nothing for
them to install. This is not a bug in the container or the script; it is
the shape of the dependency, and it means the Level-2 claim at the top of
this file is, today, a claim about a build only we can run. Closing it is
a distribution decision (publish the SDK, vendor it into this repo, or
depend on it by pinned git commit) and it is registered under 
rather than quietly patched here.

What works now: with both repos checked out side by side, `reproduce.sh`
builds from a detached worktree of the SDK's committed state - never the
sibling's working tree - and records the exact SDK commit in the manifest
header. That matters even for us, because the same wallet tag against a
different SDK commit is a different artifact, and without the header two
manifests could disagree for a reason neither one stated.

## What's NOT reproducible

- **Signed artifacts (`.dmg`, signed `.app`, signed `.exe`,
  notarized builds).** Code signatures embed a certificate-specific
  signature plus, for macOS, Apple's notarization ticket. These
  outputs are inherently maintainer-specific. The pre-signing artifact
  hashes let verifiers prove that the *content* going into signing
  matches what was built from source.
- **macOS and Windows builds.** The reproducible-build container
  targets Linux only. Cross-compiling macOS (requires `lipo` +
  Apple's signing toolchain) and Windows (requires a Windows runner
  for Authenticode signing) to match bit-for-bit is a significantly
  larger undertaking. For now, macOS and Windows releases publish
  pre-signing SHAs produced on a Mac runner / Windows runner the
  maintainer operates; a later phase may add VM-based reproduction
  for those.
- **Anything on a host that is not amd64, natively.** The pinned base
  image digest resolves to `linux/amd64` and nothing else, and
  `reproduce.sh` passes `--platform linux/amd64` explicitly so that is a
  stated cost rather than a surprise. This is deliberate: the release
  lane runs on an amd64 runner and cross-builds the arm64 artifact from
  there, so an arm64 container would faithfully reproduce a build we
  never cut. Verifiers on Apple Silicon or arm64 Linux need working
  emulation (Rosetta, or qemu via binfmt); reproduction has been
  exercised that way and works, at a speed penalty.
- **The Electron framework download itself.** electron-builder fetches
  prebuilt Electron binaries from Electron's dist server; we verify
  the SHA256 against electron-builder's baked-in manifest but we
  can't elide the trust assumption without shipping a self-built
  Chromium fork. This is a known Electron-ecosystem-wide constraint.

## Verification protocol

Prerequisites: Docker, git, bash.

```bash
# Clone the repo and check out the tag you want to verify.
git clone https://github.com/XChain-Platform/xchain-wallet.git
cd xchain-wallet

# Run reproduction against a specific tag.
bash packages/desktop/scripts/reproduce.sh v0.58.0
```

That emits `reproduce-out/RELEASE_HASHES.txt`: the SHA256 of every file
in both pre-signing Linux bundles.

> **What you cannot yet diff it against, stated plainly.** This document
> used to end the recipe with a diff against the release's published
> `RELEASE_HASHES` manifest and call a zero-byte result the proof. That
> comparison cannot succeed and never could. The published manifest
> covers the PACKAGED artifacts a user downloads (`.AppImage`, `.deb`,
> `.dmg`, `.exe`, the web tarball; see
> `tools/release/expected-artifacts.txt`), while this script runs
> electron-builder in `--dir` mode, which produces unpacked directories
> and no installer at all. The two file sets do not overlap by a single
> name, so the diff is guaranteed non-empty on a perfectly reproducible
> build. Closing that loop needs a decision we have not taken: either
> publish a separate pre-signing manifest per release, or have this
> script build the packaged Linux artifacts and compare those directly
> (they carry no code signature, so unlike macOS and Windows they are
> reproducible as shipped). Tracked under ; until it lands, what
> this script gives you is a self-consistency check between two of your
> own runs, and a byte-level basis for comparing notes with another
> verifier, not a check against us.

Two runs of the same tag must produce byte-identical manifests. Any diff
between them is diagnostic:

- **Toolchain drift** - Node/pnpm pinning mismatch. Check your Docker
  image was built against the tag's `Dockerfile`, not a cached older
  image. `build.sh` now asserts the running Node against the version
  the ref pins and aborts with that message rather than letting a stale
  cached image express itself as a hash diff, which is the one drift no
  file comparison can catch.
- **Timestamp leakage** - electron-builder's `SOURCE_DATE_EPOCH`
  support missed a path. Open an issue; this is a bug on our side.
- **Supply-chain tampering** - the maintainer's build environment
  produced a different artifact than source does. Investigate.

## Non-determinism sources we've addressed

- `SOURCE_DATE_EPOCH=<commit author date>` - injected by `reproduce.sh`
  from the git commit being built. Honoured by electron-builder for
  asar entry mtimes + mksquashfs (AppImage) + ar (deb). **Author date,
  `%at`, on both sides.** `reproduce.sh` used to read `%ct`, the
  committer date, while the release lane read `%at`. They are equal only
  for a commit that was never rebased or amended, and 10 of the last 200
  commits in this repo diverge, by up to 36 minutes. On any of those tags
  the verifier stamped a different instant into the asar than the release
  did, so the hashes could not match and the protocol below told the
  verifier to suspect tampering.
- **The toolchain itself is pinned once, for both sides.**
  `tools/release/toolchain.json` holds the exact Node version (and its
  tarball SHA256) that the reproduce container installs *and* that every
  release lane installs. This is the pin the section below depends on and
  it did not exist before 2026-08-01: the lanes asked
  `actions/setup-node` for major `22`, which resolves to whatever patch
  is newest on the day the lane runs, while the container pinned an exact
  `20.18.0`. Two releases cut a month apart were built by different
  toolchains and neither matched what a verifier would produce.
  `test/smoke/audits/reproducible-toolchain.smoke.js` fails the build if
  any of the four homes drifts, or if a lane goes back to floating.
- `LC_ALL=C.UTF-8 TZ=UTC` - pinned in both the Dockerfile and the
  in-container env so locale-sensitive tools (sort, date) emit
  deterministic output.
- `pnpm install --frozen-lockfile` - rejects builds against an
  out-of-sync lockfile. Any dep-tree change requires a lockfile
  update + commit before a tag is cut.
- Vite: source maps off, deterministic chunk/asset filenames,
  `assetsInlineLimit: 0` to prevent small-file inlining variance.
- electron-builder: `npmRebuild: false`, `buildDependenciesFromSource:
  false`, deterministic uninstaller names, SHA256-pinned rfc3161
  timestamp server (which lives under `win.signtoolOptions` since the
  v26 upgrade), and `nsis.differentialPackage: false` so no delta
  metadata is emitted for updates we do not serve.
- **The toolchain version is part of the output.** electron-builder is
  pinned in `packages/desktop/package.json` and resolved through the
  committed lockfile; a major bump (25 → 26,  stage 2) changes the
  produced bytes, so pre-signing hashes published against an earlier
  builder do not carry over and must be regenerated.

## Update trust chain

`electron-updater` validates downloaded artifacts by:

- **Windows / macOS**: signature must match the currently-installed
  app's publisher. Downgrade attacks across publishers are blocked.
- **Linux (.AppImage / .deb)**: the `stable-linux.yml` update-info file
  (`stable-linux-arm64.yml` on arm64; these are named after the CHANNEL,
  and ours is `stable`) carries the SHA512 of the artifact. On its own
  that is a checksum served by the same host as the binary, not a
  signature, so it would leave Linux integrity resting entirely on TLS
  plus our control of the hostname.

**That is no longer where it rests.**  S5 shipped the stronger
chain, so the paragraph above describes only what `electron-updater`
itself does. Before any update installs, on every platform,
`main/updateVerify.js` fetches the K1-signed `RELEASE_HASHES/<tag>.txt`
for the version being offered, verifies the detached signature against a
copy of the release key **compiled into the app**
(`UPDATE_PINNED_PUBKEY_ARMORED` + `UPDATE_PINNED_FINGERPRINT`), and
refuses to install an artifact the signed manifest does not cover. It
fails closed: there is no "could not check, carry on" branch, and
`downloadAndInstall()` is the only install path, so no second unverified
route exists to be wired up later.

For Linux that promotes the trust root from the download host to the
pinned key, which is the whole point: compromising `downloads.xchain.io`
or the CDN in front of it afterwards buys an attacker nothing. The cost
is that rotating K1 requires shipping a wallet release.

The verifier now derives the manifest's base URL from the bundle's own
`app-update.yml` rather than a compiled-in production constant, so an
update and its proof always ride the same feed. That is not a
feed-override affordance: it reads a build-time file inside the signed
bundle. It exists because a staging rehearsal build otherwise downloaded
from staging and demanded its proof from production, where staging
artifacts are deliberately absent, and so could never pass.

## Trezor Connect trust boundary

The desktop app loads the Trezor Connect iframe from
`https://connect.trezor.io` (see `renderer/index.html`'s CSP). Content
Security Policy makes this dependency explicit: the renderer's own
code never fetches from that domain - only the Trezor popup iframe
does, and it lives in a separate origin bound by `frame-src`.

Mitigating factor: Trezor's on-device display is the trust anchor for
signing. Even a fully-compromised Connect iframe cannot sign a
transaction the user did not physically approve on the device. See
the Step-18 CHANGELOG entry for the full risk analysis and the future
migration path (local bundling + `app://` scheme).

## Per-release checklist

This section used to carry its own release recipe, which had drifted
away from the real one in three ways that all pointed the same
direction - towards a release that looks done and updates nobody. It
told you to publish `latest-*.yml`, a filename that has never existed at
channel `stable` and that nothing fetches; to sign a `.sig` per artifact
rather than the one manifest that is actually signed; and to create the
tag unsigned, which the release workflow now refuses. A second copy of a
procedure is a copy that goes stale, so it has been removed rather than
corrected.

**The authoritative checklist is [`tools/release/README.md`](../../tools/release/README.md)**,
instantiated per release under `claude/reports/wallet-releases/`. What
belongs to *this* document is only the reproducibility step inside it:

```bash
bash packages/desktop/scripts/reproduce.sh vX.Y.Z ./release-out
```

Run it against a pristine clone at the tag, before signing, and keep
`release-out/RELEASE_HASHES.txt` with the release record. The diff line
that used to sit here pointed at the signed manifest, which covers a
disjoint set of files (see the callout under "Verification protocol"), so
it could not have passed; do not reintroduce it until the pre-signing
manifest question is decided. What this step buys today is that the
release was built from a pinned toolchain and that the bundle hashes are
recorded at the moment of signing.
