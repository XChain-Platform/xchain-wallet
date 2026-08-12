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

# tools/release/prepare-resign-tag.sh - cut a tag a release can be
# re-signed from, and PROVE it before handing it over.
#
# Usage:
#   bash tools/release/prepare-resign-tag.sh --tag v0.336.0 \
#       --work-dir ~/xchain-resign/v0.336.0 \
#       --input ~/xchain-release-artifacts/0.336.0/
#
# Options:
#   --tag, -t <vX.Y.Z>    the published release tag being re-signed
#   --work-dir, -w <dir>  where to make the throwaway clone. Must not
#                         already hold a checkout; NEVER the shared
#                         worktree.
#   --input, -i <dir>     the staged artifacts the re-signature will
#                         cover. Optional, and passing it is the
#                         difference between a tag that is claimed to
#                         work and one that has been watched working.
#   --resign-tag <name>   override the derived name. Must carry the
#                         release's own X.Y.Z core.
#   --sign-tag            sign the new tag with the tag-signing key,
#                         which prompts for its passphrase. Off by
#                         default so the tool never pauses for a secret;
#                         the summary prints the one command that re-cuts
#                         it signed afterwards.
#   --source-ref <ref>    which committed tree the corrected tooling is
#                         taken from (default HEAD). Always a COMMITTED
#                         ref: an uncommitted fix cannot be tagged, and
#                         a tag built from a dirty worktree describes a
#                         tree nobody else can obtain.
#
# WHY A NEW TAG IS THE ONLY WAY TO CORRECT A SIGNED MANIFEST, because
# it looks like bookkeeping until you try it.
#
# `sign.sh` reads TWO trees. The scripts come from whichever checkout
# invokes it; `check-no-dev-mock.sh`, `shipped-lanes.txt` and
# `expected-artifacts.txt` come from `--repo`, which is the pristine
# clone at the release tag. So a defect fixed in the gate CANNOT reach a
# release already tagged. `https://downloads.xchain.io/wallet/RELEASE_HASHES/v0.336.0.txt`
# is the only signed manifest this project has published, it says
# `# dev-mock-gate: enforced`, and that gate read zero bytes: the tag's
# copy predates `--artifacts`, so it ignored the flag, scanned a pristine
# clone's absent `dist/` trees, printed three SKIP lines and `OK`, and
# exited 0. `packages/desktop/main/updateVerify.js` refuses any release
# whose header is not exactly that word, so the field is load-bearing.
#
# `sign.sh` now refuses that combination (it requires the gate's own
# receipt, `OK - N bundle(s) scanned`), which stops it recurring and does
# nothing for the record already published. Correcting THAT needs a tag
# whose own gate can read the staged artifacts. This script cuts it, and
# the only difference from the release tag is the release tooling.
#
# WHAT THIS SCRIPT WILL NOT DO, deliberately:
#   * It never pushes. Nothing here leaves the machine.
#   * It never signs, and needs no key: K1's passphrase belongs at a
#     pinentry in front of a person, which is the whole worth of that
#     signature (`dq-9`).
#   * It never touches the checkout it is run from. Everything happens
#     in the throwaway clone named by --work-dir.
#
# Exit codes:
#   0  the tag was cut and proved
#   1  refused (see the message; nothing was left behind)
#   2  caller error
#   3  nothing to prepare - the release tag's OWN gate already takes
#      --artifacts, so sign from the release tag itself
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_REPO="$(cd "$HERE/../.." && pwd)"
GATE_PATH="tools/build-reproduce/check-no-dev-mock.sh"

TAG=""
WORK_DIR=""
INPUT_DIR=""
RESIGN_TAG=""
SOURCE_REF="HEAD"
SIGN_TAG=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tag|-t) TAG="$2"; shift 2 ;;
        --sign-tag) SIGN_TAG=1; shift ;;
        --work-dir|-w) WORK_DIR="$2"; shift 2 ;;
        --input|-i) INPUT_DIR="$2"; shift 2 ;;
        --resign-tag) RESIGN_TAG="$2"; shift 2 ;;
        --source-ref) SOURCE_REF="$2"; shift 2 ;;
        --help|-h)
            awk '/^#\*+$/{seen++; next} seen>=2 && /^set -euo pipefail/{exit} seen>=2{print}' "$0"
            exit 0
            ;;
        *)
            echo "prepare-resign-tag.sh: unknown argument '$1'" >&2
            exit 2
            ;;
    esac
done

