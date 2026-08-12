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

# tools/release/verify-store.sh - post-publish verification (§4).
#
# Downloads-adjacent, not a downloader: this script does NOT reach out to
# the Chrome Web Store itself. There is no documented, supported API for
# "give me the exact bytes of my published item", and scraping the
# undocumented endpoint some third-party CRX-downloader tools use is
# exactly the kind of check that quietly breaks the day Google changes it
# - a check with a silent failure mode gets waived and then ignored,
# which is the one thing this script exists to never do (see below). So
# the operator supplies the store-served item instead, from one of two
# sources that are both real store output, not a guess:
#
#   --unpacked-dir <dir>   Chrome's OWN unpack of the item after
#                          installing it from the Chrome Web Store link
#                          (Chrome downloads, signature-checks, and
#                          unpacks the CRX itself at install time, under
#                          the extension's profile directory). This is
#                          also required anyway by spec §4's rollout exit
#                          criteria ("installed from the store link on at
#                          least 2 machines"), so it is not extra work.
#   --crx <file>           a raw CRX3 file the operator obtained some
#                          other way. Unpacked here per the published
#                          CRX3 format (magic + version + header length +
#                          protobuf header + zip payload); the header is
#                          skipped by length, not parsed.
#
# What gets compared: every file in the CI-built, RELEASE_HASHES-verified
# reference zip must be byte-identical to the same path in the
# store-served tree, with exactly two documented exceptions:
#
#   1. The store-injected `_metadata/` directory is skipped ENTIRELY. The
#      Chrome Web Store adds this itself on every install; it never
#      existed in what was submitted, so there is nothing in the
#      reference zip to compare it against.
#   2. `manifest.json` is compared STRUCTURALLY, not byte-for-byte, via
#      manifest-diff.mjs, ignoring only `update_url` and `key` (both
#      injected by the store on publish: the update-check endpoint and
#      the public key that keeps the extension ID stable). Every other
#      field must be exactly equal, at any depth. A byte diff on
#      manifest.json fails on EVERY publish even when nothing meaningful
#      changed, which is exactly how a real check becomes a permanently
#      waived one; see manifest-diff.mjs's header for the fuller case.
#
# A file present in the store tree that matches no reference file (and is
# not under `_metadata/`) is a hard failure: something shipped that this
# script cannot account for, which is the same "undeclared artifact"
# posture xr_check_expected takes in lib.sh, applied one layer down.
#
# THIS CHECK IS NEVER WAIVED. If it goes red and stays red, the check (or
# the store rewrite it doesn't yet know about) is broken and gets fixed,
# not skipped. A verification step nobody trusts to be green is worse
# than no verification step, because it launders a real regression
# behind a habit of ignoring it.
#
# Usage:
#   bash tools/release/verify-store.sh --input release-artifacts/vX.Y.Z/ \
#     --tag vX.Y.Z --unpacked-dir ~/store-installs/vX.Y.Z
#   bash tools/release/verify-store.sh --input release-artifacts/vX.Y.Z/ \
#     --tag vX.Y.Z --crx ~/Downloads/xchain-wallet.crx --no-sig
#
# Options (mirrors verify.sh's flag conventions):
#   --input <dir>        the staging directory holding the CI-built zip
#                         and RELEASE_HASHES.txt (default XCHAIN_RELEASE_DIR)
#   --tag <vX.Y.Z>        release this manifest must claim to describe
#                         (default XCHAIN_RELEASE_TAG)
#   --zip-name <name>     override the expected zip filename (default
#                         xchain-wallet-extension-<tag>.zip)
#   --unpacked-dir <dir>  a directory already holding the store-served,
#                         unpacked item (see above)
#   --crx <file>          a raw CRX3 file to unpack and compare instead
#   --ignore <k1,k2>      manifest.json top-level keys to ignore in the
#                         structural diff (default: update_url,key)
#   --no-sig              passed through to verify.sh: skip the GPG
#                         signature check on the reference zip (NOT a
#                         full verification of the reference; see verify.sh)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/release/lib.sh
source "$HERE/lib.sh"

INPUT_DIR=""
TAG=""
ZIP_NAME=""
UNPACKED_DIR=""
CRX_FILE=""
IGNORE_KEYS="update_url,key"
NO_SIG=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --input|-i) INPUT_DIR="$2"; shift 2 ;;
        --tag|-t) TAG="$2"; shift 2 ;;
        --zip-name) ZIP_NAME="$2"; shift 2 ;;
        --unpacked-dir) UNPACKED_DIR="$2"; shift 2 ;;
        --crx) CRX_FILE="$2"; shift 2 ;;
        --ignore) IGNORE_KEYS="$2"; shift 2 ;;
        --no-sig) NO_SIG=1; shift ;;
        --help|-h)
            awk '/^#\*+$/{seen++; next} seen>=2 && /^set -euo pipefail/{exit} seen>=2{print}' "$0"
            exit 0
            ;;
        *)
            echo "verify-store.sh: unknown argument '$1'" >&2
            exit 2
            ;;
    esac
