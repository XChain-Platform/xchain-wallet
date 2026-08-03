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

# tools/release/verify.sh - local verification helper (G003 / §51,  §6).
#
# Re-computes SHA-256 hashes over every artifact in the input
# directory, checks the manifest's signed header against the release it
# claims to describe, and verifies the GPG signature. Mirrors the recipe
# at https://docs.xchain.io/components/wallet/release/verify-release so a
# release engineer can do a round-trip
# check before publishing.
#
# Usage:
#   bash tools/release/verify.sh --input release-artifacts/vX.Y.Z/
#   bash tools/release/verify.sh --input downloads/ --tag v0.333.1
#
# Modes:
#   default      - verify hashes, header anchor AND signature
#   --no-sig     - skip the GPG signature check (NOT a verification:
#                  it trusts whoever served you the manifest)
#   --recompute  - write a fresh unsigned RELEASE_HASHES.txt without
#                  verifying an existing one (local convenience)
#
# Options:
#   --manifest <path>  manifest to check (default <input>/RELEASE_HASHES.txt)
#   --tag <vX.Y.Z>     release this manifest must claim to describe
#   --artifact <name>  check ONLY this artifact, not the whole manifest
#
# --artifact is for the person who downloaded one installer. The manifest
# covers every artifact in the release, so without it a user who fetched
# only their own platform's build gets a wall of "No such file" and no
# answer. The signature and the tag anchor are still checked in full;
# only the hash comparison narrows.
#
# The tag anchor: a signed manifest is only meaningful for ONE release.
# If the manifest is fetched under its published versioned name
# (RELEASE_HASHES/vX.Y.Z.txt) the tag is read from the filename;
# otherwise pass --tag. In signature mode the anchor is mandatory,
# because "the signature is good" plus "I don't know which release this
# is" is exactly the gap a replayed manifest walks through.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/release/lib.sh
source "$HERE/lib.sh"

INPUT_DIR=""
MANIFEST=""
TAG=""
ARTIFACT=""
RECOMPUTE=0
NO_SIG=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --input|-i)
            INPUT_DIR="$2"
            shift 2
            ;;
        --manifest|-m)
            MANIFEST="$2"
            shift 2
            ;;
        --tag|-t)
            TAG="$2"
            shift 2
            ;;
        --artifact|-a)
            ARTIFACT="$2"
            shift 2
            ;;
        --no-sig)
            NO_SIG=1
            shift
            ;;
        --recompute)
            RECOMPUTE=1
            shift
            ;;
        --help|-h)
            # See sign.sh: bounded by content, not by line numbers.
            awk '/^#\*+$/{seen++; next} seen>=2 && /^set -euo pipefail/{exit} seen>=2{print}' "$0"
            exit 0
            ;;
        *)
            echo "verify.sh: unknown argument '$1'" >&2
            exit 2
            ;;
    esac
done

if [[ -z "$INPUT_DIR" ]]; then
    INPUT_DIR="${XCHAIN_RELEASE_DIR:-}"
fi
if [[ -z "$INPUT_DIR" ]]; then
    echo "verify.sh: --input <dir> or XCHAIN_RELEASE_DIR is required" >&2
    exit 2
fi
if [[ ! -d "$INPUT_DIR" ]]; then
    echo "verify.sh: input dir '$INPUT_DIR' does not exist" >&2
    exit 2
fi

if [[ -z "$MANIFEST" ]]; then
    MANIFEST="$INPUT_DIR/RELEASE_HASHES.txt"
fi
SIG="$MANIFEST.asc"

if [[ -z "$TAG" ]]; then
    TAG="${XCHAIN_RELEASE_TAG:-}"
fi

