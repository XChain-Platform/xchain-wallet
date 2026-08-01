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
# recipe ( §4), prepared before launch so it is not invented
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
#                          strictly greater than every version currently
#                          in the repo's version-bearing files (a store
#                          re-release with a version the store has
#                          already served, or a lower one, is refused by
#                          the store itself). If omitted, this script
#                          SUGGESTS good-tag's patch+1 and exits 2 so the
#                          operator picks deliberately rather than
#                          accepting a guess under pressure.
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
RELEASE_RECORD="$REPO_ROOT/../claude/reports/wallet-releases/${GOOD_TAG}.md"
if [[ -f "$RELEASE_RECORD" ]]; then
    echo "  release record: found ($RELEASE_RECORD)" >&2
else
    echo "  release record: NOT found at $RELEASE_RECORD" >&2
    echo "    Not fatal, but confirm '$GOOD_TAG' really was a published," >&2
    echo "    reviewed release before re-releasing its content as new." >&2
fi

# --- Precondition 2: derive the current version floor ---------------------
#
# Every version-bearing file, found by content rather than a hardcoded
# list, so this stays accurate as packages are added or removed. The new
# version must exceed the highest one found: the store refuses a version
# it has already served or anything lower, and the synchronized-
# versioning rule means every one of these should already agree, but a
# rollback re-release is exactly the kind of change that must not
# silently trust that they do.
VERSION_FILES=()
CURRENT_MAX="0.0.0"
while IFS= read -r pkg; do
    v="$(node -p "try{require('$pkg').version||''}catch(e){''}" 2>/dev/null || true)"
    if [[ -z "$v" ]]; then
        echo "  WARNING: could not read a version from $pkg (missing field or invalid JSON)." >&2
        echo "    Fix it before trusting the 'highest version' figure below." >&2
        continue
    fi
    VERSION_FILES+=("$pkg=$v")
done < <(find "$REPO_ROOT" -maxdepth 3 -name package.json \
    -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.claude/*' | LC_ALL=C sort)

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

if [[ -z "$NEW_VERSION" ]]; then
    IFS='.' read -r cm1 cm2 cm3 <<< "$CURRENT_MAX"
    SUGGESTED="${cm1:-0}.${cm2:-0}.$(( ${cm3:-0} + 1 ))"
    echo >&2
    echo "rollback-rerelease.sh: --new-version was not given." >&2
    echo "  Suggested (current max patch+1): $SUGGESTED" >&2
    echo "  Pass --new-version explicitly and deliberately; this script" >&2
    echo "  will not pick one for you, even the suggestion above." >&2
    exit 2
fi

if ! semver_gt "$NEW_VERSION" "$CURRENT_MAX"; then
    echo >&2
    echo "rollback-rerelease.sh: --new-version $NEW_VERSION is not greater" >&2
    echo "  than the current max ($CURRENT_MAX)." >&2
    echo "  The Chrome Web Store refuses a version it has already served," >&2
    echo "  or anything lower. Pick a version strictly above $CURRENT_MAX." >&2
    exit 1
fi
echo "  new version:  $NEW_VERSION (> $CURRENT_MAX, ok)" >&2

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
     (CONTRIBUTING.md). Add a CHANGELOG.md entry that says plainly this
     is a rollback re-release of $GOOD_TAG, not new work.
  4. Run docs/QA_Checklist.md in full against the bumped build, including
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
     exchange in packages/extension/docs/store-correspondence.md.
  7. Once live, run tools/release/verify-store.sh against the
     store-served item.

This whole sequence is the SLOW path. If the incident needs a response
before a store review clock can possibly deliver one, use
claude/reports/launch/INCIDENT-RUNBOOK.md section 14 in parallel.
--------------------------------------------------------------------------
EOF

echo "rollback-rerelease.sh: preconditions ok; recipe printed above." >&2
