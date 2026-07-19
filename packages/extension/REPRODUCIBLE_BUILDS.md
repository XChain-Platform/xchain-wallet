# Reproducible builds - @xchain-wallet/extension

XChain Wallet aims for **Level-2 reproducibility of the pre-submission
artifact** per §51 of `XCHAIN_WALLET_SPEC.md`. Any independent verifier
can rebuild the Chrome MV3 extension from source and produce the exact
same unpacked `packages/extension/dist/` bundle that the maintainer
submits to the Chrome Web Store. Combined with the published
`RELEASE_HASHES.txt` for each tag, that closes a real verification loop
for the unpacked bundle.

This document describes the protocol: what we promise, what we
explicitly don't, and how to verify a release.

---

## What's reproducible

- **The unpacked MV3 bundle** produced by `pnpm --filter
  @xchain-wallet/extension build` (Vite production build) under
  `packages/extension/dist/`: popup, service worker, content script,
  inject script, `manifest.json`, and resized icons.
- **The SHA256 of every file in that directory** as captured in
  `RELEASE_HASHES.txt` (emitted by `scripts/build.sh`).

## What's NOT reproducible

- **The published `.crx`.** The Chrome Web Store re-packages and
  re-signs the extension server-side; the store-delivered `.crx` embeds
  a Google-issued signature and will never be byte-for-byte identical to
  a locally built one. Reproducibility here covers the **pre-store
  unpacked bundle** - the content going into submission - not the store
  output. This is a Web-Store-ecosystem-wide constraint, not an
  XChain-specific gap.
- **Icon rasterization drift.** Icons are resized from source SVG/PNG by
  `sharp` at build time. `sharp` normally resolves a prebuilt binary
  pinned by the lockfile; the reproduce image keeps a C/C++ toolchain
  present so a fallback source build stays deterministic rather than
  failing the reproduction.

## Verification protocol

Prerequisites: Docker, git, bash.

```bash
# From anywhere inside the repo:
bash packages/extension/scripts/reproduce.sh v0.333.1 ./verify-out

# Or via the package script (builds current HEAD):
pnpm --filter @xchain-wallet/extension reproduce
```

The script checks out the tag in an isolated worktree, builds the
digest-pinned image, runs the in-container build, and prints the
resulting `RELEASE_HASHES.txt`. Diff it against the official manifest
published with the release tag. Expect the unpacked bundle to match; the
store-published `.crx` will not.

The in-container build also runs `tools/build-reproduce/check-no-dev-mock.sh`,
so a bundle that reached the dev-mock SDK fallback fails before a manifest
is ever emitted.