done

if [[ -z "$INPUT_DIR" ]]; then INPUT_DIR="${XCHAIN_RELEASE_DIR:-}"; fi
if [[ -z "$INPUT_DIR" ]]; then
    echo "verify-store.sh: --input <dir> or XCHAIN_RELEASE_DIR is required" >&2
    exit 2
fi
if [[ ! -d "$INPUT_DIR" ]]; then
    echo "verify-store.sh: input dir '$INPUT_DIR' does not exist" >&2
    exit 2
fi

if [[ -z "$TAG" ]]; then TAG="${XCHAIN_RELEASE_TAG:-}"; fi
if [[ -z "$TAG" && -z "$ZIP_NAME" ]]; then
    echo "verify-store.sh: --tag <vX.Y.Z> (or XCHAIN_RELEASE_TAG), or --zip-name, is required" >&2
    echo "  --tag names the reference zip (xchain-wallet-extension-<tag>.zip) and is" >&2
    echo "  passed through to verify.sh's tag-anchor check; --zip-name alone works" >&2
    echo "  only against an unsigned/local manifest that carries no tag anchor" >&2
    echo "  (verify.sh --recompute), same as verify.sh itself." >&2
    exit 2
fi

if [[ -z "$ZIP_NAME" ]]; then ZIP_NAME="xchain-wallet-extension-${TAG}.zip"; fi

if [[ -z "$UNPACKED_DIR" && -z "$CRX_FILE" ]]; then
    echo "verify-store.sh: one of --unpacked-dir or --crx is required." >&2
    echo "  This script does not download from the Chrome Web Store itself" >&2
    echo "  (see the file header for why); supply the store-served item." >&2
    exit 2
fi
if [[ -n "$UNPACKED_DIR" && -n "$CRX_FILE" ]]; then
    echo "verify-store.sh: pass only one of --unpacked-dir or --crx, not both" >&2
    exit 2
fi
if [[ -n "$UNPACKED_DIR" && ! -d "$UNPACKED_DIR" ]]; then
    echo "verify-store.sh: --unpacked-dir '$UNPACKED_DIR' does not exist" >&2
    exit 2
fi
if [[ -n "$CRX_FILE" && ! -f "$CRX_FILE" ]]; then
    echo "verify-store.sh: --crx '$CRX_FILE' does not exist" >&2
    exit 2
fi
if ! command -v unzip >/dev/null 2>&1; then
    echo "verify-store.sh: unzip not found in PATH" >&2
    exit 2
fi
if ! command -v node >/dev/null 2>&1; then
    echo "verify-store.sh: node not found in PATH (needed for the structural manifest.json diff)" >&2
    exit 2
fi

# --- Step 1: prove the REFERENCE zip's integrity ------------------------
#
# Reuses verify.sh rather than re-implementing hash/signature/anchor
# checking. Everything downstream compares against files unzipped from
# THIS artifact, so if it is not what the signed manifest says it is,
# nothing this script does afterward means anything.
echo "verify-store.sh: verifying the reference zip ($ZIP_NAME) via verify.sh ..." >&2
VERIFY_ARGS=(--input "$INPUT_DIR" --artifact "$ZIP_NAME")
if [[ -n "$TAG" ]]; then VERIFY_ARGS+=(--tag "$TAG"); fi
if [[ "$NO_SIG" -eq 1 ]]; then VERIFY_ARGS+=(--no-sig); fi
bash "$HERE/verify.sh" "${VERIFY_ARGS[@]}" >&2

ZIP_PATH="$INPUT_DIR/$ZIP_NAME"
if [[ ! -f "$ZIP_PATH" ]]; then
    echo "verify-store.sh: $ZIP_PATH not found after verify.sh passed; unexpected." >&2
    exit 2
fi

# --- Step 2: unpack both trees -------------------------------------------
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
REF_DIR="$WORKDIR/reference"
mkdir -p "$REF_DIR"
echo "verify-store.sh: unpacking reference zip ..." >&2
unzip -qo "$ZIP_PATH" -d "$REF_DIR"

STORE_DIR=""
if [[ -n "$UNPACKED_DIR" ]]; then
    STORE_DIR="$UNPACKED_DIR"
    echo "verify-store.sh: comparing against the already-unpacked store item at $STORE_DIR" >&2
