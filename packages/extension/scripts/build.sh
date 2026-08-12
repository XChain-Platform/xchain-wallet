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

# Deterministic build entry point for the Chrome MV3 extension - runs
# INSIDE the reproducible-build Docker image. See
# packages/extension/Dockerfile + scripts/reproduce.sh.
#
# Assumptions (enforced by the Dockerfile + reproduce.sh):
#   - cwd is /workspace (the mounted repo root)
#   - SOURCE_DATE_EPOCH is set (reproduce.sh derives it from the ref)
#   - LC_ALL / LANG / TZ are pinned (C.UTF-8 / UTC)
#   - /out is mounted writable for the manifest

set -euo pipefail

# Before the SOURCE_DATE_EPOCH guard. This is the in-container
# half of the reproducible build, so the person most likely to type
# `--help` at it is a verifier who has just found it in the Dockerfile and
# wants to know whether they are supposed to run it directly. Answering
# that with `SOURCE_DATE_EPOCH must be set` and exit 1 tells them the build
# is broken; the true answer is "not directly, use reproduce.sh".
case "${1:-}" in
    -h|--help)
        cat <<'USAGE'
build.sh - deterministic build entry point for the Chrome MV3 extension.

Usage:
  Not run directly. This executes INSIDE the reproducible-build Docker
  image; use packages/extension/scripts/reproduce.sh, which builds that
  image and invokes this.

Takes no arguments. Assumptions, all enforced by the Dockerfile plus
reproduce.sh:
  - cwd is /workspace (the mounted repo root)
  - SOURCE_DATE_EPOCH is set (reproduce.sh derives it from the ref)
  - LC_ALL / LANG / TZ are pinned (C.UTF-8 / UTC)
  - /out is mounted writable for the manifest

Output: /out/RELEASE_HASHES.txt, a sha256sum-format manifest over the
pre-store unpacked bundle. The published .crx is re-signed by the Chrome
Web Store and will not match it.
USAGE
        exit 0
        ;;
esac

: "${SOURCE_DATE_EPOCH:?SOURCE_DATE_EPOCH must be set - reproduce.sh sets this from the commit date}"

echo "[xchain-wallet/extension] build.sh - SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}"
echo "[xchain-wallet/extension] node: $(node --version) - pnpm: $(pnpm --version)"

cd /workspace

# --- 1. Install deps -----------------------------------------------------
pnpm install --frozen-lockfile

# --- 2. Build the unpacked extension -------------------------------------
# Vite emits the MV3 bundle (popup + service worker + content + inject +
# manifest + resized icons) under packages/extension/dist.
pnpm --filter @xchain-wallet/extension build

# --- 3. Pre-ship gate ----------------------------------------------------
# Refuse to emit a manifest for a bundle that reached the dev-mock SDK
# fallback (fabricated addresses / cannot sign). Mirrors the CI gate.
bash tools/build-reproduce/check-no-dev-mock.sh

# --- 4. Emit SHA256 manifest ---------------------------------------------
# Note: this is the PRE-STORE unpacked bundle. The published .crx is
# re-packaged + re-signed by the Chrome Web Store and will not match.
#
# No node_modules filter here, deliberately. The desktop twin
# carried `-not -path '*/node_modules/*'` and it silently dropped 112
# SHIPPED files from its manifest, including a compiled native binary,
# because inside a `dist/` tree the only thing that pattern can match is a
# dependency payload the artifact actually contains. This bundle has no
# such paths today - measured against the real v0.334.0 zip: 45 files, zero
# matches - so removing the filter changes nothing now and removes the trap
# for whatever ships one later. These two lanes have already been found
# carrying each other's defects byte for byte once  .
cd /workspace/packages/extension/dist
find . -type f -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    > /out/RELEASE_HASHES.txt

echo "[xchain-wallet/extension] build.sh - done"
echo "Manifest: /out/RELEASE_HASHES.txt"
