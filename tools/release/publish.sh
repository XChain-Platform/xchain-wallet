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
#     --tag vX.Y.Z --target /srv/downloads/wallet \
#     --public-base https://downloads.xchain.io/wallet
#   bash tools/release/publish.sh ... --target user@origin-host:/srv/downloads/wallet
#   bash tools/release/publish.sh ... --staging   # §7.5 rehearsal set
#   bash tools/release/publish.sh ... --dry-run
#
# Options:
#   --input <dir>       the signed staging directory
#   --tag <vX.Y.Z>      the release being published
#   --target <path>     local path or rsync host:path for wallet/
#   --public-base <url> where that target is served from, for the edge check
#   --staging           publish the rehearsal set to the staging feed (§7.5)
#   --rehearsal <file>  the passing rehearsal record for this release
#   --release-record <file>  the §6 release record for this release
#   --no-edge-verify    skip the edge check; must be typed, never defaulted
#   --dry-run           print the plan and change nothing
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
#
# THE EDGE CAN INVERT THE UPLOAD ORDER (§7.3). Ordering the upload at the
# ORIGIN buys nothing if Cloudflare is still serving a cached 404 for a
# binary that landed thirty seconds ago: the client reads a fresh pointer
# and fetches a file the edge says does not exist. So between the binaries
# and the pointers there is a phase that fetches every artifact THROUGH
# the public URL and requires a 200. The guarantee is only worth stating
# at the layer clients actually read from.
#
# PROD VS REHEARSAL IS NOT VISIBLE IN A FILE LISTING (§7.5). A rehearsal
# build is the same code and the same version with a different feed baked
# in, and electron-builder names artifacts by version, not by channel, so
# the two directories hold identically-named, byte-different twins. Two
# guards, both structural: the pointers in the input must all belong to
# the expected channel, and the staging feed root carries a `.staging-feed`
# marker that a prod publish refuses to write into (and vice versa).
#
# AND THE REHEARSAL MUST HAVE HAPPENED (§7.5). "No release's yml goes to
# wallet/desktop/ before its staging rehearsal passes" is the rule; a rule
# with nothing enforcing it is one that gets skipped on the release that
# is running late, which is the release most likely to need it. So a
# production publish requires a rehearsal RECORD, and the record is bound
# to the signed manifest in hand, not merely to the tag: re-cutting a
# release after a failed lane produces new bytes that nobody rehearsed,
# under the same version. Staging publishes are exempt for the obvious
# reason - publishing the staging set is step one OF the rehearsal.
#
# AND THE RELEASE MUST HAVE A RECORD (§6, ). Same shape, same
# reason, one document over. §6 says the release record is instantiated
# from TEMPLATE.md at the START of a release and closed by step 8, and
# for the first release nothing created it and nothing asked for it:
# v0.334.0 was tagged, built green and left half-finished while
# `claude/reports/wallet-releases/` still held only TEMPLATE.md, so for a
# day the only account of it lived in GitHub's run history and had to be
# reconstructed from a CI summary job afterwards. A production publish
# now refuses without an instantiated record, with no skip switch. An
# untouched copy of the template does not count, because `cp TEMPLATE.md
# vX.Y.Z.md` is the cheapest way to make a gate stop asking.

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
PUBLIC_BASE=""
DRY_RUN=0
STAGING=0
EDGE_VERIFY=1
REHEARSAL_RECORD=""
RELEASE_RECORD=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --input|-i) INPUT_DIR="$2"; shift 2 ;;
        --tag|-t) TAG="$2"; shift 2 ;;
        --target) TARGET="$2"; shift 2 ;;
        --public-base) PUBLIC_BASE="${2%/}"; shift 2 ;;
        --staging) STAGING=1; shift ;;
        --rehearsal) REHEARSAL_RECORD="$2"; shift 2 ;;
        --release-record) RELEASE_RECORD="$2"; shift 2 ;;
        --no-edge-verify) EDGE_VERIFY=0; shift ;;
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

if [[ "$STAGING" -eq 1 ]]; then
    EXPECT_CHANNEL="staging"
else
    EXPECT_CHANNEL="stable"
fi

