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

# tools/release/rollback-rerelease.sh - the Chrome Web Store "rollback"
# recipe (§4), prepared before launch so it is not invented
# mid-incident.
#
# THERE IS NO ROLLBACK. Chrome Web Store item versions strictly increase
# and a previously published version can never be re-served. "Rollback"
# therefore means: take the content of a known-good previous tag and
# re-release it as a NEW, HIGHER version number, through the exact same
# build-tag-sign-publish-review pipeline as any other release. This
# script does not shortcut that pipeline and cannot, because no lever to
# shortcut it exists (see claude/reports/launch/INCIDENT-RUNBOOK.md
# section 14, "Chrome extension: emergency levers", read before reaching
# for this script during an actual incident).
#
# WHAT THIS SCRIPT DOES: validates the preconditions for a rollback
# re-release and prints the exact remaining manual steps. It does NOT
# commit, tag, push, sign, or publish anything, and it does not create a
# worktree or touch the working tree at all - every check below is a
# read-only git query. The consequential actions (bumping the version
# files, committing, tagging, signing with K1, publishing, submitting to
# the Chrome Web Store console) stay exactly where the rest of this
# repo's release tooling keeps them: manual, one operator, reviewed.
#
# WHY THIS IS NOT A FAST LEVER, stated up front so nobody re-derives it
# under pressure: the re-release goes through the SAME Chrome Web Store
# review queue as any other update (spec §4: "expect days, budget two
# weeks" for a new listing; a normal update review is faster but still
# not an emergency-response timescale). If the incident needs a response
# faster than a store review clock allows, use one of the three real
# levers in INCIDENT-RUNBOOK.md section 14 (user-local panic mode,
# platform-side guards at the services the wallet talks to, or an
# expedited-but-still-hours-to-days store publish) while this recipe
# runs in parallel, not instead of them.
#
# Usage:
#   bash tools/release/rollback-rerelease.sh --good-tag v0.330.0 \
#     [--new-version 0.334.0] [--repo <path>]
#
# Options:
#   --good-tag <vX.Y.Z>    the last known-good published release tag to
#                          re-release the CONTENT of (required)
#   --new-version <X.Y.Z>  the version to cut the re-release as. Must be
#                          strictly greater than BOTH the highest version
#                          in the repo's version-bearing files AND the
#                          highest version recorded in
#                          packages/extension/docs/publish-log.md (a store
#                          re-release with a version the store has
#                          already served, or a lower one, is refused by
#                          the store itself, and during a rollback the
#                          checkout is behind the store by construction).
#                          If omitted, this script SUGGESTS that floor's
#                          patch+1 and exits 2 so the operator picks
#                          deliberately rather than accepting a guess
#                          under pressure.
#   --repo <path>          repo root to check (default: this script's repo)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GOOD_TAG=""
NEW_VERSION=""
REPO_ROOT=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --good-tag) GOOD_TAG="$2"; shift 2 ;;
        --new-version) NEW_VERSION="$2"; shift 2 ;;
        --repo) REPO_ROOT="$2"; shift 2 ;;
        --help|-h)
            awk '/^#\*+$/{seen++; next} seen>=2 && /^set -euo pipefail/{exit} seen>=2{print}' "$0"
            exit 0
            ;;
        *)
            echo "rollback-rerelease.sh: unknown argument '$1'" >&2
            exit 2
            ;;
    esac
done

if [[ -z "$REPO_ROOT" ]]; then REPO_ROOT="$(cd "$HERE/../.." && pwd)"; fi
if [[ ! -d "$REPO_ROOT/.git" && ! -f "$REPO_ROOT/.git" ]]; then
    echo "rollback-rerelease.sh: --repo '$REPO_ROOT' is not a git checkout" >&2
    exit 2
fi

if [[ -z "$GOOD_TAG" ]]; then
    echo "rollback-rerelease.sh: --good-tag <vX.Y.Z> is required" >&2
    echo "  Name the last known-good PUBLISHED release tag whose content" >&2
    echo "  should be re-released under a new version number." >&2
    exit 2
fi

