# Reproducible builds - @xchain-wallet/web

XChain Wallet aims for **Level-2 reproducibility of the shipped
artifact** per §51 of `XCHAIN_WALLET_SPEC.md`. Any independent verifier
can rebuild the browser SPA from source and produce the exact same
`packages/web/dist/` content that the maintainer deploys for an official
release. Combined with the published `RELEASE_HASHES.txt` for each tag,
that closes a real verification loop.

This document describes the protocol: what we promise, what we
explicitly don't, and how to verify a release.

---

## What's reproducible

- **The static SPA bundle** produced by `pnpm --filter @xchain-wallet/web
  build` (Vite production build) under `packages/web/dist/`.
- **The SHA256 of every file in that directory** as captured in
  `RELEASE_HASHES.txt` (emitted by `scripts/build.sh` at the end of each
  run).

Determinism comes from a digest-pinned base image, a SHA256-verified
Node tarball, a pnpm version pinned via the root `packageManager` field,
`pnpm install --frozen-lockfile`, and `SOURCE_DATE_EPOCH` derived from
the release commit's date.

## What's NOT reproducible

- **The deployment pipeline is the trust boundary.** The served bundle
  is whatever the hosting deploy pushes; reproducibility proves the
  `dist/` you can rebuild matches the tag, not that the live site serves
  those exact bytes. Verify the deployed asset hashes separately against
  `RELEASE_HASHES.txt` if that matters to your threat model.
- **CDN / edge transforms.** Any minification, compression, or asset
  rewriting applied by a CDN happens outside this build and is not
  covered.

## Verification protocol

Prerequisites: Docker, git, bash.

```bash
# From anywhere inside the repo:
bash packages/web/scripts/reproduce.sh v0.333.1 ./verify-out

# Or via the package script (builds current HEAD):
pnpm --filter @xchain-wallet/web reproduce
```

The script checks out the tag in an isolated worktree, builds the
digest-pinned image, runs the in-container build, and prints the
resulting `RELEASE_HASHES.txt`. Diff it against the official manifest
published with the release tag. A mismatch means either build-environment
drift (a toolchain pinning bug) or supply-chain tampering.

The in-container build also runs `tools/build-reproduce/check-no-dev-mock.sh`,
so a bundle that reached the dev-mock SDK fallback fails before a manifest
is ever emitted.
