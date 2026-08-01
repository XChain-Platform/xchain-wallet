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

# tools/release/sign.sh - release-signing pipeline (G003 / §51,  §6).
#
# Computes a SHA-256 manifest over every artifact in the input
# directory, then GPG-signs the manifest with the release key.
# Outputs:
#   <input-dir>/RELEASE_HASHES.txt       - header + sha256sum-format manifest
#   <input-dir>/RELEASE_HASHES.txt.asc   - detached GPG signature
#
# Usage:
#   XCHAIN_RELEASE_GPG_KEY=<fingerprint> \
#     bash tools/release/sign.sh --tag vX.Y.Z --input release-artifacts/vX.Y.Z/
#
# Environment:
#   XCHAIN_RELEASE_GPG_KEY   GPG key fingerprint or email (required)
#   XCHAIN_RELEASE_TAG       Default --tag value (optional)
#   XCHAIN_RELEASE_DIR       Default --input value (optional)
#   XCHAIN_RELEASE_REPO      Default --repo value (optional)
#   GNUPGHOME                Override GPG home (optional)
#
# Status: the signing step itself is blocked on G180 (the release GPG
# key is not yet generated or published in SECURITY.md). Everything
# ahead of it - the pristine-clone checks, the dev-mock gate, the
# artifact-set gate, the manifest header - runs today.
#
# WHAT THIS SCRIPT IS FOR, so the gates below are not mistaken for
# ceremony: the maintainer's signature is the trust root for artifacts
# nobody else signs. The Chrome Web Store, Apple and Google re-sign
# their own surfaces, but the web tarball and the Linux desktop build
# carry nothing except this manifest. Whatever bytes reach the `gpg`
# call at the bottom of this file become, to a verifying user, "what
# the maintainer built from tag vX.Y.Z". Each gate below closes one way
# for that claim to be false while the manifest still verifies.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/release/lib.sh
source "$HERE/lib.sh"

INPUT_DIR=""
REPO_ROOT=""
TAG=""
FORCE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --input|-i)
            INPUT_DIR="$2"
            shift 2
            ;;
        --tag|-t)
            TAG="$2"
            shift 2
            ;;
        --repo|-r)
            REPO_ROOT="$2"
            shift 2
            ;;
        --force|-f)
            FORCE=1
            shift
            ;;
        --help|-h)
            # The usage block: everything between the license header's
            # closing rule and the first line of code. Bounded by content,
            # not by line numbers - those drifted and printed the licence.
            awk '/^#\*+$/{seen++; next} seen>=2 && /^set -euo pipefail/{exit} seen>=2{print}' "$0"
            exit 0
            ;;
        *)
            echo "sign.sh: unknown argument '$1'" >&2
            exit 2
            ;;
    esac
done

if [[ -z "$INPUT_DIR" ]]; then
    INPUT_DIR="${XCHAIN_RELEASE_DIR:-}"
fi
if [[ -z "$INPUT_DIR" ]]; then
    echo "sign.sh: --input <dir> or XCHAIN_RELEASE_DIR is required" >&2
    exit 2
fi
if [[ ! -d "$INPUT_DIR" ]]; then
    echo "sign.sh: input dir '$INPUT_DIR' does not exist" >&2
    exit 2
fi

if [[ -z "$TAG" ]]; then
    TAG="${XCHAIN_RELEASE_TAG:-}"
fi
if [[ -z "$TAG" ]]; then
    cat >&2 <<'EOF'
sign.sh: --tag <vX.Y.Z> or XCHAIN_RELEASE_TAG is required.

The manifest embeds the tag it describes so a signed manifest cannot
float between versions: without it, a manifest lifted from one release
and served as another verifies perfectly (see  §6). Pass the
release tag exactly as it exists in git.
EOF
    exit 2
fi

if [[ -z "$REPO_ROOT" ]]; then
    REPO_ROOT="${XCHAIN_RELEASE_REPO:-$(cd "$HERE/../.." && pwd)}"
fi
if [[ ! -d "$REPO_ROOT/.git" && ! -f "$REPO_ROOT/.git" ]]; then
    echo "sign.sh: --repo '$REPO_ROOT' is not a git checkout" >&2
    exit 2
fi

if [[ -z "${XCHAIN_RELEASE_GPG_KEY:-}" ]]; then
    cat >&2 <<'EOF'
sign.sh: XCHAIN_RELEASE_GPG_KEY is not set.

The wallet's release GPG key has not yet been published - see G180 in
claude/reports/xchain-wallet/SPEC_GAPS.md and the disclosure note in
SECURITY.md. Until the key is published, this pipeline cannot
produce a signed manifest.

Path forward:
  1. Generate the release key (or import an existing one) into the
     GnuPG home you intend to use (default ~/.gnupg, override via
     GNUPGHOME=...).
  2. Publish the fingerprint in SECURITY.md.
  3. Re-run with `XCHAIN_RELEASE_GPG_KEY=<fingerprint>`.

To compute the unsigned manifest only (no signing), run:
  bash tools/release/verify.sh --input "$INPUT_DIR" --recompute
EOF
    exit 1
fi

if ! command -v gpg >/dev/null 2>&1; then
    echo "sign.sh: gpg not found in PATH" >&2
    exit 2
fi
if ! command -v git >/dev/null 2>&1; then
    echo "sign.sh: git not found in PATH" >&2
    exit 2