echo "rollback-rerelease.sh: rollback-as-re-release recipe" >&2
echo "  This is not a rollback lever. Read the file header before using" >&2
echo "  it in an actual incident." >&2
echo >&2

# --- Precondition 1: the good tag must exist -----------------------------
GOOD_COMMIT=""
if ! GOOD_COMMIT="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "refs/tags/${GOOD_TAG}^{commit}")"; then
    echo "rollback-rerelease.sh: tag '$GOOD_TAG' does not exist in $REPO_ROOT" >&2
    echo "  A rollback re-release starts from a real, previously tagged" >&2
    echo "  release. If the good state was never tagged, there is nothing" >&2
    echo "  this recipe can re-release; find or recreate the right commit" >&2
    echo "  first." >&2
    exit 1
fi
echo "  good tag:    $GOOD_TAG ($GOOD_COMMIT)" >&2

# Soft check: was this tag actually recorded as a published release? Not
# fatal if missing (a tag can predate the record-keeping, or the record
# lives somewhere this script was not told to look), but worth surfacing
# rather than assuming silently.
#
# Anchored to THIS script's checkout, not to --repo. The records live in
# the platform repo one level above the wallet repo, and --repo is
# expected to point at a throwaway clone during a real rollback (step 2
# of the recipe below says to make one), which has no platform repo above
# it. Anchored to --repo, this check would report "NOT found" for every
# tag in exactly the situation it exists to serve.
RELEASE_RECORD="$HERE/../../../claude/reports/wallet-releases/${GOOD_TAG}.md"
if [[ -f "$RELEASE_RECORD" ]]; then
    echo "  release record: found ($RELEASE_RECORD)" >&2
else
    echo "  release record: NOT found at $RELEASE_RECORD" >&2
    echo "    Not fatal, but confirm '$GOOD_TAG' really was a published," >&2
    echo "    reviewed release before re-releasing its content as new." >&2
fi

# --- Precondition 2: derive the current version floor ---------------------
#
# The version-bearing set is the one
# test/smoke/audits/version-lockstep.smoke.js enforces: the root
# package.json, every package under packages/ (membership derived from
# the filesystem, so a package added tomorrow is in scope the moment it
# exists), packages/extension/manifest.json, and
# packages/core/src/buildInfo.js's WALLET_VERSION. test/e2e is
# DELIBERATELY absent: it is a private harness, never published, never
# installed, exempt by that same contract's decision and documented as such in
# README.md.
#
# This was a `find -maxdepth 3 -name package.json` sweep until
# 2026-08-02, which is a second derivation of a rule the repo already
# states, and it disagreed with that rule in both directions. It swept in
# the exempt test/e2e harness, whose version step 3 of the recipe below
# then instructed the operator to bump; and it MISSED
# packages/extension/manifest.json, which for a Chrome Web Store
# re-release is the only version the store ever reads. Bumping every
# package.json and leaving the manifest behind produces a zip that
# re-declares the version the store has already served, which the store
# refuses - mid-incident, on the slow path, after a review clock.
VERSION_FILES=()
CURRENT_MAX="0.0.0"

# The path is passed as an argv entry rather than interpolated into the
# source string: a repo path containing a quote would otherwise change
# what node executes.
read_json_version() {
    node -p "try{require(process.argv[1]).version||''}catch(e){''}" "$1" 2>/dev/null || true
}

add_version_file() {
    local rel="$1" abs="$REPO_ROOT/$1" v
    [[ -f "$abs" ]] || return 0
    v="$(read_json_version "$abs")"
    if [[ -z "$v" ]]; then
        echo "  WARNING: could not read a version from $rel (missing field or invalid JSON)." >&2
        echo "    Fix it before trusting the 'highest version' figure below." >&2
        return 0
    fi
    VERSION_FILES+=("$rel=$v")
}

add_version_file "package.json"
if [[ -d "$REPO_ROOT/packages" ]]; then
    while IFS= read -r pkgdir; do
        add_version_file "packages/$(basename "$pkgdir")/package.json"
    done < <(find "$REPO_ROOT/packages" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort)