if [[ "$RECOMPUTE" -eq 1 ]]; then
    # Unsigned local convenience: no tag, no commit, no gate claim. The
    # placeholders are literal so nobody can mistake the output for a
    # release manifest, and so a stray copy of one cannot pass the
    # signature-mode anchor check below.
    echo "verify.sh: recomputing manifest (UNSIGNED, not a release) ..." >&2
    xr_write_manifest "$INPUT_DIR" "(none)" "(none)" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "not-run"
    echo "verify.sh: wrote $INPUT_DIR/RELEASE_HASHES.txt (unsigned)" >&2
    exit 0
fi

if [[ ! -f "$MANIFEST" ]]; then
    echo "verify.sh: $MANIFEST not found - run sign.sh first or pass --recompute" >&2
    exit 1
fi

# --- Hash check ---------------------------------------------------------
#
# Header lines are stripped before the check. `shasum -c` ignores them
# silently; GNU `sha256sum -c` prints "N lines are improperly formatted"
# and still exits 0, which reads as a failure to anyone following the
# docs and means nothing. Strip once here rather than teach every user
# to ignore a warning.
SHA256="$(xr_sha256_cmd)"
echo "verify.sh: checking artifact hashes against $MANIFEST ..." >&2
STRIPPED="$(mktemp)"
trap 'rm -f "$STRIPPED"' EXIT
grep -v '^#' "$MANIFEST" > "$STRIPPED" || true
if [[ ! -s "$STRIPPED" ]]; then
    echo "verify.sh: $MANIFEST contains no hash lines." >&2
    exit 1
fi
# Well-formedness is checked over the WHOLE manifest even when only one
# artifact is being verified: the signature covers every line, so a
# malformed line elsewhere means the document is not what was signed.
xr_assert_wellformed "$STRIPPED"

# The header's artifact count is compared against the full manifest, so
# capture it before any narrowing.
FULL_COUNT="$(grep -c . "$STRIPPED" || true)"

# Build profiles, checked here for the same reason and against the same
# full document: which feature set each artifact carries is a claim about
# the whole release . Only manifests that describe an actual
# RELEASE are checked; an unsigned recompute has no profile claim to keep.
#
# This was gated on xr_has_header until 2026-08-02, which could not tell the
# two apart, because a recompute manifest carries the same header line a
# signed one does. The check therefore ran against precisely the manifests
# documented not to have profile lines, and this script refused to read its
# own --recompute output on any tag.
if xr_is_release_manifest "$MANIFEST"; then
    xr_check_profiles "$MANIFEST" "$STRIPPED" || exit 1
fi

