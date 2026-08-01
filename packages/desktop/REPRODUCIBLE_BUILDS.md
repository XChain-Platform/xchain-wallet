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

- **The pre-signing Linux app bundle** produced by `dist:unpacked`
  (electron-builder's `--dir` mode). This is the `linux-unpacked/`
  directory inside `packages/desktop/dist/`, containing the asar
  archive + the Electron binary + supporting resources.
- **The SHA256 of every file in that directory** as captured in
  `RELEASE_HASHES.txt` (emitted by `scripts/build.sh` at the end of
  each run).

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
- **The Electron framework download itself.** electron-builder fetches
  prebuilt Electron binaries from Electron's dist server; we verify
  the SHA256 against electron-builder's baked-in manifest but we
  can't elide the trust assumption without shipping a self-built
  Chromium fork. This is a known Electron-ecosystem-wide constraint.

## Verification protocol

Prerequisites: Docker, git, bash.

```bash
# Clone the repo and check out the tag you want to verify.
git clone https://github.com/XChain-platform/xchain-wallet.git
cd xchain-wallet

# Run reproduction against a specific tag.
bash packages/desktop/scripts/reproduce.sh v0.58.0

# Compare the resulting manifest against the official release's hashes.
diff reproduce-out/RELEASE_HASHES.txt \
     <(curl -fsSL https://github.com/XChain-platform/xchain-wallet/releases/download/v0.58.0/RELEASE_HASHES.txt)
```

A zero-byte diff means the build is reproducible and the maintainer's
pre-signing artifact matches what source produces. Any diff is
diagnostic:

- **Toolchain drift** - Node/pnpm pinning mismatch. Check your Docker
  image was built against the tag's `Dockerfile`, not a cached older
  image.
- **Timestamp leakage** - electron-builder's `SOURCE_DATE_EPOCH`
  support missed a path. Open an issue; this is a bug on our side.
- **Supply-chain tampering** - the maintainer's build environment
  produced a different artifact than source does. Investigate.

## Non-determinism sources we've addressed

- `SOURCE_DATE_EPOCH=<commit author date>` - injected by `reproduce.sh`
  from the git commit being built. Honoured by electron-builder for
  asar entry mtimes + mksquashfs (AppImage) + ar (deb).
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
- **Linux (.AppImage / .deb)**: the `stable-linux.yml` manifest
  (`stable-linux-arm64.yml` on arm64; update-info files are named after
  the CHANNEL, and ours is `stable`)
  carries the SHA512 of the artifact. The manifest itself is fetched
  over HTTPS from `downloads.xchain.io` - integrity for Linux users
  depends on HTTPS TLS + the maintainer's control of that hostname.
  A stronger chain (GPG-signed manifests, TUF-style role separation)
  is a post-1.0 consideration.

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

When cutting an official release:

1. Run `pnpm install --frozen-lockfile` + full test suite locally.
2. Tag the commit (`git tag vX.Y.Z`).
3. Run `scripts/reproduce.sh vX.Y.Z ./release-out`.
4. Copy `release-out/RELEASE_HASHES.txt` into the release tag's
   attachments + a `RELEASE_HASHES.md` in the repo.
5. Produce signed artifacts via `pnpm --filter @xchain-wallet/desktop
   run dist` with signing env vars set. macOS + Windows runs happen
   on platform-specific runners; Linux signing runs anywhere.
6. Sign each artifact's SHA256 with the release GPG key + publish the
   `.sig` alongside the artifact.
7. Update `latest-*.yml` on `downloads.xchain.io` so running installs
   pick up the new version via electron-updater.