else
    echo "  WARNING: $REPO_ROOT/packages does not exist; the version floor below covers" >&2
    echo "    almost nothing. Confirm --repo points at a wallet checkout." >&2
fi
add_version_file "packages/extension/manifest.json"

BUILDINFO="$REPO_ROOT/packages/core/src/buildInfo.js"
if [[ -f "$BUILDINFO" ]]; then
    BI_VERSION="$(sed -n "s/^export const WALLET_VERSION = '\([^']*\)';/\1/p" "$BUILDINFO" | head -1)"
    [[ -n "$BI_VERSION" ]] && VERSION_FILES+=("packages/core/src/buildInfo.js (WALLET_VERSION)=$BI_VERSION")
fi

semver_gt() {
    # True if $1 > $2, comparing up to 3 dot-separated numeric segments.
    local a="$1" b="$2"
    IFS='.' read -r a1 a2 a3 <<< "$a"
    IFS='.' read -r b1 b2 b3 <<< "$b"
    a1=${a1:-0} a2=${a2:-0} a3=${a3:-0} b1=${b1:-0} b2=${b2:-0} b3=${b3:-0}
    if [[ "$a1" -ne "$b1" ]]; then [[ "$a1" -gt "$b1" ]]; return $?; fi
    if [[ "$a2" -ne "$b2" ]]; then [[ "$a2" -gt "$b2" ]]; return $?; fi
    [[ "$a3" -gt "$b3" ]]
}

echo >&2
echo "  version-bearing files found (${#VERSION_FILES[@]}):" >&2
for entry in "${VERSION_FILES[@]:-}"; do
    [[ -z "$entry" ]] && continue
    v="${entry##*=}"
    echo "    $entry" >&2
    if semver_gt "$v" "$CURRENT_MAX"; then CURRENT_MAX="$v"; fi
done
echo "  highest version currently in the repo: $CURRENT_MAX" >&2

# --- Precondition 3: the floor the STORE enforces -------------------------
#
# The repo's floor is not the store's floor, and this script's own recipe
# is what drives them apart: step 2 below tells the operator to check out
# $GOOD_TAG in a throwaway clone, and every version file in THAT clone
# reads the good tag's version - by definition lower than the bad version
# the store already served. A floor computed from the repo alone would
# then approve precisely the version the store refuses.
#
# packages/extension/docs/publish-log.md is the record of what has
# actually been published. It is read here through the same
# parsePublishLog the rogue-publish monitor uses (stage S13 hardened that
# parser against the real file and gated its shape) rather than through a
# second regex that could disagree with it.
PUBLISH_LOG="$REPO_ROOT/packages/extension/docs/publish-log.md"
MONITOR="$HERE/store-version-monitor.mjs"
STORE_MAX=""
LOGGED_VERSIONS=""

echo >&2
if [[ ! -f "$MONITOR" ]]; then
    echo "  published versions: COULD NOT TELL - $MONITOR is missing, so the" >&2
    echo "    publish log could not be parsed. The floor below is the repo's only." >&2
elif [[ ! -f "$PUBLISH_LOG" ]]; then
    echo "  published versions: COULD NOT TELL - $PUBLISH_LOG is missing, so" >&2
    echo "    there is no record of what the store has served. The floor below is" >&2
    echo "    the repo's only." >&2
