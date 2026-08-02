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

# --- 1b. The SDK, which is now an ordinary dependency --------------------
#
# THIS USED TO BE FATAL, AND THE FATAL IS GONE ( D8 / ).
# packages/desktop depended on `xchain-sdk` as `link:../../../xchain-sdk`,
# a filesystem link to a SIBLING REPOSITORY three levels above the wallet
# root, which is why the protocol in REPRODUCIBLE_BUILDS.md was never
# executable as written: it says to clone xchain-wallet and run this
# script, a clone has no such directory, and the renderer build died at
# `Rollup failed to resolve import "xchain-sdk/src/wallet.js"`.
#
# The distribution decision that blocked it has been taken. The SDK is
# published, the three shells depend on `npm:@dankest-llc/xchain-sdk@X.Y.Z`,
# and the lockfile carries its integrity hash - so the SDK now arrives with
# every other dependency, from the lockfile, pinned. A standalone clone
# reproduces, which is the whole promise of this file.
#
# The sibling checkout is therefore OPTIONAL and is used for one thing: a
# maintainer who built with `pnpm run sdk:link` is not reproducing the
# published dependency, and the manifest should say which SDK commit they
# actually used rather than implying the pinned one. Absent, the pinned
# version from the lockfile is the answer and is recorded instead.
SDK_DIR="${XCHAIN_SDK_DIR:-${REPO_ROOT}/../xchain-sdk}"
SDK_REF="${XCHAIN_SDK_REF:-HEAD}"
SDK_COMMIT=""
SDK_PINNED="$(node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('${REPO_ROOT}/packages/desktop/package.json', 'utf8'));
    process.stdout.write(pkg.dependencies?.['xchain-sdk'] || 'UNKNOWN');
" 2>/dev/null || echo UNKNOWN)"
if [ -d "${SDK_DIR}/.git" ]; then
    SDK_COMMIT="$(git -C "${SDK_DIR}" rev-parse --verify "${SDK_REF}^{commit}")"
    echo "[reproduce] sdk sibling=${SDK_DIR} commit=${SDK_COMMIT} (pinned dep: ${SDK_PINNED})"
else
    echo "[reproduce] sdk from the lockfile: ${SDK_PINNED} (no sibling checkout, which is fine)"
fi

# --- 2. Worktree checkout (isolates reproduction from local changes) ---
WORKTREE_DIR="$(mktemp -d -t xchain-reproduce.XXXXXX)"
SDK_WORKTREE_DIR=""
cleanup() {
    git -C "${REPO_ROOT}" worktree remove --force "${WORKTREE_DIR}" 2>/dev/null || rm -rf "${WORKTREE_DIR}"
    if [ -n "${SDK_WORKTREE_DIR}" ]; then
        git -C "${SDK_DIR}" worktree remove --force "${SDK_WORKTREE_DIR}" 2>/dev/null || rm -rf "${SDK_WORKTREE_DIR}"
    fi
}
trap cleanup EXIT

git worktree add --detach "${WORKTREE_DIR}" "${COMMIT_SHA}"
echo "[reproduce] worktree at ${WORKTREE_DIR}"

# Only when a sibling SDK exists, and still from its COMMITTED state rather
# than its working tree: a build whose second input is whatever a neighbour
# happened to leave checked out is not a reproduction of anything. With no
# sibling the container installs the pinned SDK from the registry like any
# other dependency, which is the case a third-party verifier is in.
if [ -n "${SDK_COMMIT}" ]; then
    SDK_WORKTREE_DIR="$(mktemp -d -t xchain-reproduce-sdk.XXXXXX)"
    git -C "${SDK_DIR}" worktree add --detach "${SDK_WORKTREE_DIR}" "${SDK_COMMIT}"
    echo "[reproduce] sdk worktree at ${SDK_WORKTREE_DIR}"
fi

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
    -e "XCHAIN_SDK_PINNED=${SDK_PINNED}" \
    -v "${WORKTREE_DIR}:/workspace" \
    `# The SDK mount is now conditional. It is only meaningful when the
     # dependency is a link: - under the pinned registry dependency the
     # container installs the SDK from the lockfile and /xchain-sdk is
     # never consulted. Mounting it anyway would be harmless but
     # misleading, since it would suggest the sibling was an input.` \
    ${SDK_WORKTREE_DIR:+-v "${SDK_WORKTREE_DIR}:/xchain-sdk"} \
    -v "${OUT_DIR_ABS}:/out" \
    "${IMAGE_TAG}"

# --- 6. Emit summary ---------------------------------------------------
echo "[reproduce] done. Manifest:"
cat "${OUT_DIR_ABS}/RELEASE_HASHES.txt"
echo
echo "Compare the above against the official RELEASE_HASHES.md in the"
echo "release tag's attachments. Mismatches indicate either a build"
echo "environment drift (toolchain pinning bug) or supply-chain tampering."
