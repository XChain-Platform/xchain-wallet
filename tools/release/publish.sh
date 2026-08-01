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

# tools/release/publish.sh - §6 step 5: put a signed release on the feed.
#
# Usage:
#   bash tools/release/publish.sh --input release-artifacts/vX.Y.Z/ \
#     --tag vX.Y.Z --target /srv/downloads/wallet
#   bash tools/release/publish.sh ... --target user@origin-host:/srv/downloads/wallet
#   bash tools/release/publish.sh ... --dry-run
#
# Options:
#   --input <dir>    the signed staging directory
#   --tag <vX.Y.Z>   the release being published
#   --target <path>  local path or rsync host:path for wallet/
#   --dry-run        print the plan and change nothing
#
# UPLOAD ORDER IS THE WHOLE POINT. The channel pointers go LAST, after
# every binary they name is already in place. Uploaded first, or in
# parallel, there is a window where a desktop client reads a yml pointing
# at a binary that is not there yet: the update fails, the user sees an
# error for a release that is perfectly fine, and the window is exactly
# as long as the largest upload.
#
# WHICH FILES ARE THE POINTERS is asked of update-info.mjs, not guessed
# from a name. This script used to split on `latest*.yml`; the desktop
# build sets `channel: 'stable'` and emits `stable-mac.yml`, so the
# pointer list came back EMPTY (nothing was ever uploaded last, because
# nothing was recognised as a pointer at all) while the same files fell
# through into the binary phase and were uploaded FIRST. Both halves of
# the ordering guarantee were inverted at once, silently. See  §7.1.
#
# The same reasoning runs backwards during a rollback (§6b): re-uploading
# the previous yml is safe precisely because §3 retention guarantees its
# binaries never left.
#
# IMMUTABILITY. A published version is never modified in place. Two
# signed manifests for one version make tampering indistinguishable from
# housekeeping, so this refuses to overwrite an existing release rather
# than asking. Corrections are a new version (§6b).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Sourced for xr_list_artifacts / xr_list_update_info. The artifact-vs-
# pointer split has to be the SAME split sign.sh hashed into the manifest;
# a second copy of the rule here is how the manifest and the upload
# quietly stop describing the same set of files.
# shellcheck source=tools/release/lib.sh
. "$HERE/lib.sh"

INPUT_DIR=""
TAG=""
TARGET=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --input|-i) INPUT_DIR="$2"; shift 2 ;;
        --tag|-t) TAG="$2"; shift 2 ;;
        --target) TARGET="$2"; shift 2 ;;
        --dry-run|-n) DRY_RUN=1; shift ;;
        --help|-h)
            awk '/^#\*+$/{seen++; next} seen>=2 && /^set -euo pipefail/{exit} seen>=2{print}' "$0"
            exit 0
            ;;
        *) echo "publish.sh: unknown argument '$1'" >&2; exit 2 ;;
    esac
done

[[ -n "$INPUT_DIR" ]] || { echo "publish.sh: --input <dir> is required" >&2; exit 2; }
[[ -n "$TAG" ]] || { echo "publish.sh: --tag <vX.Y.Z> is required" >&2; exit 2; }
[[ -n "$TARGET" ]] || { echo "publish.sh: --target <path or host:path> is required" >&2; exit 2; }
[[ -d "$INPUT_DIR" ]] || { echo "publish.sh: input dir '$INPUT_DIR' does not exist" >&2; exit 2; }

MANIFEST="$INPUT_DIR/RELEASE_HASHES.txt"
for required in "$MANIFEST" "$MANIFEST.asc"; do
    if [[ ! -f "$required" ]]; then
        echo "publish.sh: $required is missing; sign the release first." >&2
        echo "  Publishing an unsigned or partly-signed release is not a" >&2
        echo "  thing to do by accident, so this refuses rather than warns." >&2
        exit 1
    fi
done

# Verify before uploading, not after. An artifact that fails here has
# cost nothing; one that fails after upload is already reachable.
echo "publish.sh: verifying the signed release before upload ..." >&2
bash "$HERE/verify.sh" --input "$INPUT_DIR" --tag "$TAG" >&2

