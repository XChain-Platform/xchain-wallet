#!/usr/bin/env bash
#*********************************************************************
#
# Copyright © 2025-2026 Dankest, LLC
# Based on XChain Platform by Dankest, LLC - https://dankest.llc
#
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# This file is part of XChain Platform. Licensed under the GNU Affero
# General Public License v3.0 or later; see LICENSE.md. A commercial
# license (without AGPL source-disclosure terms) is available -
# contact legal@dankest.llc.
#
#*********************************************************************

# Deterministic build entry point for the browser SPA - runs INSIDE the
# reproducible-build Docker image. See packages/web/Dockerfile +
# scripts/reproduce.sh.
#
# Assumptions (enforced by the Dockerfile + reproduce.sh):
#   - cwd is /workspace (the mounted repo root)
#   - SOURCE_DATE_EPOCH is set (reproduce.sh derives it from the ref)
#   - LC_ALL / LANG / TZ are pinned (C.UTF-8 / UTC)
#   - /out is mounted writable for the manifest

set -euo pipefail

: "${SOURCE_DATE_EPOCH:?SOURCE_DATE_EPOCH must be set - reproduce.sh sets this from the commit date}"

echo "[xchain-wallet/web] build.sh - SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}"
echo "[xchain-wallet/web] node: $(node --version) - pnpm: $(pnpm --version)"

cd /workspace

# --- 1. Install deps -----------------------------------------------------
# `--frozen-lockfile` fails the build if pnpm-lock.yaml is out of sync with
# package.json - unpinned deps are the most common source of
# non-determinism.
pnpm install --frozen-lockfile

# --- 2. Build the SPA ----------------------------------------------------
# Vite honours SOURCE_DATE_EPOCH via the esbuild-minify path; the output
# lands under packages/web/dist.
pnpm --filter @xchain-wallet/web build

# --- 3. Pre-ship gate ----------------------------------------------------
# Refuse to emit a manifest for a bundle that reached the dev-mock SDK
# fallback (fabricated addresses / cannot sign). Mirrors the CI gate.
bash tools/build-reproduce/check-no-dev-mock.sh

# --- 4. Emit SHA256 manifest ---------------------------------------------
# The verifier compares this manifest against the official release's
# published RELEASE_HASHES.txt. Mismatches indicate build-environment
# drift (toolchain pinning bug) or supply-chain tampering.
#
# No node_modules filter here, deliberately. See the extension
# twin for the full reason: inside a `dist/` tree that pattern can only
# match a dependency payload the artifact ships, and on desktop it silently
# dropped 112 such files including a compiled native binary. Measured
# against the real v0.334.0 tarball: 33 files, zero matches, so this is a
# no-op today and a removed trap tomorrow.
cd /workspace/packages/web/dist
find . -type f -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    > /out/RELEASE_HASHES.txt

echo "[xchain-wallet/web] build.sh - done"
echo "Manifest: /out/RELEASE_HASHES.txt"
