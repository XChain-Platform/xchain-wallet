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
#   --key <fpr>        fingerprint the signature must come from
#                      (default: docs/release-key-pin.json; env
#                      XCHAIN_VERIFY_KEY)
#
# WHICH KEY SIGNED IT IS PART OF THE CHECK, NOT A DETAIL AROUND IT
# ( S37). Until 2026-08-06 this script ran a bare `gpg --verify`,
# which answers "did somebody in your keyring sign this" and never "was
# it the release key". Those are the same output on a machine holding
# more than one project key, and this project has three that are
# explicitly not interchangeable (the wallet release key, the tag-signing
# key, and the platform key at releases@xchain.io). The release machine
# holds all three by design, so does any maintainer's, and the store
# ceremony's only signature check before a permanent listing is this
# command.
#
# It was found by driving it rather than by reading it: a manifest signed
# with the TAG-signing key came back `ok - hashes match, header anchors
# to v0.336.0, GPG signature is good`. The verify-release recipe states
# as claim 3 that "the maintainer's release GPG key signed the hash
# manifest, and that key matches the fingerprint published through the
# two independent channels", and says this script does that claim in one
# command. Half of it was true.
#
# So the signer is bound to a fingerprint the caller names, and a run
# that cannot name one does not get to call anything verified: a check
# that cannot run has not passed. Third parties take the fingerprint from
# https://xchain.io/security and pass --key; in-repo callers get the
# pinned value for free.
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
EXPECT_KEY="${XCHAIN_VERIFY_KEY:-}"

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
        --key|-k)
            EXPECT_KEY="$2"
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
        # A RE-SIGNATURE OF THE SAME RELEASE ANCHORS TO IT , and
        # the direction is the whole of the accommodation. `v0.336.0-resign1`
        # is `v0.336.0`'s tree with the release tooling corrected and nothing
        # else, cut because the gate that writes `dev-mock-gate: enforced`
        # comes from the TAG and so could not be fixed for a release already
        # tagged. Its manifest is republished as RELEASE_HASHES/v0.336.0.txt,
        # the name every existing link already has, so the filename anchor
        # has to accept it or the correction cannot be published at all.
        #
        # ONE WAY ONLY: a re-signature satisfies a request for the release,
        # and the superseded original does NOT satisfy a request for the
        # re-signature - otherwise fetching the corrected manifest by name
        # and being handed the false one would verify.
        RESIGN_OF=""
        if [[ "$M_TAG" != "$EXPECT_TAG" && "$(xr_release_tag_of "$M_TAG")" == "$EXPECT_TAG" ]]; then
            RESIGN_OF="$EXPECT_TAG"
        elif [[ "$M_TAG" != "$EXPECT_TAG" ]]; then
            echo "verify.sh: manifest describes '$M_TAG' but you expected '$EXPECT_TAG'." >&2
            echo "  A manifest from another release will hash-check and" >&2
            echo "  signature-check perfectly. That is what this test is for." >&2
            exit 1
        fi
        if [[ -n "$RESIGN_OF" ]]; then
            echo "verify.sh: header anchor ok - manifest describes $M_TAG ($M_COMMIT)," >&2
            echo "  a RE-SIGNATURE of $RESIGN_OF: the same artifacts, signed again from a" >&2
            echo "  tag whose release tooling was corrected. It supersedes the manifest" >&2
            echo "  originally published under this name." >&2
        else
            echo "verify.sh: header anchor ok - manifest describes $M_TAG ($M_COMMIT)" >&2
        fi
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

    # Partial coverage, said out loud . Without this line, "the
    # artifact I have is not in the manifest" reads as a tampering alarm
    # when the truth may be that this manifest was never about that lane.
    M_LANES="$(xr_header_field "$MANIFEST" 'lanes')"
    if [[ -n "$M_LANES" ]]; then
        echo "verify.sh: this is a PARTIAL release manifest, covering: $M_LANES" >&2
        echo "  It attests the artifacts it hashes and says nothing about any" >&2
        echo "  other lane of ${M_TAG:-this release}. An artifact absent from it" >&2
        echo "  is not evidence that the release omitted that artifact." >&2
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

