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

# tools/release/deploy-web.sh - §6 step 5b: put the web SPA live.
#
# Usage:
#   bash tools/release/deploy-web.sh --tarball xchain-wallet-web-vX.Y.Z.tar.gz \
#     --tag vX.Y.Z --webroot /srv/www/wallet
#   bash tools/release/deploy-web.sh ... --dry-run
#
# Deploys from the SAME tarball that was signed and published, never
# from a fresh local build. A rebuild is a different artifact: it would
# not match the manifest, and the thing users are served would be
# something nobody signed.
#
# ATOMIC FLIP. The release unpacks into its own versioned directory and
# a symlink is swapped to point at it. Nothing is ever written into the
# live directory. Unpacking over a running site serves a mixture of two
# builds for the length of the copy: an index.html from the new release
# asking for chunks that are still the old ones, which is a white screen
# for whoever loads the page in that window.
#
# Rollback is the same swap in reverse, which is why old versions are
# kept rather than pruned.
#
# THE CACHING CONTRACT, which this script cannot enforce and the web
# server must:
#   index.html            no-cache, must-revalidate
#   assets/* (hashed)     immutable, max-age=31536000
# The hashed filenames make the assets safe to cache forever, and the
# entry point must never be cached or a flip changes nothing for anyone
# holding a stale index.html. If a service worker is ever added, its
# update behaviour becomes part of this step's contract too.

set -euo pipefail

TARBALL=""
TAG=""
WEBROOT=""
KEEP=5
DRY_RUN=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tarball) TARBALL="$2"; shift 2 ;;
        --tag|-t) TAG="$2"; shift 2 ;;
        --webroot|-w) WEBROOT="$2"; shift 2 ;;
        --keep) KEEP="$2"; shift 2 ;;
        --dry-run|-n) DRY_RUN=1; shift ;;
        --help|-h)
            awk '/^#\*+$/{seen++; next} seen>=2 && /^set -euo pipefail/{exit} seen>=2{print}' "$0"
            exit 0
            ;;
        *) echo "deploy-web.sh: unknown argument '$1'" >&2; exit 2 ;;
    esac
done

[[ -n "$TARBALL" ]] || { echo "deploy-web.sh: --tarball <path> is required" >&2; exit 2; }
[[ -n "$TAG" ]] || { echo "deploy-web.sh: --tag <vX.Y.Z> is required" >&2; exit 2; }
[[ -n "$WEBROOT" ]] || { echo "deploy-web.sh: --webroot <dir> is required" >&2; exit 2; }
[[ -f "$TARBALL" ]] || { echo "deploy-web.sh: tarball '$TARBALL' does not exist" >&2; exit 2; }

RELEASES="$WEBROOT/releases"
TARGET="$RELEASES/$TAG"
CURRENT="$WEBROOT/current"

if [[ -e "$TARGET" ]]; then
    echo "deploy-web.sh: $TARGET already exists." >&2
    echo "  A published version is never rebuilt in place (§3). To roll" >&2
    echo "  BACK to it, flip the symlink; do not redeploy over it:" >&2
    echo "    ln -sfn '$TARGET' '$CURRENT.tmp' && mv -Tf '$CURRENT.tmp' '$CURRENT'" >&2
    exit 1
fi

echo "deploy-web.sh: plan" >&2
echo "  unpack:  $TARBALL -> $TARGET" >&2
echo "  flip:    $CURRENT -> releases/$TAG" >&2
echo "  keep:    the $KEEP most recent releases" >&2

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "deploy-web.sh: --dry-run, nothing changed." >&2
    exit 0
fi

# Unpack beside the live tree, not into it.
mkdir -p "$TARGET"
tar -xzf "$TARBALL" -C "$TARGET"

if [[ ! -f "$TARGET/index.html" ]]; then
    echo "deploy-web.sh: no index.html in the unpacked release; refusing to flip." >&2
    echo "  Serving a directory with no entry point would take the site down" >&2
    echo "  as completely as deleting it, and the symlink would look healthy." >&2
    rm -rf "$TARGET"
    exit 1
fi

# The flip. `mv -T` replaces the symlink itself atomically. Without -T,
# mv would move the new link INSIDE the directory the old one points at,
# leaving the site on the previous release and a stray link behind: the
# classic symlink-swap footgun, which is why this checks rather than
# hopes.
PREVIOUS=""
if [[ -L "$CURRENT" ]]; then
    PREVIOUS="$(readlink "$CURRENT")"
fi

if mv --help 2>&1 | grep -q -- '-T'; then
    ln -sfn "$TARGET" "$CURRENT.tmp"
    mv -Tf "$CURRENT.tmp" "$CURRENT"
else
    # BSD/macOS: `ln -h` refuses to follow the existing symlink, so the
    # link is replaced rather than created inside its target. Not atomic
    # (it unlinks first), so prefer a GNU host for the live flip.
    echo "deploy-web.sh: no 'mv -T' here; using the BSD symlink replace." >&2
    echo "  That path is NOT atomic. Fine for a test host, not for prod." >&2
    ln -shf "$TARGET" "$CURRENT"
fi

echo "deploy-web.sh: live on $TAG" >&2
[[ -n "$PREVIOUS" ]] && echo "  previous: $PREVIOUS (kept, so a rollback is one flip)" >&2

# Prune old releases, never the one currently live and never the one
# before it: §3 retention wants the proven-good rollback target present.
if [[ "$KEEP" -gt 0 ]]; then
    PRUNED=0
    while IFS= read -r old; do
        [[ -z "$old" ]] && continue
        [[ "$old" == "$TAG" ]] && continue
        rm -rf "${RELEASES:?}/$old"
        PRUNED=$((PRUNED + 1))
    done < <(cd "$RELEASES" && ls -1t 2>/dev/null | tail -n "+$((KEEP + 1))")
    [[ "$PRUNED" -gt 0 ]] && echo "  pruned $PRUNED release(s) beyond the newest $KEEP" >&2
fi

echo >&2
echo "  Check the server is serving index.html no-cache and assets/*" >&2
echo "  immutable before calling step 5b done. The flip is invisible to" >&2
echo "  anyone holding a cached entry point." >&2
