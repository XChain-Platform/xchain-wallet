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
# same pre-signing artifact as an official xchain-wallet-desktop release.
#
# Usage:
#   scripts/reproduce.sh                       # build current HEAD
#   scripts/reproduce.sh v0.58.0               # build a specific tag
#   scripts/reproduce.sh v0.58.0 ./verify-out  # custom output dir
#
# What this does:
#   1. Checks out the given ref (tag / branch / commit)
#   2. Derives SOURCE_DATE_EPOCH from that ref's commit date
#   3. Builds the reproducible-build Docker image
#   4. Runs the in-container build (see scripts/build.sh)
#   5. Prints the resulting SHA256 manifest for diffing against the
#      published RELEASE_HASHES.md
#
# See REPRODUCIBLE_BUILDS.md for the full verification protocol.

set -euo pipefail

REF="${1:-HEAD}"
OUT_DIR="${2:-./reproduce-out}"
REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")/../../.." rev-parse --show-toplevel)"

cd "${REPO_ROOT}"

# --- 1. Ref resolution + SOURCE_DATE_EPOCH ------------------------------
COMMIT_SHA="$(git rev-parse --verify "${REF}^{commit}")"

# %at (AUTHOR date), because that is what the release lane injects. This
# read %ct (COMMITTER date) and the two are equal only for a commit that
# was never rebased or amended - 10 of the last 200 commits here diverge,
# by up to 36 minutes. On any of those tags the verifier and the release
# stamped different mtimes into the asar, so the hashes could not match
# and the protocol told the verifier to suspect supply-chain tampering.
# The format is pinned in toolchain.json and the smoke test holds both
# this file and the workflow to it.
SOURCE_DATE_EPOCH="$(git log -1 --pretty=%at "${COMMIT_SHA}")"

echo "[reproduce] ref=${REF} commit=${COMMIT_SHA} epoch=${SOURCE_DATE_EPOCH}"
echo "[reproduce] commit date=$(date -u -d "@${SOURCE_DATE_EPOCH}" '+%Y-%m-%d %H:%M:%S UTC')"

mkdir -p "${OUT_DIR}"
OUT_DIR_ABS="$(cd "${OUT_DIR}" && pwd)"

# --- 1b. The SDK this repo cannot build without -------------------------
#
# packages/desktop depends on `xchain-sdk` as `link:../../../xchain-sdk`:
# a filesystem link to a SIBLING REPOSITORY, three levels above the wallet
# root. That is why the verification protocol in REPRODUCIBLE_BUILDS.md
# has never been executable as written - it says to clone xchain-wallet
# and run this script, and a clone has no such directory, so the renderer
# build dies at `Rollup failed to resolve import "xchain-sdk/src/wallet.js"`.
#
# Resolving that properly is a distribution decision nobody has taken (the
# SDK is `private: true` and unpublished): publish it, vendor it, or pin it
# by commit. Until then this script can still reproduce for anyone who has
# both repos checked out side by side, which is the maintainer and the
# release procedure. It builds from a detached worktree of the SDK's
# committed state, never the sibling's working tree, and records the exact
# SDK commit in the manifest - because a build whose second input is
# whatever happened to be checked out is not a reproduction of anything.
SDK_DIR="${XCHAIN_SDK_DIR:-${REPO_ROOT}/../xchain-sdk}"
SDK_REF="${XCHAIN_SDK_REF:-HEAD}"
if [ ! -d "${SDK_DIR}/.git" ]; then
    cat >&2 <<MSG
[reproduce] FATAL: no xchain-sdk repository at ${SDK_DIR}

  packages/desktop depends on it as link:../../../xchain-sdk, so the
  renderer cannot be bundled without it. The SDK is not published, so a
  standalone clone of xchain-wallet cannot currently be reproduced by a
  third party at all; see REPRODUCIBLE_BUILDS.md.

  Check out xchain-sdk beside xchain-wallet, or point XCHAIN_SDK_DIR at it.
MSG
    exit 1
fi
SDK_COMMIT="$(git -C "${SDK_DIR}" rev-parse --verify "${SDK_REF}^{commit}")"
echo "[reproduce] sdk=${SDK_DIR} commit=${SDK_COMMIT}"