[[ -n "$TAG" ]] || { echo "prepare-resign-tag.sh: --tag <vX.Y.Z> is required" >&2; exit 2; }
[[ -n "$WORK_DIR" ]] || {
    echo "prepare-resign-tag.sh: --work-dir <dir> is required." >&2
    echo "  The tag is cut in a throwaway clone, never in the checkout you are" >&2
    echo "  standing in: this repo is worked by more than one session at once." >&2
    exit 2
}
if [[ -n "$INPUT_DIR" && ! -d "$INPUT_DIR" ]]; then
    echo "prepare-resign-tag.sh: --input '$INPUT_DIR' does not exist" >&2
    exit 2
fi
command -v git >/dev/null 2>&1 || { echo "prepare-resign-tag.sh: git not found in PATH" >&2; exit 2; }

if ! git -C "$SOURCE_REPO" rev-parse --git-dir >/dev/null 2>&1; then
    echo "prepare-resign-tag.sh: $SOURCE_REPO is not a git checkout" >&2
    exit 2
fi

TAG_COMMIT=""
if ! TAG_COMMIT="$(git -C "$SOURCE_REPO" rev-parse --verify --quiet "refs/tags/$TAG^{commit}")"; then
    echo "prepare-resign-tag.sh: tag '$TAG' does not exist in $SOURCE_REPO" >&2
    echo "  This tool re-signs a release that was tagged; it does not make one." >&2
    exit 1
fi

# --- Is the corrected gate really corrected? ----------------------------
#
# ASKED OF THE BYTES, never of the file on disk and never of a grep. The
# tag will carry whatever is committed at --source-ref, so that is what is
# probed; a fix sitting uncommitted in the worktree is invisible here on
# purpose, because it would be invisible to a clone too. And the question
# is behavioural: a gate that MENTIONS `--artifacts` in a comment passes a
# grep, which is the shape of proof that produced the record this whole
# exercise exists to correct.
PROBE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/xchain-resign-probe.XXXXXX")"
trap 'rm -rf "$PROBE_DIR"' EXIT

# A staged bundle a gate can ONLY see through --artifacts: one file
# carrying the real-SDK literal, packed as the web tarball, in a
# directory of its own. Run from an empty cwd, so a gate that ignores
# the flag has nothing else to find.
mkdir -p "$PROBE_DIR/stage" "$PROBE_DIR/bundle" "$PROBE_DIR/empty"
printf 'throw new Error("CONTRACT_LINT_FAILED");\n' > "$PROBE_DIR/bundle/app.js"
tar czf "$PROBE_DIR/stage/xchain-wallet-web-v0.0.0-probe.tar.gz" \
    -C "$PROBE_DIR/bundle" . 2>/dev/null

takes_artifacts() {
    # Args: <path to a gate script>. True if it can really read a staged
    # bundle, measured by the RECEIPT sign.sh requires rather than by an
    # error message or a grep of the source.
    #
    # An error message would not do it. The gate that shipped with
    # v0.336.0 has no argument parsing at all, so it does not reject
    # `--artifacts` - it IGNORES it, scans the repo's `dist/` trees, and
    # says OK. That silence is the entire defect: on a pristine clone
    # there are no dist/ trees, so the answer was "OK" for a run that read
    # zero bytes, and `dev-mock-gate: enforced` went into the signed
    # header on the strength of it. A probe that asks "did it complain?"
    # would call that gate healthy, which is how this got published.
    local gate="$1" out=""
    out="$( cd "$PROBE_DIR/empty" && bash "$gate" --artifacts "$PROBE_DIR/stage" 2>&1 || true )"
    printf '%s\n' "$out" | grep -qE '^OK - [1-9][0-9]* bundle\(s\) scanned'
}

if ! git -C "$SOURCE_REPO" cat-file -e "$SOURCE_REF:$GATE_PATH" 2>/dev/null; then
    echo "prepare-resign-tag.sh: $SOURCE_REF carries no $GATE_PATH" >&2
    exit 1
fi
FIXED_GATE="$PROBE_DIR/fixed-gate.sh"
git -C "$SOURCE_REPO" show "$SOURCE_REF:$GATE_PATH" > "$FIXED_GATE"
if ! takes_artifacts "$FIXED_GATE"; then
    echo "prepare-resign-tag.sh: the gate at $SOURCE_REF cannot read a staged bundle." >&2
    echo "  Driven, not read: $GATE_PATH from that tree was pointed at a staging" >&2
    echo "  directory holding one bundle and never reported reading it. A tag" >&2
    echo "  carrying it would re-create the defect this tool exists to correct -" >&2
    echo "  the gate scans the pristine clone's absent dist/ trees and reports OK" >&2
    echo "  having read nothing." >&2
    echo "  Fix: point --source-ref at a COMMITTED tree whose gate takes the flag." >&2
    exit 1
