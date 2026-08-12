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
# See the web section of
# https://docs.xchain.io/components/wallet/reproducible-builds
# for the full verification protocol.

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
# protocol tells the verifier to suspect tampering.
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

# --- 3. Pull the pinned toolchain from the ref being reproduced --------
#
# Read out of the WORKTREE, never out of the checkout this script happens
# to be running from: the pins are part of what a tag reproduces, so an
# older tag must build with the Node IT pinned, not with today's.
read -r PNPM_VERSION NODE_VERSION NODE_SHA256_X64 BUILD_PLATFORM <<EOF
$(node -e "
    const fs = require('fs');
    const root = '${WORKTREE_DIR}';
    const pkg = JSON.parse(fs.readFileSync(root + '/package.json', 'utf8'));
    const m = /^pnpm@(.+)\$/.exec(pkg.packageManager || '');
    if (!m) { console.error('no pnpm@... in packageManager'); process.exit(1); }
    const tc = JSON.parse(fs.readFileSync(root + '/tools/release/toolchain.json', 'utf8'));
    process.stdout.write([
        m[1],
        tc.node.version,
        tc.node.sha256.x64,
        tc.baseImage.platform,
    ].join(' '));
")
EOF
echo "[reproduce] pnpm=${PNPM_VERSION} node=${NODE_VERSION} platform=${BUILD_PLATFORM}"

# --- 3b. Can this host actually execute that platform? -----------------
#
# The flag below asks for amd64; it does not check that anything here can
# run amd64, and the two emulators that answer it are not equivalent. Under
# qemu user-mode this build dies minutes in, inside esbuild's Go runtime,
# with a message that names neither qemu nor the architecture. The
# preflight refuses that emulator up front and names the routes that work.
bash "${REPO_ROOT}/tools/release/emulation-preflight.sh" "${BUILD_PLATFORM}"

# --- 4. Build the image ------------------------------------------------
IMAGE_TAG="xchain-wallet-web:reproduce-${COMMIT_SHA:0:12}"
echo "[reproduce] building image ${IMAGE_TAG}"
docker build \
    --platform "${BUILD_PLATFORM}" \
    --build-arg "PNPM_VERSION=${PNPM_VERSION}" \
    --build-arg "NODE_VERSION=${NODE_VERSION}" \
    --build-arg "NODE_SHA256_X64=${NODE_SHA256_X64}" \
    -f "${WORKTREE_DIR}/packages/web/Dockerfile" \
    -t "${IMAGE_TAG}" \
    "${WORKTREE_DIR}"

# --- 5. Run the build --------------------------------------------------
echo "[reproduce] running build"
docker run --rm \
    --platform "${BUILD_PLATFORM}" \
    --user "$(id -u):$(id -g)" \
    -e "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}" \
    -e "LC_ALL=C.UTF-8" \
    -e "TZ=UTC" \
    `# --user overrides the image's builder account, so /home/builder is
     # not ours to write, and corepack's first act is to mkdir under HOME.
     # Unset, HOME resolves to / and the run dies with EACCES on
     # /.cache/node/corepack. Point it inside the worktree, which is
     # deleted along with it - nothing under it is hashed.` \
    -e "HOME=/workspace/.reproduce-home" \
    `# WRITABLE. Under a read-only mount this could never complete:
     # build.sh runs pnpm install (writes node_modules) and a build
     # (writes dist/), both inside /workspace, so the run died on EROFS
     # at the first step. Isolation from the local checkout comes from
     # the detached worktree above, not from the flag.
     #
     # Do not quote anything in here with backticks. This whole block is
     # a backtick command substitution used as a comment, so a nested
     # pair CLOSES it: the words after it ran as a command, every
     # remaining flag was swallowed, and docker exited "invalid reference
     # format". That is what was here until 2026-08-02.` \
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