# The expected signer, resolved before gpg runs so a missing one is a
# refusal rather than a green run with a footnote. The pin is not a
# publication channel for the fingerprint (SECURITY.md and
# https://xchain.io/security are the two channels, and release-key-pin
# .smoke.js compares them against it); it is used here because it is the
# one value in this repo that only an observed signing run can write.
PIN_FILE="$HERE/../../docs/release-key-pin.json"
PIN_SOURCE="--key"
if [[ -z "$EXPECT_KEY" && -f "$PIN_FILE" ]]; then
    EXPECT_KEY="$(sed -n 's/.*"fingerprint"[[:space:]]*:[[:space:]]*"\([0-9A-Fa-f]\{40\}\)".*/\1/p' \
        "$PIN_FILE" | head -1)"
    PIN_SOURCE="docs/release-key-pin.json"
fi
EXPECT_KEY="$(printf '%s' "$EXPECT_KEY" | tr -d ' ' | tr '[:lower:]' '[:upper:]')"
if [[ -z "$EXPECT_KEY" ]]; then
    echo "verify.sh: no expected signing key, so the signature cannot be attributed." >&2
    echo "  A good signature from an unknown key is not a verification: this" >&2
    echo "  project has three GPG keys in its orbit and they are not" >&2
    echo "  interchangeable." >&2
    echo "  Pass --key <fingerprint>, taking it from https://xchain.io/security," >&2
    echo "  or run from a checkout carrying docs/release-key-pin.json." >&2
    exit 1
fi
if [[ ! "$EXPECT_KEY" =~ ^[0-9A-F]{40}$ ]]; then
    # A key id, an email or a partial fingerprint would all be accepted by
    # gpg as a --local-user and none of them can be compared against what
    # gpg reports having verified, which is always the full fingerprint.
    echo "verify.sh: --key must be a full 40-character fingerprint, not '$EXPECT_KEY'." >&2
    echo "  A short id or an email selects a key without identifying it." >&2
    exit 2
fi

echo "verify.sh: verifying GPG signature on $MANIFEST ..." >&2
echo "verify.sh: signature must come from $EXPECT_KEY (via $PIN_SOURCE)" >&2

# --status-fd rather than the human output, because "Good signature from
# <uid>" is a name and names are not the check. VALIDSIG carries the
# signing key's fingerprint as its first field and the PRIMARY key's as
# its last, which is the pair that matters here: K1's primary is
# certify-only and a signing subkey makes the signature, so the
# fingerprint a user reads on the published channel never appears as the
# signer. Either half may be named by --key; a mismatch on both is a
# wrong key. The human output still goes to stderr for the operator.
GPG_STATUS="$(gpg --status-fd 3 --verify "$SIG" "$MANIFEST" 3>&1 1>&2)" || {
    echo "verify.sh: gpg could not verify the signature on $MANIFEST" >&2
    exit 1
}

SIGNER_FPR="$(printf '%s\n' "$GPG_STATUS" | awk '/^\[GNUPG:\] VALIDSIG /{print toupper($3); exit}')"
PRIMARY_FPR="$(printf '%s\n' "$GPG_STATUS" | awk '/^\[GNUPG:\] VALIDSIG /{print toupper($NF); exit}')"
if [[ -z "$SIGNER_FPR" ]]; then
    echo "verify.sh: gpg reported no VALIDSIG for $MANIFEST; refusing to call it verified." >&2
    exit 1
fi
if [[ "$SIGNER_FPR" != "$EXPECT_KEY" && "$PRIMARY_FPR" != "$EXPECT_KEY" ]]; then
    echo "verify.sh: the signature is GOOD and it is from the WRONG KEY." >&2
    echo "  expected:  $EXPECT_KEY (via $PIN_SOURCE)" >&2
    echo "  signed by: $SIGNER_FPR (primary $PRIMARY_FPR)" >&2
    echo "  This is the failure a bare 'gpg --verify' cannot report: it" >&2
    echo "  answers whether somebody in your keyring signed the manifest," >&2
    echo "  never whether the release key did. Do not publish or install" >&2
    echo "  this release. If the release key was rotated, pass the" >&2
    echo "  fingerprint this release was signed with as --key, taking it" >&2
    echo "  from https://xchain.io/security." >&2
    exit 1
fi

echo "verify.sh: signer ok - $SIGNER_FPR (primary $PRIMARY_FPR)" >&2
echo "verify.sh: ok - hashes match, header anchors to $EXPECT_TAG, GPG signature is good and from the expected key" >&2