fi

# Nothing to do is a real answer and gets its own exit code. If the release
# tag's own gate already takes the flag, a re-sign tag adds a commit the
# release did not have and weakens the provenance claim for nothing.
TAG_GATE="$PROBE_DIR/tag-gate.sh"
if git -C "$SOURCE_REPO" cat-file -e "refs/tags/$TAG:$GATE_PATH" 2>/dev/null; then
    git -C "$SOURCE_REPO" show "refs/tags/$TAG:$GATE_PATH" > "$TAG_GATE"
    if takes_artifacts "$TAG_GATE"; then
        echo "prepare-resign-tag.sh: $TAG's OWN $GATE_PATH already reads staged bundles." >&2
        echo "  Nothing to prepare. Sign from a pristine clone at $TAG itself:" >&2
        echo "    bash tools/release/sign.sh --tag $TAG --repo <clone at $TAG> --input <staged>" >&2
        exit 3
    fi
fi

# --- The re-sign tag's NAME ---------------------------------------------
#
# `sign.sh` checks every staged artifact's filename against the X.Y.Z core
# of the tag it is signing, so a re-sign tag has to keep the release's own
# core or nothing it produces can be signed at all. `v0.336.0-resign1`
# does; `v0.336.1` and `resign-v0.336.0` do not, in opposite ways - the
# first silently claims a version that was never built, the second carries
# no version the gate can read.
TAG_VERSION="$(printf '%s' "${TAG#v}" | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' || true)"
if [[ -z "$TAG_VERSION" ]]; then
    echo "prepare-resign-tag.sh: --tag '$TAG' carries no X.Y.Z version." >&2
    exit 2
fi

if [[ -z "$RESIGN_TAG" ]]; then
    n=1
    while git -C "$SOURCE_REPO" rev-parse --verify --quiet "refs/tags/${TAG}-resign${n}" >/dev/null; do
        n=$((n + 1))
    done
    RESIGN_TAG="${TAG}-resign${n}"
fi

RESIGN_VERSION="$(printf '%s' "${RESIGN_TAG#v}" | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' || true)"
if [[ "$RESIGN_VERSION" != "$TAG_VERSION" ]]; then
    echo "prepare-resign-tag.sh: '$RESIGN_TAG' does not carry $TAG's version ($TAG_VERSION)." >&2
    echo "  sign.sh compares every staged filename against the tag's X.Y.Z core," >&2
    echo "  so a manifest signed under this name could not cover the artifacts it" >&2
    echo "  is about. Name it ${TAG}-resign<N>." >&2
    exit 1
fi
if [[ "$(printf '%s' "$RESIGN_TAG" | sed -E 's/-resign[0-9]+$//')" != "$TAG" ]]; then
    echo "prepare-resign-tag.sh: '$RESIGN_TAG' is not a re-sign name for $TAG." >&2
    echo "  verify.sh anchors a re-signature to its release by stripping" >&2
    echo "  '-resign<N>' (xr_release_tag_of), and feed-sweep.mjs reads the same" >&2
    echo "  rule. A name outside it cannot be republished under $TAG's own" >&2
    echo "  filename, which is where every existing link points." >&2
    exit 1
fi
if git -C "$SOURCE_REPO" rev-parse --verify --quiet "refs/tags/$RESIGN_TAG" >/dev/null; then
    echo "prepare-resign-tag.sh: tag '$RESIGN_TAG' already exists in $SOURCE_REPO." >&2
    echo "  Pick the next number rather than moving a tag somebody may hold." >&2
    exit 1
fi

# --- The throwaway clone ------------------------------------------------
if [[ -e "$WORK_DIR" ]]; then
    if [[ -e "$WORK_DIR/.git" ]] || [[ -n "$(ls -A "$WORK_DIR" 2>/dev/null || true)" ]]; then
        echo "prepare-resign-tag.sh: --work-dir '$WORK_DIR' is not empty." >&2
        echo "  Refusing to work in it. Name a directory that does not exist yet;" >&2
        echo "  a signing tree has to be one nobody else is standing in." >&2
        exit 1
    fi
fi
mkdir -p "$WORK_DIR"
WORK_DIR="$(cd "$WORK_DIR" && pwd)"

echo "prepare-resign-tag.sh: cloning $SOURCE_REPO at $TAG into $WORK_DIR ..." >&2
git clone --quiet --no-hardlinks "$SOURCE_REPO" "$WORK_DIR"
git -C "$WORK_DIR" checkout --quiet --detach "refs/tags/$TAG"

GATE_BLOB="$(git -C "$SOURCE_REPO" rev-parse "$SOURCE_REF:$GATE_PATH")"
SOURCE_COMMIT="$(git -C "$SOURCE_REPO" rev-parse "$SOURCE_REF^{commit}")"
cp "$FIXED_GATE" "$WORK_DIR/$GATE_PATH"
chmod +x "$WORK_DIR/$GATE_PATH"

if [[ -z "$(git -C "$WORK_DIR" status --porcelain)" ]]; then
    echo "prepare-resign-tag.sh: $TAG already carries this exact gate; nothing to change." >&2
    rm -rf "$WORK_DIR"
    exit 3
fi

# ONE FILE, and the commit says so. The re-sign tag's worth is that it is
# the release's tree with the release TOOLING corrected: anything else in
# the diff and the manifest would be attesting artifacts to a tree that
# could not have built them.
CHANGED="$(git -C "$WORK_DIR" status --porcelain)"
if [[ "$(printf '%s\n' "$CHANGED" | wc -l | tr -d ' ')" != "1" ]] \
    || [[ "$CHANGED" != *"$GATE_PATH" ]]; then
    echo "prepare-resign-tag.sh: the clone changed more than $GATE_PATH:" >&2
    printf '%s\n' "$CHANGED" | sed 's/^/    /' >&2
    rm -rf "$WORK_DIR"
    exit 1
fi

git -C "$WORK_DIR" add -- "$GATE_PATH"
git -C "$WORK_DIR" commit --quiet -m "release: re-sign tag for $TAG with a dev-mock gate that runs

$TAG's own $GATE_PATH predates --artifacts, so a signing run points it at
the staged artifacts and it silently scans the pristine clone's absent
dist/ trees instead - reporting OK having read nothing, on the strength of
which sign.sh wrote 'dev-mock-gate: enforced' into the published manifest.

This commit carries $TAG's tree with that one script replaced by the copy
committed at $SOURCE_COMMIT (blob $GATE_BLOB). Nothing else differs, so the
artifacts this tag re-signs are the artifacts $TAG built.

Cut by tools/release/prepare-resign-tag.sh; not pushed, not signed." -- "$GATE_PATH"

# ANNOTATED AND UNSIGNED, and both halves are deliberate.
#
# Annotated, because every release tag in this repo is (`git cat-file tag
# v0.336.0`), and because a tag correcting a signed record should carry
# its own account of why it exists rather than being a bare pointer.
#
# Unsigned by default, because signing it needs the tag-signing key's
# passphrase at a pinentry, and a tool that pauses for a secret cannot be
# driven by a test or run unattended - the same reason this script never
# reaches for K1. `--sign-tag` asks for it explicitly; without it the
# summary below tells the operator how to re-cut the tag signed, in one
# command.
#
# `-c tag.gpgsign=false` is not belt-and-braces either: this operator's
# GLOBAL config sets `tag.gpgsign=true`, which turns `git tag <name>` into
# a signed annotated tag and fails the run with "no tag message?" before
# any of this was explicit. Measured, not guessed.
TAG_MESSAGE="XChain Wallet $TAG, re-sign tag $RESIGN_TAG

Re-signs $TAG ($TAG_COMMIT). Same tree, with
$GATE_PATH replaced by the copy committed
at $SOURCE_COMMIT so that the gate a signing run reads out of THIS tree
can actually open the staged artifacts.

The artifacts this tag attests are $TAG's artifacts; no source, build
input or shipped byte differs between the two trees."

if [[ "$SIGN_TAG" -eq 1 ]]; then
    TAG_KEY=""
    if [[ -r "$HERE/tag-signing-fingerprint.txt" ]]; then
        TAG_KEY="$(grep -oE '[0-9A-Fa-f]{40}' "$HERE/tag-signing-fingerprint.txt" | head -1 || true)"
    fi
    if [[ -n "$TAG_KEY" ]]; then
        git -C "$WORK_DIR" -c "user.signingkey=$TAG_KEY" tag -s -m "$TAG_MESSAGE" "$RESIGN_TAG"
    else
        git -C "$WORK_DIR" tag -s -m "$TAG_MESSAGE" "$RESIGN_TAG"
    fi
else
    git -C "$WORK_DIR" -c tag.gpgsign=false tag -a -m "$TAG_MESSAGE" "$RESIGN_TAG"
fi
RESIGN_COMMIT="$(git -C "$WORK_DIR" rev-parse "refs/tags/$RESIGN_TAG^{commit}")"

# --- Prove it -----------------------------------------------------------
#
# The tag is worth nothing until its OWN gate has been watched reading the
# staged bytes, because that is exactly the check the published record
# failed: a gate was invoked, exited 0, and had read nothing. What is
# required here is the same receipt sign.sh requires, from the same tree
# sign.sh will read it from.
PROVED=0
if [[ -n "$INPUT_DIR" ]]; then
    INPUT_ABS="$(cd "$INPUT_DIR" && pwd)"
    echo "prepare-resign-tag.sh: running $RESIGN_TAG's own gate against $INPUT_ABS ..." >&2
    GATE_OUT=""
    if ! GATE_OUT="$( cd "$WORK_DIR" && bash "$WORK_DIR/$GATE_PATH" --artifacts "$INPUT_ABS" 2>&1 )"; then
        printf '%s\n' "$GATE_OUT" >&2
        echo "prepare-resign-tag.sh: the new tag's gate FAILED on these artifacts." >&2
        echo "  The tag is not the problem - it ran. Read the gate's output above:" >&2
        echo "  either a bundle really carries the dev-mock SDK, or the staging" >&2
        echo "  directory holds something this gate cannot open." >&2
        git -C "$WORK_DIR" tag -d "$RESIGN_TAG" >/dev/null 2>&1 || true
        exit 1
    fi
    printf '%s\n' "$GATE_OUT" >&2
    if ! printf '%s\n' "$GATE_OUT" | grep -qE '^OK - [1-9][0-9]* bundle\(s\) scanned'; then
        echo "prepare-resign-tag.sh: the gate exited 0 without saying it read anything." >&2
        echo "  That is the state this tag exists to end, so the tag is being" >&2
        echo "  deleted rather than handed over: sign.sh would refuse it anyway." >&2
        git -C "$WORK_DIR" tag -d "$RESIGN_TAG" >/dev/null 2>&1 || true
        exit 1
    fi
    PROVED=1
fi

echo >&2
echo "prepare-resign-tag.sh: $RESIGN_TAG is ready in $WORK_DIR" >&2
echo "  commit:      $RESIGN_COMMIT" >&2
echo "  re-signs:    $TAG ($TAG_COMMIT)" >&2
echo "  gate from:   $SOURCE_REF ($SOURCE_COMMIT)" >&2
if [[ "$PROVED" -eq 1 ]]; then
    echo "  gate proved: yes - it opened the staged artifacts and said how many" >&2
else
    echo "  gate proved: NO. Re-run with --input <staged artifacts> before signing;" >&2
    echo "               an unproved tag is the same claim the published manifest" >&2
    echo "               already makes." >&2
fi
echo >&2
echo "Next, and every step of it is yours rather than this script's:" >&2
echo "  1. Sign, with K1's passphrase at a pinentry in front of you:" >&2
echo "       XCHAIN_RELEASE_GPG_KEY=<K1 fingerprint> \\" >&2
echo "         bash tools/release/sign.sh --tag $RESIGN_TAG \\" >&2
echo "           --repo $WORK_DIR --lane <lane> --input <staged artifacts>" >&2
echo "     (run sign.sh from a CURRENT checkout; --repo is what supplies the" >&2
echo "      gate, and that is the whole point of this tag)" >&2
echo "  2. Republish the manifest under the RELEASE's name, not this tag's:" >&2
echo "       RELEASE_HASHES/$TAG.txt (+ .asc)" >&2
echo "     verify.sh anchors '$RESIGN_TAG' to '$TAG' and says out loud that it" >&2
echo "     supersedes what was published there. Every existing link keeps working." >&2
echo "  3. Push $RESIGN_TAG so a verifier can obtain the tree it names." >&2
echo "     This script did not push it." >&2
if [[ "$SIGN_TAG" -ne 1 ]]; then
    echo >&2
    echo "The tag is annotated and UNSIGNED. Every release tag in this repo is" >&2
    echo "signed with the tag-signing key; re-cut this one the same way before" >&2
    echo "pushing it, either by re-running with --sign-tag or with:" >&2
    echo "    git -C $WORK_DIR tag -s -f $RESIGN_TAG -m '<the message above>'" >&2
fi