# Remote helpers, defined before the first check that needs to know which
# kind of target this is. A target with a colon before any slash is an
# rsync host:path; anything else is a local directory.
is_remote() { [[ "$TARGET" == *:* && "$TARGET" != /* && "$TARGET" != .* ]]; }

target_path() {
    if is_remote; then echo "${TARGET#*:}"; else echo "$TARGET"; fi
}

# EVERYTHING REMOTE GOES THROUGH RSYNC, NEVER ssh. The K11 deploy key is
# pinned to a forced `rrsync` command so that holding it grants writes
# into one directory and nothing else (host runbook §4). Under that
# restriction `ssh host "test -e ..."` does not run: rrsync answers
# "SSH_ORIGINAL_COMMAND does not run rsync" and exits. This script used
# ssh for three things (an existence probe, the immutability check, and
# mkdir), so a correctly-hardened feed would have failed every publish.
# The probes are reads and the mkdir is `--mkpath`, both of which rrsync
# allows, so nothing is given up by expressing them as rsync.
#
# GNU rsync REQUIRED, and this is not pedantry. macOS ships openrsync
# (protocol 29, "rsync 2.6.9 compatible"), which sends `--dirs` as a long
# option that rrsync's allowlist does not carry, so every upload dies with
# "invalid rsync-command syntax or options" and no hint that the CLIENT is
# the problem. Measured on the release machine 2026-08-01.
#
# The iOS lane needs the OPPOSITE rsync, so keep both installed. Xcode's
# IPA-packaging step drives Apple's openrsync and a Homebrew rsync ahead of it
# on PATH kills `-exportArchive` (see tools/release/ios-export.sh, measured
# 2026-08-06). Resolving by absolute path here rather than by PATH is what lets
# the two coexist: ios-export.sh prepends /usr/bin for its own step and this
# script still finds the GNU one.
RSYNC="${XCHAIN_RSYNC:-}"
if [[ -z "$RSYNC" ]]; then
    for candidate in /opt/homebrew/bin/rsync /usr/local/bin/rsync rsync; do
        if command -v "$candidate" >/dev/null 2>&1; then RSYNC="$candidate"; break; fi
    done
fi

if is_remote && "$RSYNC" --version 2>&1 | head -1 | grep -qi openrsync; then
    echo "publish.sh: $RSYNC is openrsync, which cannot talk to a forced-command" >&2
    echo "  rrsync feed: it sends --dirs as a long option that rrsync rejects," >&2
    echo "  and the error names the syntax rather than the client. Install GNU" >&2
    echo "  rsync (brew install rsync) or set XCHAIN_RSYNC to one." >&2
    exit 2
fi

# True if a path exists at the target. Remote: a --list-only read, which
# is what the deploy key is allowed to do.
# NOTE ON REMOTE PATHS: under a forced rrsync command the client's paths
# are relative to the restricted directory, so a remote --target names it
# relatively (`xchain-deploy@host:wallet`), not absolutely. An absolute
# path is rejected by rrsync as an escape attempt, which is the control
# working, not a bug.
#
# "COULD NOT ASK" IS NOT "IS NOT THERE". Probing the path directly and
# reading a non-zero exit as absence conflates a wrong SSH key, a refused
# connection and a dead host with "that file does not exist" - and one of
# this function's two callers is the IMMUTABILITY check, where absence
# means "this tag is free to publish". A key problem would have read as
# permission to overwrite a published release. So the parent is listed
# instead: a failure to list at all is fatal and loud, and only a
# successful listing is allowed to answer the question.
target_exists() {
    local rel="$1" base dir name out
    base="$(target_path)"
    if ! is_remote; then
        [[ -e "${base%/}/$rel" ]]
        return
    fi

    dir="$(dirname "$rel")"
    name="$(basename "$rel")"
    if ! out="$("$RSYNC" --list-only -e ssh "${TARGET%%:*}:${base%/}/${dir}/" 2>&1)"; then
        echo "publish.sh: cannot list ${base%/}/${dir} at $TARGET" >&2
        printf '%s\n' "$out" | sed 's/^/  /' >&2
        echo "  Refusing to continue. This is deliberately fatal rather than" >&2
        echo "  treated as 'not found': the immutability check reads absence as" >&2
        echo "  'this tag is unpublished', so a bad key or an unreachable host" >&2
        echo "  would otherwise look like permission to overwrite a release." >&2
        echo "  If the deploy key is the problem, note that a forced-command" >&2
        echo "  rrsync target needs its own ssh_config Host entry with" >&2
        echo "  IdentityFile + IdentitiesOnly." >&2
        exit 2
    fi
    printf '%s\n' "$out" | awk '{ $1=$2=$3=$4=""; sub(/^ +/, ""); print }' | grep -qxF "$name"
}

# CHECKS RUN CHEAPEST FIRST. They are all pre-upload, so their order is
# free, and the differences are large: this one reads only its own
# arguments, the channel assertion reads a directory listing, verify.sh
# hashes hundreds of megabytes, and the two after it open an SSH
# connection. A missing flag should not cost a full manifest verify, and
# it certainly should not cost a login to the release host.
#
# Edge verification is only meaningful against something an edge fronts.
# A local target has no edge, so it is skipped and said out loud; a remote
# one without --public-base is refused, because the alternative is a
# release that silently keeps the weaker guarantee (§7.3).
if [[ "$EDGE_VERIFY" -eq 1 && -z "$PUBLIC_BASE" ]] && is_remote; then
    echo "publish.sh: --public-base is required for a remote target." >&2
    echo "  Uploading in the right order at the ORIGIN proves nothing about" >&2
    echo "  what the edge serves: Cloudflare can hold a cached 404 for a" >&2
    echo "  binary that has already landed, so a client reads a fresh" >&2
    echo "  pointer and fetches a file the edge says is missing. Pass the" >&2
    echo "  public base (e.g. https://downloads.xchain.io/wallet), or type" >&2
    echo "  --no-edge-verify to publish without that check." >&2
    exit 2
fi

MANIFEST="$INPUT_DIR/RELEASE_HASHES.txt"

# IS THIS A PARTIAL RELEASE?  Read BEFORE the channel assertion,
# because the answer decides which question that assertion can even ask.
#
# `sign.sh --lane` signs one lane's artifacts on their own, and the lanes
# that can be named there are the store lanes - every one of them ships
# without an electron-updater feed, because channel pointers are a desktop
# concern. So a partial release directory legitimately holds NO pointer,
# and the assertion below, which reads the pointers to tell a prod build
# from a rehearsal one, has nothing to read. It refused, and it was right
# to on its own terms: with no pointers it would otherwise wave an empty
# or wrong directory through to the feed.
#
# THE ANSWER IS TAKEN FROM THE SIGNED MANIFEST, NOT FROM A FLAG, and that
# is the same principle sign.sh applies one step upstream: the release
# says what it is, and argv does not get a vote. For these lanes it is
# also STRICTER than what it replaces - a channel pointer is an unsigned
# file sitting in the directory, and `# lanes:` is inside the signature.
#
# Read before the existence check below so the diagnostic can be precise;
# a missing manifest yields an empty string and falls through to it.
COVERAGE_LANES=""
if [[ -f "$MANIFEST" ]]; then
    COVERAGE_LANES="$(sed -n 's/^# lanes: //p' "$MANIFEST" | head -1)"
fi

# THE SYMMETRIC GUARD, and it is the dangerous direction (§7.5, 2026-08-07).
# A scoped rehearsal manifest attests ONE OS's update-capable formats. It is
# a real K1 signature over real bytes from a real tag, so nothing downstream
# can tell it apart from a release manifest by inspection - and a rehearsal
# set is byte-different twins of the production files under identical names,
# which is the hazard §7.5 names. Publishing one to the production feed would
# hand every user a manifest that verifies perfectly and covers a fraction of
# the release. The header says which it is; this refuses on it.
REHEARSAL_OS=""
if [[ -f "$MANIFEST" ]]; then
    REHEARSAL_OS="$(sed -n 's/^# rehearsal-os: //p' "$MANIFEST" | head -1)"
fi

if [[ -n "$REHEARSAL_OS" && "$STAGING" -ne 1 ]]; then
    echo "publish.sh: this is a REHEARSAL manifest, scoped to $REHEARSAL_OS." >&2
    echo "  Refusing to publish it to the production feed." >&2
    echo "  It is a real signature over real bytes, so nothing downstream" >&2
    echo "  could tell it from a release manifest; it just covers one OS's" >&2
    echo "  update-capable formats. Re-run with --staging, or sign a" >&2
    echo "  production set." >&2
    exit 2
fi

if [[ -n "$COVERAGE_LANES" && "$STAGING" -eq 1 ]]; then
    echo "publish.sh: --staging is not available for a partial release." >&2
    echo "  This manifest covers: $COVERAGE_LANES" >&2
    echo "  The staging feed exists to rehearse the DESKTOP update path (§7.5):" >&2
    echo "  publish a pointer, let electron-updater walk it to a binary, and" >&2
    echo "  prove the swap on real hardware. A lane with no channel pointer has" >&2
    echo "  nothing to rehearse there, so this is a mistake worth naming rather" >&2
    echo "  than a no-op to allow." >&2
    exit 2
fi

# WHICH PARTIAL RELEASE IS THIS? Until 2026-08-11 the question did not
# exist, because every lane `sign.sh --lane` could name was a store lane
# and every store lane ships without a channel pointer. So "partial"
# implied "no pointer" and the three waivers below keyed on partiality.
#
# The desktop lanes are nameable now , and a partial release
# covering them carries pointers that real installs will fetch. Keying on
# partiality would waive the pointer assertion and the §7.5 rehearsal for
# exactly the release that most needs both. The lane's own feed column
# answers it instead, read from the committed list and matched against the
# lanes the SIGNED manifest names - so a directory still cannot talk its
# way out of either check by what it does or does not contain.
LANES="$HERE/shipped-lanes.txt"
COVERAGE_HAS_UPDATER=0
if [[ -n "$COVERAGE_LANES" ]]; then
    # Unquoted on purpose: `# lanes:` is a space-separated list and each
    # name is a separate argument. The helper fails SHUT, so a list this
    # cannot read demands the checks rather than waiving them.
    # shellcheck disable=SC2086
    if xr_lanes_have_updater_feed "$LANES" $COVERAGE_LANES; then
        COVERAGE_HAS_UPDATER=1
    fi
fi

# Are these the bytes for the feed we are about to write to? The
# installers cannot answer that (identical names either way), the
# pointers can.
if [[ -n "$COVERAGE_LANES" && "$COVERAGE_HAS_UPDATER" -eq 0 ]]; then
    echo "publish.sh: PARTIAL release - the signed manifest covers lane(s):" \
         "$COVERAGE_LANES" >&2
    echo "  These lanes ship no channel pointer, so the '$EXPECT_CHANNEL' check" >&2
    echo "  is answered by the signed header instead of by the pointers." >&2
else
    if [[ -n "$COVERAGE_LANES" ]]; then
        echo "publish.sh: PARTIAL release covering lane(s) $COVERAGE_LANES," \
             "which update through our own feed - checking the pointers." >&2
    fi
    echo "publish.sh: checking the input is a '$EXPECT_CHANNEL' build ..." >&2
    node "$HERE/update-info.mjs" assert-channel "$INPUT_DIR" --channel "$EXPECT_CHANNEL" >&2
fi

for required in "$MANIFEST" "$MANIFEST.asc"; do
    if [[ ! -f "$required" ]]; then
        echo "publish.sh: $required is missing; sign the release first." >&2
        echo "  Publishing an unsigned or partly-signed release is not a" >&2
        echo "  thing to do by accident, so this refuses rather than warns." >&2
        exit 1
    fi
done

# --- The rehearsal gate (§7.5) ------------------------------------------
#
# Production only. Runs before verify.sh because it costs a small JSON
# read plus one hash of the manifest, while verify.sh hashes every
# artifact: there is no reason to spend minutes proving bytes that are
# not allowed out.
#
# The default location matches `rehearse.mjs run --out`, so the ordinary
# case needs no flag and the flag exists for a maintainer who keeps
# records somewhere else. There is deliberately NO skip switch. The one
# case that legitimately has no swap to show - the very first release,
# where no earlier build exists to update FROM - is handled inside the
# record as `bootstrap`, where it is visible and dated, rather than by a
# command-line flag that would outlive the situation that justified it.
if [[ "$STAGING" -eq 0 ]]; then
    # The §6 record gate goes first: it costs one file read, while the
    # rehearsal gate hashes the manifest and verify.sh hashes every
    # artifact. Refusing early is refusing cheaply.
    #
    # Anchored to THIS checkout, like rollback-rerelease.sh's lookup, so
    # a publish driven from anywhere finds the same records directory.
    # `--release-record` names a record that lives elsewhere; it does not
    # waive one, and there is no flag that does.
    echo "publish.sh: checking the §6 release record ..." >&2
    if [[ -n "$RELEASE_RECORD" ]]; then
        node "$HERE/release-record.mjs" assert --tag "$TAG" --record "$RELEASE_RECORD" >&2
    else
        node "$HERE/release-record.mjs" assert --tag "$TAG" >&2
    fi

    # THE §7.5 REHEARSAL IS A DESKTOP INSTRUMENT, by its own data:
    # rehearsal-matrix.mjs declares eight lanes and every one of them is
    # win/mac/linux. What it proves is that electron-updater walks a
    # published pointer to a binary and swaps it on real hardware. A
    # partial release covering only store lanes contains no such lane, so
    # demanding a rehearsal record of it is demanding evidence about lanes
    # that are not in the release - the same shape as the two checks above,
    # a third time .
    #
    # SAID OUT LOUD RATHER THAN SKIPPED, because the direct APK does have
    # an update path of its own (its `latest.json` feed) and NOTHING
    # rehearses it. Waiving quietly here would turn "we have not built that
    # rehearsal yet" into "this release was rehearsed", which is the exact
    # substitution §7.5 exists to prevent.
    if [[ -n "$COVERAGE_LANES" && "$COVERAGE_HAS_UPDATER" -eq 0 ]]; then
        echo "publish.sh: §7.5 rehearsal NOT REQUIRED for lane(s) $COVERAGE_LANES," \
             "and NOT PERFORMED." >&2
        echo "  The rehearsal matrix declares desktop lanes only, so there is no" >&2
        echo "  lane in this release for it to probe. Note what that leaves" >&2
        echo "  uncovered: the direct APK's own update feed has never been" >&2
        echo "  rehearsed by anything. This release is unrehearsed, not proven." >&2
    else
        if [[ -z "$REHEARSAL_RECORD" ]]; then
            REHEARSAL_RECORD="$(cd "$INPUT_DIR/.." && pwd)/REHEARSAL-$TAG.json"
        fi
        echo "publish.sh: checking the §7.5 rehearsal record ..." >&2
        node "$HERE/rehearse.mjs" assert \
            --record "$REHEARSAL_RECORD" --tag "$TAG" --prod-input "$INPUT_DIR" >&2
    fi
fi

# Verify before uploading, not after. An artifact that fails here has
# cost nothing; one that fails after upload is already reachable.
echo "publish.sh: verifying the signed release before upload ..." >&2
bash "$HERE/verify.sh" --input "$INPUT_DIR" --tag "$TAG" >&2

BASE="$(target_path)"
MANIFEST_REMOTE="$BASE/RELEASE_HASHES/$TAG.txt"

# The other half of the prod/rehearsal guard, and the half that does not
# depend on the input being what it claims. `.staging-feed` is written
# once, by hand, when the staging feed is stood up (DOWNLOADS-HOST-RUNBOOK
# §7); it is a property of the DESTINATION, so a correctly-built staging
# set aimed at the live feed - the actually dangerous typo, since the
# rehearsal happens minutes before the real publish and the two commands
# differ by one word - is refused by the host rather than by a convention.
if target_exists ".staging-feed"; then
    TARGET_IS_STAGING=1
else
    TARGET_IS_STAGING=0
fi

if [[ "$STAGING" -eq 1 && "$TARGET_IS_STAGING" -eq 0 ]]; then
    echo "publish.sh: --staging, but $TARGET carries no .staging-feed marker." >&2
    echo "  This is either the live feed (in which case a rehearsal build was" >&2
    echo "  about to be published to real users, whose installers are named" >&2
    echo "  identically to the real ones) or a staging feed that was stood up" >&2
    echo "  without its marker. Check which before adding the file." >&2
    exit 1
fi
if [[ "$STAGING" -eq 0 && "$TARGET_IS_STAGING" -eq 1 ]]; then
    echo "publish.sh: $TARGET is the STAGING feed (.staging-feed is present)," >&2
    echo "  but this is a production publish. The rehearsal set and the real" >&2
    echo "  release are never mixed in one directory (§7.5): they are" >&2
    echo "  byte-different files under identical names." >&2
    exit 1
fi

# Immutability check.
if target_exists "RELEASE_HASHES/$TAG.txt"; then
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
#
# EXCEPT ON A PARTIAL RELEASE , where "no pointer" is not a
# missing desktop build but the correct shape: the store lanes have no
# electron-updater feed to point into, and their own update path is the
# per-lane one (`latest.json` for the direct APK). The distinction is
# read from the signed manifest, so a directory cannot talk its way out
# of this check by simply lacking a yml - it has to have been SIGNED as
# a partial release, by a run that named its lanes and was gated against
# exactly them.
#
# THE REFUSAL BRANCH BELOW IS UNREACHABLE FOR A FULL RELEASE, and that is
# worth writing down rather than discovering again. `assert-channel`
# earlier in this script already refuses a directory with zero pointers,
# so a full release never gets this far with an empty YMLS. Measured
# 2026-08-06 by disarming this branch and watching the smoke stay green.
# Kept anyway: it is the guard that would still hold if the channel
# assertion were ever narrowed, and its message names the build problem
# where the other names the feed problem. Not counted as coverage.
if [[ ${#YMLS[@]} -eq 0 && -n "$COVERAGE_LANES" && "$COVERAGE_HAS_UPDATER" -eq 0 ]]; then
    echo "publish.sh: no channel pointers, and none is expected: this release" \
         "covers lane(s) $COVERAGE_LANES, which ship no electron-updater feed." >&2
elif [[ ${#YMLS[@]} -eq 0 ]]; then
    echo "publish.sh: no channel pointers in $INPUT_DIR." >&2
    echo "  A release with no update-info yml is invisible to every" >&2
    echo "  installed wallet, permanently, with nothing logged. Check that" >&2
    echo "  the desktop lanes ran and that their *.yml files were collected" >&2
    echo "  into the staging directory ( §7.1)." >&2
    exit 1
fi

# The plan used to print the manifest's artifact count as if every one of
# them landed on the feed. For an Android release that is wrong by half:
# the .aab is refused by name in Phase 1 below, so a plan reading
# "2 artifact(s)" precedes an upload of one. Counting the store-bound
# artifacts here, in the same terms Phase 1 refuses them, keeps the plan
# and the upload describing the same release.
HOSTED_COUNT=0
STORE_BOUND_COUNT=0
for rel in "${BINARIES[@]}"; do
    if [[ "${rel#./}" == *.aab ]]; then
        STORE_BOUND_COUNT=$((STORE_BOUND_COUNT + 1))
    else
        HOSTED_COUNT=$((HOSTED_COUNT + 1))
    fi
done

echo "publish.sh: plan for $TAG -> $TARGET ($EXPECT_CHANNEL)" >&2
if [[ "$STORE_BOUND_COUNT" -gt 0 ]]; then
    echo "  1. ${#BINARIES[@]} artifact(s): $HOSTED_COUNT uploaded," \
         "$STORE_BOUND_COUNT store-bound (.aab, never hosted)" >&2
else
    echo "  1. ${#BINARIES[@]} artifact(s)" >&2
fi
echo "  2. signed manifest as RELEASE_HASHES/$TAG.txt (+ .asc)" >&2
if [[ "$EDGE_VERIFY" -eq 1 && -n "$PUBLIC_BASE" ]]; then
    echo "  3. edge check: every artifact must return 200 via $PUBLIC_BASE" >&2
elif [[ "$EDGE_VERIFY" -eq 0 ]]; then
    echo "  3. edge check SKIPPED (--no-edge-verify)" >&2
else
    echo "  3. edge check skipped: local target, nothing fronts it" >&2
fi
echo "  4. ${#YMLS[@]} channel pointer(s), LAST" >&2
echo "  5. purge the edge cache for those pointer paths" >&2

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "publish.sh: --dry-run, nothing uploaded." >&2
    exit 0
fi

# Percent-encode one path segment.
#
# NOT optional, and not a test artifact. `productName` is "XChain Wallet",
# and the generic provider writes the RAW basename into the update-info
# yml (the space-to-dash `safeArtifactName` substitution in
# app-builder-lib is gated on `provider === "github"`, which we are not).
# So every published desktop artifact has a space in its name, every
# client fetches it as `%20`, and an edge check that pastes the raw name
# into a URL asks curl for a malformed request and fails a release that
# is perfectly fine.
#
# ASCII only, which is what electron-builder's naming produces from
# productName + version + arch. A non-ASCII productName would need a real
# encoder; the smoke pins the names so that change cannot pass unnoticed.
url_encode() {
    local s="$1" out="" i c
    for (( i = 0; i < ${#s}; i++ )); do
        c="${s:i:1}"
        case "$c" in
            [A-Za-z0-9._~-]) out="$out$c" ;;
            *) out="$out$(printf '%%%02X' "'$c")" ;;
        esac
    done
    printf '%s' "$out"
}

copy_to() {
    local src="$1" dest="$2"
    if is_remote; then
        # --mkpath so the tree is created by the same allowed operation
        # that writes into it; a forced-command key cannot run mkdir.
        "$RSYNC" -a --mkpath -e ssh "$src" "${TARGET%%:*}:$dest"
    else
        mkdir -p "$(dirname "$dest")"
        cp -p "$src" "$dest"
    fi
}

# --- Phase 1: artifacts -------------------------------------------------
if ! is_remote; then
    mkdir -p "$BASE/desktop" "$BASE/extension" "$BASE/web" "$BASE/android" "$BASE/RELEASE_HASHES"
fi
for rel in "${BINARIES[@]}"; do
    name="${rel#./}"
    # The .aab is signed, hashed into RELEASE_HASHES and listed in
    # expected-artifacts.txt, and it must still never reach the CDN: it is the
    # bundle Play re-signs and serves, so a public copy is an artifact users
    # cannot install and cannot verify against anything Google served
    # ( §7, and expected-artifacts.txt says NEVER hosted in as many
    # words). Refused BY NAME rather than skipped silently, because "where did
    # my artifact go" is the question a silent skip creates.
    if [[ "$name" == *.aab ]]; then
        echo "publish.sh: NOT uploading $name (store-bound; the .aab goes to Play, never to the CDN)" >&2
        continue
    fi
    case "$name" in
        *.tar.gz) sub="web" ;;
        xchain-wallet-extension-*.zip) sub="extension" ;;
        # Before this line the catch-all filed the Android APK under desktop/,
        # and the edge check below then verified that same wrong path and
        # passed, because it derives the URL the same way it derived the
        # upload. Self-consistent and wrong is the failure mode a catch-all
        # produces: §6 and the download page both say wallet/android/.
        *.apk) sub="android" ;;
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

# --- Phase 2b: prove the edge serves what the origin now holds ----------
#
# Checked through the PUBLIC url, which is the only address a client ever
# uses. Content-Length is compared when the edge returns one: a 200 alone
# would be satisfied by a stale cached copy of a same-named artifact from
# a previous build, which is precisely what a re-cut release produces.
if [[ "$EDGE_VERIFY" -eq 1 && -n "$PUBLIC_BASE" ]]; then
    echo "publish.sh: checking the edge serves ${#BINARIES[@]} artifact(s) ..." >&2
    edge_failures=0
    for rel in "${BINARIES[@]}"; do
        name="${rel#./}"
        # Nothing serves the .aab, so asking the edge for it would fail the
        # release for doing exactly what §7 requires.
        [[ "$name" == *.aab ]] && continue
        case "$name" in
            *.tar.gz) sub="web" ;;
            xchain-wallet-extension-*.zip) sub="extension" ;;
            *.apk) sub="android" ;;
            *) sub="desktop" ;;
        esac

        # --get with -I would drop the body; -I alone is a HEAD, which is
        # what we want: these are hundreds of megabytes and the bytes are
        # already proven by the manifest.
        headers="$(curl -sSIL --max-time 60 "$PUBLIC_BASE/$sub/$(url_encode "$name")" 2>&1)" || {
            echo "  EDGE-FAIL  $sub/$name: request failed" >&2
            edge_failures=$((edge_failures + 1))
            continue
        }
        status="$(printf '%s\n' "$headers" | awk '/^HTTP\//{code=$2} END{print code}')"
        if [[ "$status" != "200" ]]; then
            echo "  EDGE-FAIL  $sub/$name: HTTP $status" >&2
            edge_failures=$((edge_failures + 1))
            continue
        fi

        remote_len="$(printf '%s\n' "$headers" \
            | awk 'BEGIN{IGNORECASE=1} /^content-length:/{gsub(/\r/,"",$2); len=$2} END{print len}')"
        local_len="$(wc -c < "$INPUT_DIR/$name" | tr -d ' ')"
        if [[ -n "$remote_len" && "$remote_len" != "$local_len" ]]; then
            echo "  EDGE-FAIL  $sub/$name: edge serves $remote_len bytes, we uploaded $local_len" >&2
            edge_failures=$((edge_failures + 1))
        fi
    done

    if [[ "$edge_failures" -gt 0 ]]; then
        echo >&2
        echo "publish.sh: $edge_failures artifact(s) are not correctly served." >&2
        echo "  STOPPING BEFORE THE POINTERS, which is the whole point of this" >&2
        echo "  check: the artifacts are uploaded but no yml names them yet, so" >&2
        echo "  no client is looking for them and nothing is broken in the" >&2
        echo "  field. Purge the edge for these paths, or wait out the cached" >&2
        echo "  404, then re-run - phase 1 is idempotent." >&2
        exit 1
    fi
    echo "publish.sh: edge ok" >&2
fi

# --- Phase 3: channel pointers, LAST ------------------------------------
for rel in "${YMLS[@]}"; do
    name="${rel#./}"
    echo "publish.sh: uploading $name (channel pointer, last)" >&2
    copy_to "$INPUT_DIR/$name" "$BASE/desktop/$name"
done

# --- Phase 4: purge the pointers from the edge --------------------------
#
# Belt AND braces on purpose. The cache rule (runbook §2/§3) should keep
# pointers out of the edge cache entirely, but a rule that was typed and
# never re-tested is the failure mode a rollback discovers at the worst
# moment, and a purge costs one request.
#
# THE TOKEN IS FED ON STDIN, NEVER AS AN ARGUMENT. `curl -H "Authorization:
# Bearer $TOKEN"` puts a live credential in the process table, where every
# local user can read it out of `ps` for the life of the call. `--config -`
# takes the same header from stdin.
if [[ ${#YMLS[@]} -gt 0 && -n "${CLOUDFLARE_ZONE_ID:-}" && -n "${CLOUDFLARE_PURGE_TOKEN:-}" ]]; then
    purge_urls=""
    for rel in "${YMLS[@]}"; do
        name="${rel#./}"
        purge_urls="$purge_urls${purge_urls:+,}\"$PUBLIC_BASE/desktop/$(url_encode "$name")\""
    done

    echo "publish.sh: purging ${#YMLS[@]} pointer path(s) from the edge ..." >&2
    purge_response="$(curl -sS --max-time 30 --config - <<EOF
url = "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache"
request = "POST"
header = "Authorization: Bearer $CLOUDFLARE_PURGE_TOKEN"
header = "Content-Type: application/json"
data = "{\"files\": [$purge_urls]}"
EOF
    )" || purge_response=''

    if printf '%s' "$purge_response" | grep -q '"success":[[:space:]]*true'; then
        echo "publish.sh: edge cache purged" >&2
    else
        # Not fatal: the release is published and correct. But it is not
        # silent either, because an unpurged pointer is a fleet that does
        # not see the release until the TTL expires.
        echo "publish.sh: WARNING - the purge did not report success." >&2
        echo "  The release IS published; clients may not see the new pointer" >&2
        echo "  until the edge TTL expires. Purge by hand and confirm." >&2
    fi
elif [[ ${#YMLS[@]} -gt 0 ]]; then
    echo >&2
    echo "publish.sh: NOT purging - CLOUDFLARE_ZONE_ID / CLOUDFLARE_PURGE_TOKEN unset." >&2
    echo "  Purge these paths by hand before treating the release as live:" >&2
    for rel in "${YMLS[@]}"; do
        echo "    ${PUBLIC_BASE:-<public base>}/desktop/${rel#./}" >&2
    done
fi

echo "publish.sh: ok - $TAG is live" >&2
echo >&2
echo "  Not done yet: run the §6 step 7 clean-machine verify against the" >&2
echo "  PUBLISHED manifest, not the local one." >&2
