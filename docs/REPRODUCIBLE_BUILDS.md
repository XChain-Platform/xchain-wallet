# Reproducible builds — XChain Wallet (root)

This document is the project-wide entry point for reproducible builds
across every wallet shell. Each target ships its own deeper `REPRODUCIBLE_BUILDS.md`
or equivalent script under its package; this file orients readers,
states the project-wide promise, and links out.

**Spec reference:** §51 of `XCHAIN_WALLET_SPEC.md` — Build and Release
Per Target.

---

## What "reproducible" means here

XChain Wallet aims for **Level-2 reproducibility of the pre-signing
artifact**. Any independent verifier with a clean checkout, the pinned
toolchain, and the published environment can rebuild from a tagged
commit and produce the exact same unsigned bundle that the maintainer
signs for the official release. Combined with published SHA-256 hashes
per release, that closes a real verification loop without the
operational overhead of multi-party signing (Level 3).

What this protects against:

- A maintainer's machine being compromised to inject a backdoor into
  the artifact between source and signing.
- Silent tampering with published artifacts on the download host.
- "Mystery binary" releases where users have no way to verify the
  bytes they install correspond to the source they can read.

What this does NOT protect against (out of scope for Level 2):

- The Electron / Chromium upstream supply chain (we use prebuilt
  binaries; a self-built Chromium fork is not realistic at our scale).
- Operating-system-vendor signing infrastructure (Apple notarization,
  Microsoft Authenticode). Signed outputs are inherently maintainer-specific
  — Level 2 verifies the *content going in to* signing, not the signed
  byte stream.
- The maintainer's signing keys themselves. Key rotation + hardware
  signers + revocation is a separate concern tracked under §51 and
  surfaced in `SECURITY.md`.

---

## Per-target status

| Target | Package | Artifact | Status | Doc |
|---|---|---|---|---|
| Desktop | `packages/desktop` | Linux pre-signing `linux-unpacked/` directory | Reproducible (Level 2). macOS / Windows publish maintainer-built pre-signing SHAs only — see desktop doc for rationale | [`packages/desktop/REPRODUCIBLE_BUILDS.md`](../packages/desktop/REPRODUCIBLE_BUILDS.md) |
| Extension | `packages/extension` | Unpacked extension directory + signed `.zip` for the Chrome / Firefox / Edge stores | Pre-signing reproducibility shipping alongside store-listing automation in §51 follow-up; build is deterministic today (Vite + frozen-lockfile) but the per-release SHA capture is not yet published | tracked in `MAINTAINERS.md` |
| Web | `packages/web` | Static SPA bundle uploaded to `downloads.xchain.io` | Build is deterministic; artifact integrity ships via Subresource Integrity (SRI) attributes on script / link tags so the browser refuses to execute a tampered file. Per-release SHA-256 capture lands in tandem with extension publishing | same |

---

## Verification protocol — desktop (Linux)

The end-to-end recipe lives in the desktop doc. Short version:

```bash
git clone https://github.com/XChain-platform/xchain-wallet.git
cd xchain-wallet
bash packages/desktop/scripts/reproduce.sh vX.Y.Z

diff reproduce-out/RELEASE_HASHES.txt \
     <(curl -fsSL "https://github.com/XChain-platform/xchain-wallet/releases/download/vX.Y.Z/RELEASE_HASHES.txt")
```

Zero-byte diff = reproducible. Any diff means either toolchain drift,
a regression in our determinism handling, or supply-chain tampering —
see the desktop doc's diagnostics section.

For the broader user-facing story — "I downloaded a release artifact;
how do I verify it?" — see [`docs/VERIFY-RELEASE.md`](VERIFY-RELEASE.md).

## Verification protocol — extension and web

These targets do not yet ship a reproduce script. The deterministic-build
pipeline exists (Vite + `pnpm install --frozen-lockfile` + pinned Node
+ deterministic chunk filenames); what is missing is the per-release
hash-capture-and-publish step. That work is sequenced behind:

1. Release-signing infrastructure (§51 / `tools/release/sign.sh`,
   currently tracked as G158 in the gap ledger).
2. SHA-256 manifest publication (currently tracked as G159).
3. SRI manifest generation for the web SPA (currently tracked as G160).

Until those land, treat the extension store-signed `.zip` and the
web SPA SRI hashes as the authoritative integrity artifact for those
targets. The store / browser enforces them at install time.

---

## Non-determinism sources we have addressed

Across every shell:

- **`pnpm install --frozen-lockfile`** rejects builds against an
  out-of-sync lockfile. Any dep-tree change requires a lockfile update
  + commit before a tag is cut.
- **Pinned Node version** declared in `.nvmrc` / `package.json` engines.
  Reproduction containers honor it.
- **`SOURCE_DATE_EPOCH=<commit author date>`** injected by reproduce
  scripts. Honored by Vite, electron-builder asar packing,
  `mksquashfs` (AppImage), and `ar` (deb). Web bundles sidestep mtime
  embedding.
- **`LC_ALL=C.UTF-8 TZ=UTC`** pinned in both Dockerfile and
  in-container env so locale-sensitive tools (`sort`, `date`) emit
  deterministic output.
- **Vite** — source maps off in production, deterministic chunk +
  asset filenames, `assetsInlineLimit: 0` to prevent small-file
  inlining variance, no plugin that captures `Date.now()` or random
  IDs.
- **electron-builder** (desktop) — `npmRebuild: false`,
  `buildDependenciesFromSource: false`, deterministic uninstaller
  names, SHA-256-pinned rfc3161 timestamp server.

If you find a non-determinism source not listed here, file an issue
under the `reproducibility` label — it is a bug.

---

## Trust boundaries

A reproducible build is one of three legs of release trust. The other
two are GPG-signed release artifacts (G158 / G180) and a verification
flow ([`docs/VERIFY-RELEASE.md`](VERIFY-RELEASE.md)). All three are
tracked under §51 in the spec gap ledger. Until G180 is live, the
release fingerprint is published in [`SECURITY.md`](../SECURITY.md).

The Electron framework download (used by the desktop shell) and the
Trezor Connect iframe (loaded at runtime under a strict CSP) are
documented trust boundaries — see the desktop doc for the full
narrative including the Trezor on-device-display mitigation.
