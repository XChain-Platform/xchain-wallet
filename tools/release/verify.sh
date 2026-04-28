#!/usr/bin/env bash
# tools/release/verify.sh — local verification helper (G003 / §51).
#
# Re-computes SHA-256 hashes over every artifact in the input
# directory and compares against RELEASE_HASHES.txt; optionally
# verifies the GPG signature on the manifest. Mirrors the recipe in
# docs/VERIFY-RELEASE.md so a release engineer can do a round-trip
# check before publishing.
#
# Usage:
#   bash tools/release/verify.sh --input release-artifacts/vX.Y.Z/
#
# Modes:
#   default      — verify hashes AND signature (errors if either fails)
#   --no-sig     — skip the GPG signature check (useful pre-G180)
#   --recompute  — write a fresh RELEASE_HASHES.txt without verifying
#                  an existing one. Used by sign.sh's "--recompute"
#                  fallback when the GPG key is not yet configured.

set -euo pipefail

INPUT_DIR=""
MODE="verify"
RECOMPUTE=0
NO_SIG=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --input|-i)
            INPUT_DIR="$2"
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
            sed -n '2,22p' "$0"
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

if command -v sha256sum >/dev/null 2>&1; then
    SHA256="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
    SHA256="shasum -a 256"
else
    echo "verify.sh: neither sha256sum nor shasum found" >&2
    exit 2
fi

MANIFEST="$INPUT_DIR/RELEASE_HASHES.txt"
SIG="$MANIFEST.asc"

if [[ "$RECOMPUTE" -eq 1 ]]; then
    echo "verify.sh: recomputing manifest ..." >&2
    (
        cd "$INPUT_DIR"
        find . -maxdepth 1 -type f \
            ! -name 'RELEASE_HASHES.txt' \
            ! -name 'RELEASE_HASHES.txt.asc' \
            | LC_ALL=C sort \
            | xargs -I{} $SHA256 {} \
            > "RELEASE_HASHES.txt"
    )
    echo "verify.sh: wrote $MANIFEST (unsigned)" >&2
    exit 0
fi

if [[ ! -f "$MANIFEST" ]]; then
    echo "verify.sh: $MANIFEST not found — run sign.sh first or pass --recompute" >&2
    exit 1
fi

# Hash check.
echo "verify.sh: checking artifact hashes against $MANIFEST ..." >&2
(
    cd "$INPUT_DIR"
    if [[ "$SHA256" == "sha256sum" ]]; then
        sha256sum -c RELEASE_HASHES.txt
    else
        # macOS shasum: -c needs the manifest piped through stdin.
        shasum -a 256 -c RELEASE_HASHES.txt
    fi
)

if [[ "$NO_SIG" -eq 1 ]]; then
    echo "verify.sh: hash check ok (signature check skipped)" >&2
    exit 0
fi

# Signature check.
if [[ ! -f "$SIG" ]]; then
    echo "verify.sh: $SIG not found — run sign.sh or pass --no-sig" >&2
    exit 1
fi
if ! command -v gpg >/dev/null 2>&1; then
    echo "verify.sh: gpg not found in PATH (pass --no-sig to skip)" >&2
    exit 2
fi

echo "verify.sh: verifying GPG signature on $MANIFEST ..." >&2
gpg --verify "$SIG" "$MANIFEST"

echo "verify.sh: ok — hashes match and GPG signature is good" >&2
