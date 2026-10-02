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
#     --manifest RELEASE_HASHES/vX.Y.Z.txt --tag vX.Y.Z --webroot /srv/www/wallet
#   bash tools/release/deploy-web.sh ... --dry-run
#
# Deploys from the SAME tarball that was signed and published, never
# from a fresh local build. A rebuild is a different artifact: it would
# not match the manifest, and the thing users are served would be
# something nobody signed.
#
# AND IT CHECKS THAT, rather than stating it. Until 2026-08-15 the
# sentence above was the only thing enforcing it: the script's inputs
# were checked for existence and an index.html, so any tarball with an
# entry point - a fresh local rebuild, a stale one from another version,
# a tampered file - was unpacked and flipped live. The sibling effector
# on the same seam, cws-upload.mjs, has refused bytes that no signed
# manifest describes since it was written, so the web lane was the one
# hop of a release that shipped unverified bytes.
#
# So --manifest is REQUIRED and verify.sh runs before anything is
# written: sha256 against the manifest row for this tarball, the header
# anchored to --tag so another release's manifest cannot satisfy it, and
# the detached signature bound to the release key. --dry-run runs it too,
# which is what makes the dry run a preflight rather than an echo.
#
# --no-sig is for a webroot host with no gpg and no keyring, which is a
# real deployment. It forwards to verify.sh's own degraded mode, so the
# hash and the anchor are still checked and the tool says out loud that
# what ran was not a verification. It is not a way to skip the manifest:
# there is no flag for that, because a tarball nothing describes is
# exactly the artifact this step exists to refuse.
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

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARBALL=""
MANIFEST=""
TAG=""
WEBROOT=""
KEEP=5
DRY_RUN=0
NO_SIG=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tarball) TARBALL="$2"; shift 2 ;;
        --manifest|-m) MANIFEST="$2"; shift 2 ;;
        --tag|-t) TAG="$2"; shift 2 ;;
        --webroot|-w) WEBROOT="$2"; shift 2 ;;
        --keep) KEEP="$2"; shift 2 ;;
        --no-sig) NO_SIG=1; shift ;;
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
[[ -n "$MANIFEST" ]] || {
    echo "deploy-web.sh: --manifest <path> is required" >&2
    echo "  The signed RELEASE_HASHES/<tag>.txt that covers this tarball, with its" >&2
    echo "  .asc beside it. Without one there is nothing to check the bytes against," >&2
    echo "  and 'the tarball that was signed' is a claim rather than a fact." >&2
    exit 2
}
[[ -f "$MANIFEST" ]] || { echo "deploy-web.sh: manifest '$MANIFEST' does not exist" >&2; exit 2; }

