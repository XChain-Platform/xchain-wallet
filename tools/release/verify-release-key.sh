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

# tools/release/verify-release-key.sh - prove the release signing key
# actually works, by driving the real signing pipeline end to end
# against a throwaway tag and a throwaway artifact set.
#
# Usage:
#     bash tools/release/verify-release-key.sh --key <FINGERPRINT>
#
# Options:
#     --key <fpr>         signing key fingerprint            (required)
#     --gnupghome <dir>   GNUPGHOME holding it   (default: ~/.xchain-release)
#     --keep              leave the scratch dirs behind for inspection
#
# WHY THIS EXISTS RATHER THAN A LIST OF COMMANDS IN THE RUNBOOK.
#
# The GPG key ceremony runbook carried this verification as a block of
# shell to paste, including eight `touch` lines naming a throwaway
# artifact set. That set was correct when it was written and rehearsed
# (2026-07-31) and silently stopped being correct when the artifact
# contract grew: expected-artifacts.txt now declares SIX required
# patterns that each need BOTH an x64 and an arm64 artifact, so the
# eight-file fixture fails the gate with sixteen problems.
#
# That failure lands at the worst possible moment. The operator has just
# finished an offline ceremony, is holding the one key in this project
# that cannot be quietly redone, and gets a wall of artifact-set errors
# that read as "the key does not work" when they mean "the fixture in
# the runbook is out of date". A stale fixture is indistinguishable from
# a broken key to anyone who has not read the gate's source.
#
# So the fixture is DERIVED from expected-artifacts.txt instead of
# copied out of it. A pattern added to that file appears here on the
# next run, with no edit anywhere, and this check cannot rot the way the
# runbook block did. It is the same fix as every other one on this lane:
# the rule was right and the mechanism was narrower than the rule.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTRACT="$SCRIPT_DIR/expected-artifacts.txt"

KEY=""
GNUPGHOME_DIR="$HOME/.xchain-release"
KEEP=0
TAG="v0.0.0-key-verify"

die() { echo "verify-release-key.sh: $*" >&2; exit 1; }

usage() {
    cat <<'USAGE'
verify-release-key.sh - prove the release signing key actually works, by
driving the real signing pipeline end to end against a throwaway tag and a
throwaway artifact set ( key ceremony).

Usage:
  bash tools/release/verify-release-key.sh --key <FINGERPRINT>

Options:
  --key <fpr>         signing key fingerprint            (required)
  --gnupghome <dir>   GNUPGHOME holding it   (default: ~/.xchain-release)
  --keep              leave the scratch dirs behind for inspection
  -h, --help          print this and exit 0

Reads the throwaway artifact set from tools/release/expected-artifacts.txt
rather than carrying its own copy, so a pattern added to the contract is
covered here on the next run with no edit. The runbook's hand-written
fixture went stale exactly once and its failure read as "the key does not
work" to an operator who had just finished an irreversible ceremony.

Exit 0 means the key signed and the signature verified. Anything else names
what failed.
USAGE
}

# `--help` fell into the `*)` arm below and was answered with
#
#   verify-release-key.sh: unknown argument: --help
#
# and exit 1 . This tool is typed by an operator holding the one
# key in the project that cannot be quietly redone, immediately after an
# offline ceremony, and its first answer must not be a refusal.
while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)   usage; exit 0 ;;
        --key)       KEY="${2:-}"; shift 2 ;;
        --gnupghome) GNUPGHOME_DIR="${2:-}"; shift 2 ;;
        --keep)      KEEP=1; shift ;;
        *) die "unknown argument: $1 (try --help)" ;;
    esac
done

[ -n "$KEY" ] || die "--key <fingerprint> is required"
[ -f "$CONTRACT" ] || die "artifact contract not found at $CONTRACT"
command -v gpg >/dev/null 2>&1 || die "gpg not found"

# The key has to be usable for SIGNING, not merely present. A public key
# imports without complaint and cannot sign anything, and the primary of
# this project's release identity is certify-only by design, so "the key
# is there" is not the question worth asking.
GNUPGHOME="$GNUPGHOME_DIR" gpg --list-secret-keys "$KEY" >/dev/null 2>&1 \
    || die "no secret key for $KEY in $GNUPGHOME_DIR. The signing subkey has to be imported there first."

# Short paths on purpose: gpg-agent's socket lives under GNUPGHOME and a
# unix socket path is capped near 104 characters, so a deep scratch
# directory fails with "can't connect to the gpg-agent: File name too
# long" - which reads as a gpg fault rather than a path-length one.
SCRATCH="${TMPDIR:-/tmp}/xc-keyverify-$$"
CLONE="$SCRATCH/repo"
ARTIFACTS="$SCRATCH/artifacts"
cleanup() {
    if [ "$KEEP" -eq 1 ]; then
        # Printed because the runbook's cross-implementation check (section
        # 8 step 6) runs against these two directories, and a scratch path
        # nobody was told is a path nobody can use.
        echo
        echo "kept for inspection (--keep):"
        echo "  clone:     $CLONE"
        echo "  artifacts: $ARTIFACTS"
    else
        rm -rf "$SCRATCH"
    fi
}
trap cleanup EXIT