# Remote helpers. A target with a colon before any slash is an rsync
# host:path; anything else is a local directory.
is_remote() { [[ "$TARGET" == *:* && "$TARGET" != /* && "$TARGET" != .* ]]; }

remote_run() {
    if is_remote; then
        ssh "${TARGET%%:*}" "$1"
    else
        bash -c "$1"
    fi
}

target_path() {
    if is_remote; then echo "${TARGET#*:}"; else echo "$TARGET"; fi
}

BASE="$(target_path)"
MANIFEST_REMOTE="$BASE/RELEASE_HASHES/$TAG.txt"

# Immutability check.
if remote_run "test -e '$MANIFEST_REMOTE'" 2>/dev/null; then
    echo "publish.sh: $TAG is already published." >&2
    echo "  Published versions and their manifests are never modified in" >&2
    echo "  place (§3): two signed manifests for one version make tampering" >&2
    echo "  indistinguishable from housekeeping. Cut a new version." >&2
    exit 1
fi

# Split the upload into ordered phases. Everything a yml could point at
# lands before any yml does.
# Read with a while loop rather than `mapfile`: that is bash 4+, and the
# release machine is a Mac, whose system bash is 3.2.
YMLS=()
while IFS= read -r line; do [[ -n "$line" ]] && YMLS+=("$line"); done < <(
    xr_list_update_info "$INPUT_DIR")
BINARIES=()
while IFS= read -r line; do [[ -n "$line" ]] && BINARIES+=("$line"); done < <(
    xr_list_artifacts "$INPUT_DIR")

# A desktop release with no channel pointer installs nobody. Nothing
# downstream would fail: the artifacts land, the manifest verifies, the
# feed looks healthy, and every wallet in the field simply never hears
# about the version. Refuse here, where it is still a build problem.
if [[ ${#YMLS[@]} -eq 0 ]]; then
    echo "publish.sh: no channel pointers in $INPUT_DIR." >&2
    echo "  A release with no update-info yml is invisible to every" >&2
    echo "  installed wallet, permanently, with nothing logged. Check that" >&2
    echo "  the desktop lanes ran and that their *.yml files were collected" >&2
    echo "  into the staging directory ( §7.1)." >&2
    exit 1
fi

echo "publish.sh: plan for $TAG -> $TARGET" >&2
echo "  1. ${#BINARIES[@]} artifact(s)" >&2
echo "  2. signed manifest as RELEASE_HASHES/$TAG.txt (+ .asc)" >&2
echo "  3. ${#YMLS[@]} channel pointer(s), LAST" >&2

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "publish.sh: --dry-run, nothing uploaded." >&2
    exit 0
fi

copy_to() {
    local src="$1" dest="$2"
    if is_remote; then
        rsync -a "$src" "${TARGET%%:*}:$dest"
    else
        mkdir -p "$(dirname "$dest")"
        cp -p "$src" "$dest"
    fi
}

# --- Phase 1: artifacts -------------------------------------------------
remote_run "mkdir -p '$BASE/desktop' '$BASE/extension' '$BASE/web' '$BASE/RELEASE_HASHES'"
for rel in "${BINARIES[@]}"; do
    name="${rel#./}"
    case "$name" in
        *.tar.gz) sub="web" ;;
        xchain-wallet-extension-*.zip) sub="extension" ;;
        *) sub="desktop" ;;
    esac
    echo "publish.sh: uploading $name -> $sub/" >&2
    copy_to "$INPUT_DIR/$name" "$BASE/$sub/$name"
done

# --- Phase 2: the signed manifest, under its versioned name -------------
#
# The versioned name is what lets verify.sh anchor a manifest to a
# release without being told which one it is.
echo "publish.sh: uploading the signed manifest as RELEASE_HASHES/$TAG.txt" >&2
copy_to "$MANIFEST" "$BASE/RELEASE_HASHES/$TAG.txt"
copy_to "$MANIFEST.asc" "$BASE/RELEASE_HASHES/$TAG.txt.asc"

# --- Phase 3: channel pointers, LAST ------------------------------------
for rel in "${YMLS[@]}"; do
    name="${rel#./}"
    echo "publish.sh: uploading $name (channel pointer, last)" >&2
    copy_to "$INPUT_DIR/$name" "$BASE/desktop/$name"
done

echo "publish.sh: ok - $TAG is live" >&2
echo >&2
echo "  Not done yet: purge the Cloudflare cache for the yml paths if the" >&2
echo "  cache-bypass rule is not in place, then run the §6 step 7" >&2
echo "  clean-machine verify against the PUBLISHED manifest, not the" >&2
echo "  local one." >&2