# ONE SET OF BYTES, HASHED AND UNPACKED. Until 2026-09-05 verify.sh was
# pointed at the tarball's own directory and tar re-opened that same path
# afterwards, which is two reads of a file a concurrent writer can change in
# between: bytes that passed the gate, and different bytes unpacked and
# flipped live under the release's name. Copy the tarball into a directory
# only this run knows about and let BOTH steps read that copy, so "verified"
# names an object rather than a moment.
#
# The copy goes to TMPDIR and never under the webroot, because the check
# below has to be able to refuse having written nothing where the site
# lives. An operator whose default TMPDIR is too small for the artifact
# points TMPDIR at somewhere with room.
STAGE="$(mktemp -d)" || { echo "deploy-web.sh: could not create a staging dir." >&2; exit 1; }
# Remove the half-unpacked release too (PARTIAL, set at the unpack below),
# and route signals through EXIT so an interrupted extract is cleaned as well.
PARTIAL=""
cleanup() {
    rm -rf "$STAGE"
    [[ -z "$PARTIAL" ]] || rm -rf "$PARTIAL"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
STAGED_TARBALL="$STAGE/$(basename "$TARBALL")"
cp "$TARBALL" "$STAGED_TARBALL" || {
    echo "deploy-web.sh: could not stage a private copy of '$TARBALL'." >&2
    exit 1
}
# Stage the manifest and its signature too, for the same reason: verify.sh
# reads the manifest several times (hash table, header, signature) and the gate
# below reads it again, so every read must see one private object. The
# basename is kept because verify.sh takes the tag anchor from it, and the
# subdirectory keeps the staged artifact alone in --input.
mkdir "$STAGE/manifest" || { echo "deploy-web.sh: could not create a manifest staging dir." >&2; exit 1; }
STAGED_MANIFEST="$STAGE/manifest/$(basename "$MANIFEST")"
cp "$MANIFEST" "$STAGED_MANIFEST" || {
    echo "deploy-web.sh: could not stage a private copy of '$MANIFEST'." >&2
    exit 1
}
# A missing .asc is left for verify.sh to refuse when a signature is required.
if [[ -f "$MANIFEST.asc" ]]; then
    cp "$MANIFEST.asc" "$STAGED_MANIFEST.asc" || {
        echo "deploy-web.sh: could not stage a private copy of '$MANIFEST.asc'." >&2
        exit 1
    }
fi

# PROVENANCE, BEFORE ANYTHING IS WRITTEN. A tarball that fails here has cost
# nothing; one that fails after the flip is already being served. verify.sh
# narrows the hash check to this one artifact with --artifact and still checks
# the tag anchor and the signature in full, which is what it was built for.
# It is pointed at the staging dir; the manifest row is matched on the
# basename, which the staged copy keeps.
VERIFY_ARGS=(
    --input "$STAGE"
    --manifest "$STAGED_MANIFEST"
    --artifact "$(basename "$TARBALL")"
    --tag "$TAG"
)
if [[ "$NO_SIG" -eq 1 ]]; then
    VERIFY_ARGS+=(--no-sig)
    echo "deploy-web.sh: --no-sig, so this checks the bytes and NOT who signed them." >&2
fi
echo "deploy-web.sh: verifying the tarball against $MANIFEST ..." >&2
bash "$HERE/verify.sh" "${VERIFY_ARGS[@]}" >&2 || {
    echo "deploy-web.sh: '$TARBALL' did not verify against $MANIFEST; refusing to deploy." >&2
    echo "  Nothing was unpacked and the live symlink was not touched. Deploy the" >&2
    echo "  tarball that was signed and published, not a rebuild of it." >&2
    exit 1
}

# Refuse unless the manifest records the dev-mock gate as `enforced`, the rule
# the desktop updater applies. verify.sh only warns, and this step puts the
# bytes live. Read from the staged copy the check above just verified.
M_GATE="$(sed -n 's/^# dev-mock-gate: //p' "$STAGED_MANIFEST" | head -1)"
if [[ "$M_GATE" != "enforced" ]]; then
    echo "deploy-web.sh: $MANIFEST records the dev-mock gate as '${M_GATE:-unrecorded}', not 'enforced'; refusing to deploy." >&2
    echo "  The gate keeps the fabricated-address dev SDK, which cannot sign or" >&2
    echo "  broadcast, out of a shipped bundle. Nothing was unpacked and the live" >&2
    echo "  symlink was not touched. Re-sign the release with the gate running." >&2
    exit 1
fi

RELEASES="$WEBROOT/releases"
TARGET="$RELEASES/$TAG"
CURRENT="$WEBROOT/current"

if [[ -e "$TARGET" ]]; then
    echo "deploy-web.sh: $TARGET already exists." >&2
    echo "  A published version is never rebuilt in place (§3). To roll" >&2
    echo "  BACK to it, flip the symlink; do not redeploy over it:" >&2
    echo "    ln -sfn '$TARGET' '$CURRENT.tmp' && mv -Tf '$CURRENT.tmp' '$CURRENT'" >&2
    echo "  If an earlier deploy of $TAG failed, a copy of this script older than" >&2
    echo "  the hidden-sibling unpack may have left it half-written: remove it and" >&2
    echo "  deploy again rather than flipping to it." >&2
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

# Unpack beside the live tree, not into it, and from the staged copy the
# gate hashed rather than a fresh read of the caller's path.
#
# Into a hidden sibling first, renamed into place only once complete, so
# releases/<tag> never exists half-written for the check above to offer as a
# rollback target. Plain mkdir, not mktemp -d: the dir keeps the umask mode
# the web server reads it with, where mktemp's 0700 survives a BSD tar.
mkdir -p "$RELEASES"
PARTIAL="$RELEASES/.$TAG.partial.$$"
mkdir "$PARTIAL" || { PARTIAL=""; echo "deploy-web.sh: could not create an unpack dir under $RELEASES." >&2; exit 1; }
tar -xzf "$STAGED_TARBALL" -C "$PARTIAL"

if [[ ! -f "$PARTIAL/index.html" ]]; then
    echo "deploy-web.sh: no index.html in the unpacked release; refusing to flip." >&2
    echo "  Serving a directory with no entry point would take the site down" >&2
    echo "  as completely as deleting it, and the symlink would look healthy." >&2
    exit 1
fi

# Detect `mv -T` once; the rename below and the flip after it both use it.
HAVE_MV_T=0
if mv --help 2>&1 | grep -q -- '-T'; then HAVE_MV_T=1; fi

# Rename, never nest: a plain mv onto a $TARGET that appeared since the check
# above (a concurrent run) would move the release INSIDE it. `mv -T` refuses.
if [[ "$HAVE_MV_T" -eq 1 ]]; then
    mv -T "$PARTIAL" "$TARGET" || {
        echo "deploy-web.sh: could not rename the unpacked release to $TARGET; refusing to flip." >&2
        exit 1
    }
else
    # BSD has no -T, so re-check just before the rename (not atomic, as below).
    [[ ! -e "$TARGET" ]] || {
        echo "deploy-web.sh: $TARGET appeared during the unpack; refusing to flip." >&2
        exit 1
    }
    mv "$PARTIAL" "$TARGET"
fi
PARTIAL=""

# The flip. `mv -T` replaces the symlink itself atomically. Without -T,
# mv would move the new link INSIDE the directory the old one points at,
# leaving the site on the previous release and a stray link behind: the
# classic symlink-swap footgun, which is why this checks rather than
# hopes.
PREVIOUS=""
if [[ -L "$CURRENT" ]]; then
    PREVIOUS="$(readlink "$CURRENT")"
fi

if [[ "$HAVE_MV_T" -eq 1 ]]; then
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
#
# BOTH halves are enforced here, because for a while only the first was.
# Rollback is a bare symlink flip, which does not touch the target
# directory's mtime, so after a rollback the previously-live release is an
# OLD directory by `ls -1t`. The next forward deploy then selected it for
# deletion and the run destroyed the exact release the line above promises
# to keep; with --keep 1 that happened on every deploy, rollback or not.
# PREVIOUS holds the symlink target, so its basename is the directory name
# `ls -1t` reports; empty on a first-ever deploy, where the guard is a no-op.
PREVIOUS_NAME="${PREVIOUS##*/}"
# `ls -1t` with no -a/-A on purpose: it never lists a dot-prefixed
# `.<tag>.partial.*` dir, so a concurrent run's unpack is never pruned.
if [[ "$KEEP" -gt 0 ]]; then
    PRUNED=0
    while IFS= read -r old; do
        [[ -z "$old" ]] && continue
        [[ "$old" == "$TAG" ]] && continue
        [[ -n "$PREVIOUS_NAME" && "$old" == "$PREVIOUS_NAME" ]] && continue
        rm -rf "${RELEASES:?}/$old"
        PRUNED=$((PRUNED + 1))
    done < <(cd "$RELEASES" && ls -1t 2>/dev/null | tail -n "+$((KEEP + 1))")
    [[ "$PRUNED" -gt 0 ]] && echo "  pruned $PRUNED release(s) beyond the newest $KEEP" >&2
fi

echo >&2
echo "  Check the server is serving index.html no-cache and assets/*" >&2
echo "  immutable before calling step 5b done. The flip is invisible to" >&2
echo "  anyone holding a cached entry point." >&2