mkdir -p "$CLONE" "$ARTIFACTS"

echo "==> throwaway clone and tag"
git clone -q "$REPO_ROOT" "$CLONE"
# tag.gpgsign is set globally on this machine and makes a bare `git tag`
# fail with "no tag message?"; forced off here so the check does not
# depend on a global setting it has no opinion about.
git -C "$CLONE" -c tag.gpgsign=false tag "$TAG"
git -C "$CLONE" checkout -q "$TAG"

# Derive from the CLONE's contract, not the working tree's. sign.sh runs
# inside the clone and checks the artifact set against the copy it finds
# there, so deriving from the working tree makes an uncommitted edit to
# expected-artifacts.txt produce files the gate then rejects as
# UNDECLARED - a confusing failure that blames the artifacts rather than
# the disagreement between the two trees. Measured, not theorised: adding
# a pattern to the working-tree copy failed exactly that way. The gate
# tests the committed tree, and so does this.
CONTRACT="$CLONE/tools/release/expected-artifacts.txt"
[ -f "$CONTRACT" ] || die "artifact contract not found in the clone at $CONTRACT"

echo "==> deriving a throwaway artifact set from $(basename "$CONTRACT") (as committed)"

# One file per (required pattern x architecture). Every `*` in the
# pattern is filled, the first with a stem carrying the version and the
# architecture token so the gate can attribute it, the rest with nothing.
# Patterns declaring no architecture ("-") get a single file.
# `|| [ -n "$kind" ]` is load-bearing, not defensive noise: read returns
# non-zero on a final line with no trailing newline and the loop would
# end WITHOUT processing it. expected-artifacts.txt has no trailing
# newline today, so its last line is genuinely at risk. That line is
# currently an `optional` entry this loop skips anyway, which is exactly
# what makes it dangerous - the bug is invisible until someone appends a
# `required` pattern, and then the fixture silently omits it and this
# check passes while covering less than it claims.
made=0
while read -r kind pattern _profile arches || [ -n "${kind:-}" ]; do
    case "${kind:-}" in ''|'#'*) continue ;; esac
    [ "$kind" = "required" ] || continue

    if [ "$arches" = "-" ]; then
        arch_list="none"
    else
        arch_list="$(echo "$arches" | tr ',' ' ')"
    fi

    for arch in $arch_list; do
        if [ "$arch" = "none" ]; then
            stem="0.0.0-key-verify"
        else
            stem="xchain-wallet-0.0.0-key-verify-$arch"
        fi
        name="$pattern"
        name="${name/\*/$stem}"      # first * carries the stem
        name="${name//\*/}"          # any remaining * collapse away
        : > "$ARTIFACTS/$name"
        made=$((made + 1))
    done
done < "$CONTRACT"

[ "$made" -gt 0 ] || die "derived no artifacts from $CONTRACT; the contract format must have changed"
echo "    $made throwaway artifact(s)"

echo "==> signing"
# SIGN_SKIP_DEV_MOCK_CHECK is correct here and only here: this directory
# holds empty placeholder files rather than a real dist tree, which is
# the documented use of that escape hatch. A real release never sets it.
GNUPGHOME="$GNUPGHOME_DIR" \
XCHAIN_RELEASE_GPG_KEY="$KEY" \
SIGN_SKIP_DEV_MOCK_CHECK=1 \
    bash "$CLONE/tools/release/sign.sh" \
        --tag "$TAG" --input "$ARTIFACTS" --repo "$CLONE"

[ -f "$ARTIFACTS/RELEASE_HASHES.txt" ]     || die "sign.sh produced no RELEASE_HASHES.txt"
[ -f "$ARTIFACTS/RELEASE_HASHES.txt.asc" ] || die "sign.sh produced no detached signature"

echo "==> verifying the signature independently of the tool that made it"
GNUPGHOME="$GNUPGHOME_DIR" gpg --verify \
    "$ARTIFACTS/RELEASE_HASHES.txt.asc" "$ARTIFACTS/RELEASE_HASHES.txt" 2>&1 \
    | sed 's/^/    /'

# gpg --verify proves the signature. It says nothing about whether the
# manifest describes these artifacts or anchors to this tag, which is a
# separate failure with the same symptom, so run the real verifier too.
echo "==> verifying the manifest with the shipped verifier"
GNUPGHOME="$GNUPGHOME_DIR" \
    bash "$CLONE/tools/release/verify.sh" --input "$ARTIFACTS" --tag "$TAG" 2>&1 \
    | sed 's/^/    /'

echo
echo "OK: $KEY signed a release manifest, the signature verifies, and the"
echo "    manifest anchors to its tag. Nothing was pushed; no tag left this machine."
echo
echo "STILL OWED, and deliberately not done here: the cross-implementation"
echo "check. The desktop updater verifies with openpgp.js, a DIFFERENT"
echo "implementation from gpg, and a subkey-made signature is exactly the"
echo "kind of thing one can accept and the other reject. That check needs a"
echo "workspace install and the exported public key, so it stays a separate"
echo "deliberate step - see the key ceremony runbook, section 8 step 6."