fi

# --- Pristine-clone gate ( §6) ------------------------------------
#
# The tag must exist, HEAD must be sitting on it, and the worktree must
# be clean. This is not defensive programming: `~/Sites` is shared with a
# second coder over NFS and a neighbour's uncommitted edits have compiled
# into a wallet build there before. A release signed out of that tree
# carries their work-in-progress under the maintainer's signature, and
# nothing downstream can tell.

TAG_COMMIT=""
if ! TAG_COMMIT="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "refs/tags/$TAG^{commit}")"; then
    echo "sign.sh: tag '$TAG' does not exist in $REPO_ROOT" >&2
    echo "  Sign from a fresh clone checked out AT the release tag." >&2
    exit 1
fi

HEAD_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
if [[ "$HEAD_COMMIT" != "$TAG_COMMIT" ]]; then
    echo "sign.sh: $REPO_ROOT is not checked out at $TAG." >&2
    echo "  HEAD:      $HEAD_COMMIT" >&2
    echo "  $TAG:      $TAG_COMMIT" >&2
    echo "  Sign from a fresh clone checked out at the release tag." >&2
    exit 1
fi

DIRT="$(git -C "$REPO_ROOT" status --porcelain)"
if [[ -n "$DIRT" ]]; then
    echo "sign.sh: $REPO_ROOT has uncommitted changes; refusing to sign." >&2
    printf '%s\n' "$DIRT" | sed 's/^/    /' >&2
    echo "  Build and sign from a throwaway clone, never the shared worktree." >&2
    exit 1
fi

# --- Dev-mock gate ------------------------------------------------------
#
# Refuse to sign if a shell bundle leaked the dev-mock SDK fallback
# (fabricated addresses, cannot sign or broadcast). A missing check
# script is a HARD failure, not a warning: "the gate could not run" and
# "the gate passed" must never produce the same release. The old warning
# path meant a rename or a bad checkout silently downgraded signing to
# unchecked.
DEV_MOCK_CHECK="$REPO_ROOT/tools/build-reproduce/check-no-dev-mock.sh"
DEV_MOCK_STATE="enforced"
if [[ "${SIGN_SKIP_DEV_MOCK_CHECK:-0}" == "1" ]]; then
    # The escape hatch survives for artifact sets with no dist tree (a
    # docs tarball), but it no longer leaves the release indistinguishable
    # from a gated one: the state lands in the SIGNED header, so anyone
    # verifying can see the gate was off. Release runs never set it (§6
    # step 4).
    echo "sign.sh: SIGN_SKIP_DEV_MOCK_CHECK=1 - dev-mock gate SKIPPED." >&2
    echo "  This is recorded in the signed manifest header." >&2
    DEV_MOCK_STATE="SKIPPED"
elif [[ ! -f "$DEV_MOCK_CHECK" ]]; then
    echo "sign.sh: dev-mock gate script not found: $DEV_MOCK_CHECK" >&2
    echo "  Refusing to sign. A gate that cannot run has not passed." >&2
    exit 1
else
    echo "sign.sh: running pre-sign dev-mock gate ..." >&2
    ( cd "$REPO_ROOT" && bash "$DEV_MOCK_CHECK" ) >&2
fi

MANIFEST="$INPUT_DIR/RELEASE_HASHES.txt"
SIG="$MANIFEST.asc"

if [[ -e "$MANIFEST" && "$FORCE" -ne 1 ]]; then
    echo "sign.sh: $MANIFEST already exists. Pass --force to overwrite." >&2
    exit 1
fi
if [[ -e "$SIG" && "$FORCE" -ne 1 ]]; then
    echo "sign.sh: $SIG already exists. Pass --force to overwrite." >&2
    exit 1
fi

# --- Artifact-set gate --------------------------------------------------
EXPECTED="$REPO_ROOT/tools/release/expected-artifacts.txt"
xr_check_expected "$INPUT_DIR" "$EXPECTED"

# A profile the build cannot actually produce must not be signed into the
# record as though it had .
xr_assert_store_profile_buildable "$INPUT_DIR" "$EXPECTED"

echo "sign.sh: hashing artifacts in $INPUT_DIR ..." >&2
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
xr_write_manifest "$INPUT_DIR" "$TAG" "$TAG_COMMIT" "$BUILT_AT" "$DEV_MOCK_STATE" "$EXPECTED"

echo "sign.sh: signing manifest with key $XCHAIN_RELEASE_GPG_KEY ..." >&2
gpg --batch --yes \
    --local-user "$XCHAIN_RELEASE_GPG_KEY" \
    --armor \
    --detach-sign \
    --output "$SIG" \
    "$MANIFEST"

echo "sign.sh: ok" >&2
echo "  tag:       $TAG ($TAG_COMMIT)" >&2
echo "  manifest:  $MANIFEST" >&2
echo "  signature: $SIG" >&2
echo >&2
echo "  This one signature is checked three ways: by verify.sh, by a user" >&2
echo "  following docs/Verify_Release.md, and by the desktop updater" >&2
echo "  against the key pinned in the app ( S5)." >&2
echo >&2
echo "  Publish the manifest under its VERSIONED name so verify.sh can" >&2
echo "  anchor it: RELEASE_HASHES/$TAG.txt (+ .asc)." >&2
