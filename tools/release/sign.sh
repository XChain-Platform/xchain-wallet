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

# tools/release/sign.sh - release-signing pipeline (G003 / §51).
#
# Computes a SHA-256 manifest over every artifact in the input
# directory, then GPG-signs the manifest with the release key.
# Outputs:
#   <input-dir>/RELEASE_HASHES.txt       - sha256sum-format manifest
#   <input-dir>/RELEASE_HASHES.txt.asc   - detached GPG signature
#
# Usage:
#   XCHAIN_RELEASE_GPG_KEY=<fingerprint> \
#     bash tools/release/sign.sh --input release-artifacts/vX.Y.Z/
#
# Environment:
#   XCHAIN_RELEASE_GPG_KEY   GPG key fingerprint or email (required)
#   XCHAIN_RELEASE_DIR       Default --input value (optional)
#   GNUPGHOME                Override GPG home (optional)
#
# Status: scaffolding. The script runs end-to-end but refuses to
# proceed without XCHAIN_RELEASE_GPG_KEY set, since the wallet's
# release key is not yet published (tracked as G180 in
# claude/reports/xchain-wallet/SPEC_GAPS.md).

set -euo pipefail

INPUT_DIR=""
FORCE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --input|-i)
            INPUT_DIR="$2"
            shift 2
            ;;
        --force|-f)
            FORCE=1
            shift
            ;;
        --help|-h)
            sed -n '2,20p' "$0"
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
if ! command -v sha256sum >/dev/null 2>&1; then
    if command -v shasum >/dev/null 2>&1; then
        SHA256="shasum -a 256"
    else
        echo "sign.sh: neither sha256sum nor shasum found" >&2
        exit 2
    fi
else
    SHA256="sha256sum"
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

echo "sign.sh: hashing artifacts in $INPUT_DIR ..." >&2
(
    cd "$INPUT_DIR"
    # Hash every file at the top level except the manifest itself.
    # Sorted so the manifest is deterministic across runs.
    find . -maxdepth 1 -type f \
        ! -name 'RELEASE_HASHES.txt' \
        ! -name 'RELEASE_HASHES.txt.asc' \
        | LC_ALL=C sort \
        | xargs -I{} $SHA256 {} \
        > "RELEASE_HASHES.txt"
)

if [[ ! -s "$MANIFEST" ]]; then
    echo "sign.sh: no artifacts found in $INPUT_DIR - nothing to sign." >&2
    rm -f "$MANIFEST"
    exit 1
fi

echo "sign.sh: signing manifest with key $XCHAIN_RELEASE_GPG_KEY ..." >&2
gpg --batch --yes \
    --local-user "$XCHAIN_RELEASE_GPG_KEY" \
    --armor \
    --detach-sign \
    --output "$SIG" \
    "$MANIFEST"

echo "sign.sh: ok" >&2
echo "  manifest:  $MANIFEST" >&2
echo "  signature: $SIG" >&2
