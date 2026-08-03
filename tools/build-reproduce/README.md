# Reproducible builds - `tools/build-reproduce/`

Spec reference: `claude/reports/xchain-wallet/XCHAIN_WALLET_SPEC.md` §51.4.

## Goal

A third party can check out the published source tag, run `./verify.sh <tag>`, and get a byte-identical set of artifacts to what the project release-signed. If the hashes match, they've verified the build. If they don't, the release is suspicious and should be investigated before trusting it.

Phase 1 ships the scaffolding: the pinned toolchain, the verify script, and the hash manifest the release pipeline produces. The actual byte-identical guarantee is a property of the whole toolchain (Node version, pnpm version, OS, `sharp` native binaries, Vite output determinism) and takes iteration to land - this directory is where that work happens.

## Pinning

- **Node:** Node 18 LTS while the wallet is under development (Node 18.19.1 is the local-dev baseline). Mainnet RC pipelines will pin to a specific patch to avoid drift; the pin lives here in this README until the release pipeline codifies it.
- **pnpm:** `packageManager` field in the root `package.json` (`pnpm@9.0.0`).
- **Dependencies:** `pnpm-lock.yaml` committed. `pnpm install --frozen-lockfile` in CI prevents silent upgrades.
- **Native binaries:** `sharp` (icon resize) pulls platform-specific prebuilts. Reproducible builds pin the target OS + architecture - currently `ubuntu-latest` on x64 (GitHub's CI image).

## verify.sh

The verify script (planned for the RC-1 release) does:

1. Clone the repo at the given tag.
2. `pnpm install --frozen-lockfile`.
3. `pnpm -r build`.
4. Compute SHA-256 over each published artifact:
   - `packages/web/dist/` (SPA bundle).
   - `packages/extension/dist/` (MV3 package contents).
5. Compare against `RELEASE_MANIFEST.txt` (published alongside the release).
6. Exit 0 if all hashes match, non-zero if any diverge.

See [the PR](https://github.com/XChain-Platform/xchain-wallet/issues) tracking the verify-script PR for the actual implementation.

## Current gotchas (Phase 1)

- **Vite output is mostly deterministic** given a pinned toolchain, but the popup + approval HTML files reference hashed asset filenames that depend on the import order Vite computes. Changes to Rollup between minor Vite versions can shuffle those hashes without any source change. Pinning Vite + its peer deps tightly (`^5.4.0` currently) narrows the risk.
- **`sharp` native prebuilts** add a per-platform dimension. The release pipeline must publish per-platform artifacts; verify.sh picks the one matching the verifier's OS.
- **Dev-SDK fallback** must be disabled in release builds. A pre-release step greps the build output for the fallback warning string and fails if it appears - enforces that `xchain-sdk` resolved cleanly during the build.

## RC checklist

Before cutting a mainnet release candidate, the release manager:

1. Runs `pnpm -r build` locally on a clean checkout.
2. Records the per-artifact SHA-256 in `RELEASE_MANIFEST.txt`.
3. Runs `verify.sh` on a second machine (different OS, different CPU) to flush out non-determinism.
4. Publishes `RELEASE_MANIFEST.txt` alongside the signed artifacts + source tarball.
5. Updates the [threat model](https://docs.xchain.io/components/wallet/threat-model) §5 if any supply-chain mitigation changes.