if [[ -n "$ARTIFACT" ]]; then
    NARROWED="$(mktemp)"
    trap 'rm -f "$STRIPPED" "$NARROWED"' EXIT
    # Match the trailing path component exactly, so `wallet.deb` cannot
    # be satisfied by a line for `other-wallet.deb`.
    ARTIFACT_BASE="$(basename "$ARTIFACT")"
    awk -v want="$ARTIFACT_BASE" '
        { line = $0; sub(/^[0-9a-fA-F]+  /, "", line); sub(/^\.\//, "", line) }
        line == want { print }
    ' "$STRIPPED" > "$NARROWED"
    if [[ ! -s "$NARROWED" ]]; then
        echo "verify.sh: '$ARTIFACT_BASE' is not covered by this manifest." >&2
        echo "  The release does not contain an artifact by that name, which" >&2
        echo "  means the file you have did not come from this release." >&2
        exit 1
    fi
    STRIPPED="$NARROWED"
    echo "verify.sh: checking only $ARTIFACT_BASE (signature and anchor still checked in full)" >&2
fi
(
    cd "$INPUT_DIR"
    # shellcheck disable=SC2086  # $SHA256 is a command + flags, must split.
    $SHA256 -c "$STRIPPED"
)

# --- Header / anchor check ----------------------------------------------
if xr_has_header "$MANIFEST"; then
    M_TAG="$(xr_header_field "$MANIFEST" 'tag')"
    M_COMMIT="$(xr_header_field "$MANIFEST" 'tag-commit')"
    M_GATE="$(xr_header_field "$MANIFEST" 'dev-mock-gate')"
    M_COUNT="$(xr_header_field "$MANIFEST" 'artifacts')"

    ACTUAL_COUNT="$FULL_COUNT"
    if [[ -n "$M_COUNT" && "$M_COUNT" != "$ACTUAL_COUNT" ]]; then
        echo "verify.sh: manifest header claims $M_COUNT artifact(s) but carries $ACTUAL_COUNT." >&2
        echo "  The manifest has been truncated or edited since it was written." >&2
        exit 1
    fi

    # Anchor the manifest to a release. Filename first (the published
    # name IS the anchor), then --tag.
    BASE="$(basename "$MANIFEST")"
    EXPECT_TAG=""
    if [[ "$BASE" =~ ^(v[0-9][^/]*)\.txt$ ]]; then
        EXPECT_TAG="${BASH_REMATCH[1]}"
    elif [[ -n "$TAG" ]]; then
        EXPECT_TAG="$TAG"
    fi

    if [[ -n "$EXPECT_TAG" ]]; then
        if [[ "$M_TAG" != "$EXPECT_TAG" ]]; then
            echo "verify.sh: manifest describes '$M_TAG' but you expected '$EXPECT_TAG'." >&2
            echo "  A manifest from another release will hash-check and" >&2
            echo "  signature-check perfectly. That is what this test is for." >&2
            exit 1
        fi
        echo "verify.sh: header anchor ok - manifest describes $M_TAG ($M_COMMIT)" >&2
    elif [[ "$NO_SIG" -eq 1 ]]; then
        echo "verify.sh: WARNING - manifest describes '$M_TAG' and nothing anchors it." >&2
        echo "  Fetch it as RELEASE_HASHES/<tag>.txt, or pass --tag." >&2
    else
        echo "verify.sh: cannot tell which release this manifest is for." >&2
        echo "  It claims tag '$M_TAG', but the filename ($BASE) does not say so" >&2
        echo "  and no --tag was given. Pass --tag <vX.Y.Z>, or fetch the" >&2
        echo "  manifest under its published name RELEASE_HASHES/<tag>.txt." >&2
        exit 1
    fi

    if [[ "$M_GATE" != "enforced" ]]; then
        echo "verify.sh: WARNING - dev-mock gate state is '$M_GATE', not 'enforced'." >&2
        echo "  This release was signed without the gate that keeps the" >&2
        echo "  fabricated-address dev SDK out of a shipped bundle." >&2
    fi
elif [[ "$NO_SIG" -eq 1 ]]; then
    echo "verify.sh: WARNING - manifest has no header (unsigned or pre-)." >&2
else
    # In signature mode a missing header is not a legacy quirk: the
    # signature covers the manifest bytes, so a real signed release
    # manifest always still has its header. One without it was either
    # edited (breaking the signature anyway) or was never a release.
    echo "verify.sh: $MANIFEST has no release header; refusing to verify it as a release." >&2
    echo "  Re-download it, or pass --no-sig if you only want a hash check." >&2
    exit 1
fi

if [[ "$NO_SIG" -eq 1 ]]; then
    echo "verify.sh: hash check ok (signature NOT checked - this is not a verification)" >&2
    exit 0
fi

# --- Signature check ----------------------------------------------------
if [[ ! -f "$SIG" ]]; then
    echo "verify.sh: $SIG not found - run sign.sh or pass --no-sig" >&2
    exit 1
fi
if ! command -v gpg >/dev/null 2>&1; then
    echo "verify.sh: gpg not found in PATH (pass --no-sig to skip)" >&2
    exit 2
fi

echo "verify.sh: verifying GPG signature on $MANIFEST ..." >&2
gpg --verify "$SIG" "$MANIFEST"

echo "verify.sh: ok - hashes match, header anchors to $EXPECT_TAG, GPG signature is good" >&2
