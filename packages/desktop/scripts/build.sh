#!/usr/bin/env bash
# Deterministic build entry point — runs INSIDE the reproducible-build
# Docker image. See packages/desktop/Dockerfile + scripts/reproduce.sh.
#
# Assumptions (enforced by the Dockerfile + reproduce.sh):
#   - cwd is /workspace (the mounted repo root)
#   - SOURCE_DATE_EPOCH is set (reproduce.sh derives it from HEAD)
#   - LC_ALL / LANG / TZ are pinned (C.UTF-8 / UTC)
#   - /out is mounted writable for build artifacts

set -euo pipefail

: "${SOURCE_DATE_EPOCH:?SOURCE_DATE_EPOCH must be set — reproduce.sh sets this from the commit date}"

echo "[xchain-wallet] build.sh — SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}"
echo "[xchain-wallet] node: $(node --version) — pnpm: $(pnpm --version)"

cd /workspace

# --- 1. Install deps -----------------------------------------------------
# `--frozen-lockfile` fails the build if pnpm-lock.yaml is out of sync
# with package.json — critical for reproducibility (unpinned deps are
# the most common source of non-determinism).
pnpm install --frozen-lockfile

# --- 2. Build renderer ---------------------------------------------------
# Vite's output under packages/desktop/renderer/dist goes into the
# Electron asar. SOURCE_DATE_EPOCH is honoured by vite via the
# esbuild-minify path; check the output metadata if hashes drift
# across verifications.
pnpm --filter @xchain-wallet/desktop run build:renderer

# --- 3. Package --------------------------------------------------------
# `electron-builder --dir` produces the unpacked app only (no dmg/nsis/
# AppImage wrapping) — the Level-2 verification target is the
# pre-signing app bundle. Full packaging happens in the official
# release path (build-release.sh) where signing certs are present.
pnpm --filter @xchain-wallet/desktop run dist:unpacked

# --- 4. Emit SHA256 manifest -------------------------------------------
# The verifier compares this manifest against the official release's
# published `RELEASE_HASHES.md`. Mismatches indicate either a build
# environment drift (toolchain pinning bug) or supply-chain tampering.
cd /workspace/packages/desktop/dist
find . -type f -not -path '*/node_modules/*' -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    > /out/RELEASE_HASHES.txt

echo "[xchain-wallet] build.sh — done"
echo "Manifest: /out/RELEASE_HASHES.txt"