else
    # --- CRX3 unpack: magic(4) + version(4, LE u32) + header-len(4, LE u32)
    # + header (protobuf, skipped by length) + zip payload. Parsed by byte
    # offset, not a protobuf library: the header is never read, only skipped.
    MAGIC="$(od -An -c -j 0 -N 4 "$CRX_FILE" | tr -d ' \n')"
    if [[ "$MAGIC" != "Cr24" ]]; then
        echo "verify-store.sh: $CRX_FILE is not a CRX file (expected 'Cr24' magic, got '$MAGIC')" >&2
        exit 1
    fi
    read_le_u32() {
        local file="$1" offset="$2" b0 b1 b2 b3
        b0=$(od -An -tu1 -j "$offset" -N 1 "$file" | tr -d ' ')
        b1=$(od -An -tu1 -j "$((offset + 1))" -N 1 "$file" | tr -d ' ')
        b2=$(od -An -tu1 -j "$((offset + 2))" -N 1 "$file" | tr -d ' ')
        b3=$(od -An -tu1 -j "$((offset + 3))" -N 1 "$file" | tr -d ' ')
        echo $((b0 + b1 * 256 + b2 * 65536 + b3 * 16777216))
    }
    CRX_VERSION="$(read_le_u32 "$CRX_FILE" 4)"
    if [[ "$CRX_VERSION" != "3" ]]; then
        echo "verify-store.sh: $CRX_FILE declares CRX version $CRX_VERSION; only CRX3 is supported" >&2
        exit 1
    fi
    HEADER_LEN="$(read_le_u32 "$CRX_FILE" 8)"
    ZIP_OFFSET=$((12 + HEADER_LEN))
    echo "verify-store.sh: unpacking CRX3 ($CRX_FILE, header ${HEADER_LEN}B, zip payload at byte ${ZIP_OFFSET}) ..." >&2
    STORE_DIR="$WORKDIR/store"
    mkdir -p "$STORE_DIR"
    CRX_ZIP="$WORKDIR/store.zip"
    tail -c "+$((ZIP_OFFSET + 1))" "$CRX_FILE" > "$CRX_ZIP"
    unzip -qo "$CRX_ZIP" -d "$STORE_DIR"
fi

if [[ ! -f "$REF_DIR/manifest.json" ]]; then
    echo "verify-store.sh: reference zip has no manifest.json at its root; cannot proceed." >&2
    exit 2
fi
if [[ ! -f "$STORE_DIR/manifest.json" ]]; then
    echo "verify-store.sh: store-served tree has no manifest.json at its root; cannot proceed." >&2
    echo "  Check that --unpacked-dir/--crx points at the extension ROOT, not a" >&2
    echo "  parent or child directory." >&2
    exit 2
fi

# --- Step 3: compare -------------------------------------------------------
SHA256="$(xr_sha256_cmd)"
FAILURES=0
CHECKED=0

echo "verify-store.sh: comparing reference tree against store-served tree ..." >&2

while IFS= read -r rel; do
    CHECKED=$((CHECKED + 1))
    store_file="$STORE_DIR/$rel"

    if [[ "$rel" == "manifest.json" ]]; then
        if ! node "$HERE/manifest-diff.mjs" "$REF_DIR/manifest.json" "$store_file" --ignore "$IGNORE_KEYS" >&2; then
            FAILURES=$((FAILURES + 1))
        fi
        continue
    fi

    if [[ ! -f "$store_file" ]]; then
        echo "MISSING  $rel is in the reference zip but not in the store-served tree" >&2
        FAILURES=$((FAILURES + 1))
        continue
    fi

    ref_hash="$($SHA256 "$REF_DIR/$rel" | awk '{print $1}')"
    store_hash="$($SHA256 "$store_file" | awk '{print $1}')"
    if [[ "$ref_hash" != "$store_hash" ]]; then
        echo "MISMATCH  $rel differs between the reference zip and the store-served tree" >&2
        echo "  reference: $ref_hash" >&2
        echo "  store:     $store_hash" >&2
        FAILURES=$((FAILURES + 1))
    fi
done < <(cd "$REF_DIR" && find . -type f | sed 's#^\./##' | LC_ALL=C sort)

# Files the store shipped that the reference never declared, excluding the
# one directory the store is allowed to add on its own.
while IFS= read -r rel; do
    case "$rel" in
        _metadata/*) continue ;;
    esac
    if [[ ! -f "$REF_DIR/$rel" ]]; then
        echo "UNDECLARED  $rel is in the store-served tree but not in the reference zip" >&2
        FAILURES=$((FAILURES + 1))
    fi
done < <(cd "$STORE_DIR" && find . -type f | sed 's#^\./##' | LC_ALL=C sort)

echo >&2
if [[ "$FAILURES" -gt 0 ]]; then
    echo "verify-store.sh: FAILED - $FAILURES problem(s) across $CHECKED reference file(s)." >&2
    echo "  This check is never waived: fix the mismatch or fix this script's" >&2
    echo "  exception list if the store started injecting something new and" >&2
    echo "  legitimate. Do not skip a run because it went red." >&2
    exit 1
fi

echo "verify-store.sh: ok - $CHECKED reference file(s) match the store-served tree" >&2
echo "  (excluding _metadata/, manifest.json compared structurally ignoring: $IGNORE_KEYS)" >&2