else
    # Both paths travel by environment rather than as arguments, for two
    # reasons that are easy to undo by accident. The monitor decides
    # whether it was invoked directly by comparing import.meta.url against
    # realpath(process.argv[1]), so handing it its OWN path as an argument
    # makes a plain import run the whole monitor and exit 2. And its first
    # line is `if (!process.argv[1]) return false`, so an empty argv is
    # unambiguously an import.
    #
    # The reply is prefixed with a sentinel because "the parse returned no
    # rows" and "the parse did not happen" are different answers that look
    # identical as an empty string, and the second one silently reporting
    # as the first is the failure mode this whole file is being careful
    # about.
    PARSED="$(XC_MONITOR="$MONITOR" XC_PUBLISH_LOG="$PUBLISH_LOG" node --input-type=module -e '
        import { readFileSync } from "node:fs";
        import { pathToFileURL } from "node:url";
        const { parsePublishLog } = await import(pathToFileURL(process.env.XC_MONITOR).href);
        const rows = parsePublishLog(readFileSync(process.env.XC_PUBLISH_LOG, "utf8"));
        process.stdout.write(`ROWS ${rows.map((r) => r.version).join(" ")}`);
    ' 2>&1 || true)"

    if [[ "$PARSED" != ROWS* ]]; then
        echo "  published versions: COULD NOT TELL - parsing $PUBLISH_LOG failed." >&2
        echo "    This is NOT an all-clear: the floor below is the repo's only, and" >&2
        echo "    during a rollback the repo is behind the store by construction." >&2
        echo "    Node said: ${PARSED:-(nothing)}" >&2
        LOGGED_VERSIONS=""
        PARSE_OK=0
    else
        LOGGED_VERSIONS="${PARSED#ROWS}"
        LOGGED_VERSIONS="${LOGGED_VERSIONS# }"
        PARSE_OK=1
    fi

    if [[ "$PARSE_OK" == "0" ]]; then
        : # already reported above
    elif [[ -z "$LOGGED_VERSIONS" ]]; then
        # Legitimately true before the first publish. Said out loud rather
        # than passed over, because "no rows" and "could not read the rows"
        # look identical in silence, and after the first publish this state
        # is itself the rogue-publish signal spec §2 describes.
        echo "  published versions: NONE logged in packages/extension/docs/publish-log.md." >&2
        echo "    Before the first publish that is correct. After it, an empty log" >&2
        echo "    means either the log was not appended to (spec §6 requires it in the" >&2
        echo "    same step as the upload) or something published without going through" >&2
        echo "    the logged process at all. Confirm which before continuing." >&2
    else
        for v in $LOGGED_VERSIONS; do
            if [[ -z "$STORE_MAX" ]] || semver_gt "$v" "$STORE_MAX"; then STORE_MAX="$v"; fi
        done
        echo "  published versions (publish-log.md): $LOGGED_VERSIONS" >&2
        echo "  highest version the store has been given: $STORE_MAX" >&2
    fi
fi

# The floor is whichever is higher. They are the same number on a healthy
# repo and they are not during a rollback, which is the only time anybody
# runs this script.
FLOOR="$CURRENT_MAX"
FLOOR_SOURCE="the repo"
if [[ -n "$STORE_MAX" ]] && semver_gt "$STORE_MAX" "$FLOOR"; then
    FLOOR="$STORE_MAX"
    FLOOR_SOURCE="publish-log.md (the store is AHEAD of this checkout)"
fi
echo "  floor to beat: $FLOOR, from $FLOOR_SOURCE" >&2

if [[ -z "$NEW_VERSION" ]]; then
    IFS='.' read -r cm1 cm2 cm3 <<< "$FLOOR"
    SUGGESTED="${cm1:-0}.${cm2:-0}.$(( ${cm3:-0} + 1 ))"
    echo >&2
    echo "rollback-rerelease.sh: --new-version was not given." >&2
    echo "  Suggested (floor patch+1): $SUGGESTED" >&2
    echo "  Pass --new-version explicitly and deliberately; this script" >&2
    echo "  will not pick one for you, even the suggestion above." >&2
    exit 2
fi

if ! semver_gt "$NEW_VERSION" "$FLOOR"; then
    echo >&2
    echo "rollback-rerelease.sh: --new-version $NEW_VERSION is not greater" >&2
    echo "  than the floor ($FLOOR, from $FLOOR_SOURCE)." >&2
    echo "  The Chrome Web Store refuses a version it has already served," >&2
    echo "  or anything lower. Pick a version strictly above $FLOOR." >&2
    exit 1
fi
echo "  new version:  $NEW_VERSION (> $FLOOR, ok)" >&2

