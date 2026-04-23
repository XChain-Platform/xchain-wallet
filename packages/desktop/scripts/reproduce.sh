#!/usr/bin/env bash
# Third-party reproduction script — anyone can run this to build the
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
SOURCE_DATE_EPOCH="$(git log -1 --pretty=%ct "${COMMIT_SHA}")"

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
IMAGE_TAG="xchain-wallet-desktop:reproduce-${COMMIT_SHA:0:12}"
echo "[reproduce] building image ${IMAGE_TAG}"
docker build \
    --build-arg "PNPM_VERSION=${PNPM_VERSION}" \
    -f "${WORKTREE_DIR}/packages/desktop/Dockerfile" \
    -t "${IMAGE_TAG}" \
    "${WORKTREE_DIR}"

# --- 5. Run the build --------------------------------------------------
echo "[reproduce] running build"
docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}" \
    -e "LC_ALL=C.UTF-8" \
    -e "TZ=UTC" \
    -v "${WORKTREE_DIR}:/workspace:ro" \
    -v "${OUT_DIR_ABS}:/out" \
    "${IMAGE_TAG}"

# --- 6. Emit summary ---------------------------------------------------
echo "[reproduce] done. Manifest:"
cat "${OUT_DIR_ABS}/RELEASE_HASHES.txt"
echo
echo "Compare the above against the official RELEASE_HASHES.md in the"
echo "release tag's attachments. Mismatches indicate either a build"
echo "environment drift (toolchain pinning bug) or supply-chain tampering."