# --- 2. Worktree checkout (isolates reproduction from local changes) ---
WORKTREE_DIR="$(mktemp -d -t xchain-reproduce.XXXXXX)"
SDK_WORKTREE_DIR="$(mktemp -d -t xchain-reproduce-sdk.XXXXXX)"
cleanup() {
    git -C "${REPO_ROOT}" worktree remove --force "${WORKTREE_DIR}" 2>/dev/null || rm -rf "${WORKTREE_DIR}"
    git -C "${SDK_DIR}" worktree remove --force "${SDK_WORKTREE_DIR}" 2>/dev/null || rm -rf "${SDK_WORKTREE_DIR}"
}
trap cleanup EXIT

git worktree add --detach "${WORKTREE_DIR}" "${COMMIT_SHA}"
echo "[reproduce] worktree at ${WORKTREE_DIR}"

git -C "${SDK_DIR}" worktree add --detach "${SDK_WORKTREE_DIR}" "${SDK_COMMIT}"
echo "[reproduce] sdk worktree at ${SDK_WORKTREE_DIR}"

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

# --- 4. Build the image ------------------------------------------------
#
# --platform is explicit because the pinned base digest is amd64-only. On
# an arm64 host that makes the emulation a stated cost of verifying rather
# than a surprise, and it keeps the produced bytes equal to the release
# lane's, which runs on an amd64 runner.
IMAGE_TAG="xchain-wallet-desktop:reproduce-${COMMIT_SHA:0:12}"
echo "[reproduce] building image ${IMAGE_TAG}"
docker build \
    --platform "${BUILD_PLATFORM}" \
    --build-arg "PNPM_VERSION=${PNPM_VERSION}" \
    --build-arg "NODE_VERSION=${NODE_VERSION}" \
    --build-arg "NODE_SHA256_X64=${NODE_SHA256_X64}" \
    -f "${WORKTREE_DIR}/packages/desktop/Dockerfile" \
    -t "${IMAGE_TAG}" \
    "${WORKTREE_DIR}"

# --- 5. Run the build --------------------------------------------------
#
# /workspace is mounted WRITABLE. It was `:ro`, under which this script
# could never once have completed: pnpm writes node_modules and
# electron-builder writes dist/, both inside it, so the run died on a
# read-only filesystem at the first install. Isolation from the local
# checkout comes from building a detached worktree of the commit (step 2),
# which is created and destroyed around this run - not from the flag.
echo "[reproduce] running build"
docker run --rm \
    --platform "${BUILD_PLATFORM}" \
    --user "$(id -u):$(id -g)" \
    -e "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}" \
    -e "LC_ALL=C.UTF-8" \
    -e "TZ=UTC" \
    -e "XCHAIN_EXPECTED_NODE=${NODE_VERSION}" \
    `# --user overrides the image's builder account, so /home/builder is not
     # ours to write. pnpm's store and electron-builder's binary cache both
     # live under HOME, so point it somewhere the run actually owns. Inside
     # the worktree, which is deleted with it - nothing here is hashed.` \
    -e "HOME=/workspace/.reproduce-home" \
    -e "XCHAIN_WALLET_COMMIT=${COMMIT_SHA}" \
    -e "XCHAIN_SDK_COMMIT=${SDK_COMMIT}" \
    -v "${WORKTREE_DIR}:/workspace" \
    `# /workspace/packages/desktop/../../.. is "/", so the link: target
     # xchain-sdk resolves to exactly this path inside the container.` \
    -v "${SDK_WORKTREE_DIR}:/xchain-sdk" \
    -v "${OUT_DIR_ABS}:/out" \
    "${IMAGE_TAG}"

# --- 6. Emit summary ---------------------------------------------------
echo "[reproduce] done. Manifest:"
cat "${OUT_DIR_ABS}/RELEASE_HASHES.txt"
echo
echo "Compare the above against the official RELEASE_HASHES.md in the"
echo "release tag's attachments. Mismatches indicate either a build"
echo "environment drift (toolchain pinning bug) or supply-chain tampering."