# --- What a straight re-release of $GOOD_TAG would drop --------------------
#
# Re-releasing $GOOD_TAG's CONTENT means every commit between it and HEAD
# is absent from what ships, unless explicitly cherry-picked. This is the
# single most important thing to see before choosing this recipe over a
# forward hotfix, so it is shown, not just implied by the word "rollback".
echo >&2
DROPPED_COUNT="$(git -C "$REPO_ROOT" rev-list --count "${GOOD_TAG}..HEAD" 2>/dev/null || echo '?')"
echo "  commits between $GOOD_TAG and HEAD that a straight re-release" >&2
echo "  would NOT include ($DROPPED_COUNT total):" >&2
git -C "$REPO_ROOT" log --oneline "${GOOD_TAG}..HEAD" 2>/dev/null | sed 's/^/    /' >&2 || true
echo >&2
echo "  file-level scope of what would be reverted:" >&2
git -C "$REPO_ROOT" diff --stat "${GOOD_TAG}" HEAD -- packages/extension 2>/dev/null | sed 's/^/    /' >&2 || true

# --- The recipe -------------------------------------------------------------
cat >&2 <<EOF

--------------------------------------------------------------------------
Remaining steps (manual, one release operator, same pipeline as any other
release - claim the release in the ledger before touching anything):

  1. Review the dropped-commits list above. If any of them fixed the
     exact problem this rollback is responding to, re-releasing $GOOD_TAG
     unmodified REINTRODUCES that problem. Cherry-pick the fix onto the
     rollback branch, or reconsider a forward hotfix instead of a
     rollback re-release.
  2. From a throwaway clone (never the shared worktree), check out
     $GOOD_TAG on a new branch.
  3. Bump every version-bearing file listed above to $NEW_VERSION,
     in the same commit, per the synchronized-versioning rule
     (CONTRIBUTING.md). That list is exactly what
     test/smoke/audits/version-lockstep.smoke.js enforces, so bump those
     files and no others: test/e2e carries its own version by decision
     and must NOT be dragged along. Note that
     packages/extension/manifest.json is in the list and is the only one
     of them the Chrome Web Store ever reads - leave it behind and step 6
     uploads a zip re-declaring a version the store has already served,
     which it refuses. Note that manifest.json's version is DERIVED from
     the wallet version rather than copied
     (packages/core/scripts/derive-extension-version.js: a stable M.m.p
     maps to itself, but a prerelease M.m.p-rc.N maps to 0.M.m.N, because
     Chrome forbids prerelease suffixes). Cut a rollback re-release as a
     STABLE version and the two are the same string. If you ever need an
     RC here, stop: measured 2026-08-02, the manifest audit's
     version-matches-wallet rule and version-lockstep.smoke.js demand
     DIFFERENT values for a prerelease root and both run in
     pnpm test:smoke, so the suite cannot pass until that is resolved
     (that contract's ground, not this script's). Add a CHANGELOG.md entry that
     says plainly this is a rollback re-release of $GOOD_TAG, not new work.
  4. Run the manual QA checklist in full against the bumped build
     (https://docs.xchain.io/components/wallet/release/qa-checklist), including
     the "Chrome Web Store release provenance" section.
  5. Commit, tag v$NEW_VERSION (GPG-signed, per the tag-signing gate in
     .github/workflows/release.yml), and push the tag. This is a normal
     release from here: tools/release/README.md "Per-release procedure"
     steps 1-6 apply unchanged (release:gate, CI build, sign, verify,
     publish, deploy-web).
  6. Submit the resulting xchain-wallet-extension-v$NEW_VERSION.zip to
     the Chrome Web Store console as a normal update, per
     claude/specs/wallet-publishing-chrome-extension.md §4. It goes
     through the SAME review queue as any other release. Record the
     submission in packages/extension/docs/publish-log.md (this step's
     sha256 check is in the QA checklist section above) and any reviewer
     exchange in the operator's store-correspondence log, which is kept
     outside this repo.
  7. Once live, run tools/release/verify-store.sh against the
     store-served item.

This whole sequence is the SLOW path. If the incident needs a response
before a store review clock can possibly deliver one, use
claude/reports/launch/INCIDENT-RUNBOOK.md section 14 in parallel.
--------------------------------------------------------------------------
EOF

echo "rollback-rerelease.sh: preconditions ok; recipe printed above." >&2
