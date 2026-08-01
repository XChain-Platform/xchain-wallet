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

# Third-party reproduction script - anyone can run this to build the
# same SPA bundle as an official @xchain-wallet/web release.
#
# Usage:
#   scripts/reproduce.sh                       # build current HEAD
#   scripts/reproduce.sh v0.333.1              # build a specific tag
#   scripts/reproduce.sh v0.333.1 ./verify-out # custom output dir
#
# What this does:
#   1. Checks out the given ref (tag / branch / commit)
#   2. Derives SOURCE_DATE_EPOCH from that ref's commit date
#   3. Builds the reproducible-build Docker image
#   4. Runs the in-container build (see scripts/build.sh)
#   5. Prints the resulting SHA256 manifest for diffing against the
#      published RELEASE_HASHES.txt
#
# See REPRODUCIBLE_BUILDS.md for the full verification protocol.

set -euo pipefail

REF="${1:-HEAD}"
OUT_DIR="${2:-./reproduce-out}"
REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")/../../.." rev-parse --show-toplevel)"

cd "${REPO_ROOT}"

# --- 1. Ref resolution + SOURCE_DATE_EPOCH ------------------------------
COMMIT_SHA="$(git rev-parse --verify "${REF}^{commit}")"
# %at (AUTHOR date), because that is what the release lane injects.
# This read %ct (COMMITTER date); the two are equal only for a commit
# never rebased or amended, and 10 of the last 200 commits here diverge,
# by up to 36 minutes. On any of those tags the verifier and the release
# stamp different mtimes, the hashes cannot match, and the published
# protocol tells the verifier to suspect tampering .
SOURCE_DATE_EPOCH="$(git log -1 --pretty=%at "${COMMIT_SHA}")"

echo "[reproduce] ref=${REF} commit=${COMMIT_SHA} epoch=${SOURCE_DATE_EPOCH}"
echo "[reproduce] commit date=$(date -u -d "@${SOURCE_DATE_EPOCH}" '+%Y-%m-%d %H:%M:%S UTC')"

mkdir -p "${OUT_DIR}"
OUT_DIR_ABS="$(cd "${OUT_DIR}" && pwd)"

# --- 2. Worktree checkout (isolates reproduction from local changes) ---
WORKTREE_DIR="$(mktemp -d -t xchain-reproduce.XXXXXX)"
trap 'git worktree remove --force "${WORKTREE_DIR}" 2>/dev/null || rm -rf "${WORKTREE_DIR}"' EXIT

git worktree add --detach "${WORKTREE_DIR}" "${COMMIT_SHA}"
echo "[reproduce] worktree at ${WORKTREE_DIR}"

# --- 3. Pull pnpm version from root package.json -----------------------
PNPM_VERSION="$(node -e "
    const pkg = require('${WORKTREE_DIR}/package.json');
    const pm = pkg.packageManager || '';
    const m = pm.match(/^pnpm@(.+)$/);
    if (!m) { console.error('no pnpm@... in packageManager'); process.exit(1); }
    process.stdout.write(m[1]);
")"
echo "[reproduce] pnpm version=${PNPM_VERSION}"

# --- 4. Build the image ------------------------------------------------
IMAGE_TAG="xchain-wallet-web:reproduce-${COMMIT_SHA:0:12}"
echo "[reproduce] building image ${IMAGE_TAG}"
docker build \
    --build-arg "PNPM_VERSION=${PNPM_VERSION}" \
    -f "${WORKTREE_DIR}/packages/web/Dockerfile" \
    -t "${IMAGE_TAG}" \
    "${WORKTREE_DIR}"

# --- 5. Run the build --------------------------------------------------
echo "[reproduce] running build"
docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}" \
    -e "LC_ALL=C.UTF-8" \
    -e "TZ=UTC" \
    `# WRITABLE. Under `:ro` this could never complete: build.sh runs
     # pnpm install (writes node_modules) and a build (writes dist/),
     # both inside /workspace, so the run died on EROFS at the first
     # step. Isolation from the local checkout comes from the detached
     # worktree above, not from the flag.` \
    -v "${WORKTREE_DIR}:/workspace" \
    -v "${OUT_DIR_ABS}:/out" \
    "${IMAGE_TAG}"

# --- 6. Emit summary ---------------------------------------------------
echo "[reproduce] done. Manifest:"
cat "${OUT_DIR_ABS}/RELEASE_HASHES.txt"
echo
echo "Compare the above against the official RELEASE_HASHES.txt in the"
echo "release tag's attachments. Mismatches indicate either a build"
echo "environment drift (toolchain pinning bug) or supply-chain tampering."
