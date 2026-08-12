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

# tools/release/sign.sh - release-signing pipeline (G003 / §51,  §6).
#
# Computes a SHA-256 manifest over every artifact in the input
# directory, then GPG-signs the manifest with the release key.
# Outputs:
#   <input-dir>/RELEASE_HASHES.txt       - header + sha256sum-format manifest
#   <input-dir>/RELEASE_HASHES.txt.asc   - detached GPG signature
#
# Usage:
#   XCHAIN_RELEASE_GPG_KEY=<fingerprint> \
#     bash tools/release/sign.sh --tag vX.Y.Z --input release-artifacts/vX.Y.Z/
#
# Options:
#   --input, -i <dir>   directory holding the staged artifacts
#   --tag,   -t <tag>   the release tag the manifest describes
#   --repo,  -r <dir>   the checkout to verify the tag against
#   --lane,  -l <name>  sign a PARTIAL release covering only this lane.
#                       Repeatable, and comma-separated names are accepted.
#                       Lane names come from tools/release/shipped-lanes.txt
#                       in the tree given to --repo, which is the TAG's
#                       copy rather than this checkout's . The
#                       roster is PRINTED at the end of this help instead
#                       of listed here: a hand-copied list is how
#                       `extension` stayed missing from this text for
#                       two stages after its lane row landed, while the
#                       Chrome ceremony's only signing path is
#                       `--lane extension`.
#   --os <name>         rehearse ONE OS (linux|mac|windows). --staging only.
#   --passphrase-file <path>
#                       read K1's passphrase from <path> instead of a
#                       pinentry. Takes a PATH and never a value. On a
#                       PRODUCTION run it additionally requires
#                       --unattended (operator ruling `dq-9` and its
#                       same-day amendment, 2026-08-10).
#   --unattended        permit an unattended PRODUCTION signature. Must be
#                       typed by every run that wants one, so the
#                       affordance is never inherited from a copied
#                       staging command or an env default. The manifest
#                       then declares `# signing: unattended` in the bytes
#                       K1 signs over, because what this gives up is that
#                       a person chose to make the signature, and a reader
#                       weighing it is entitled to know. Refused without
#                       --passphrase-file (it would authorise nothing) and
#                       refused with --staging (a rehearsal already reads
#                       a file).
#   --force, -f         overwrite an existing manifest
#
# PARTIAL RELEASES, and why the flag is narrower than it looks. Without
# --lane a manifest must cover a whole release: the artifact-set gate
# demands the web tarball, the extension zip and both architectures of
# six desktop artifacts, and that is the correct default, because a
# manifest missing a lane verifies perfectly while describing a release
# nobody built. But a lane whose artifacts ARE ready must not have to
# wait for lanes that are not - the Android ceremony produces a signed
# AAB and APK on a machine that builds no desktop artifact at all, and
# before this flag existed the ceremony's own closing instruction (run
# sign.sh) could not be followed .
#
# --lane resolves to the globs that lane claims in shipped-lanes.txt, and
# inside that scope the gate is STRICTER rather than weaker: every one of
# the lane's artifacts is required even where the release list calls it
# optional, and an artifact belonging to any other lane is undeclared.
# The signed manifest records `coverage: partial` and the lane names, so
# verify.sh, an operator and the desktop updater all know what it does
# not attest.
#
#   bash tools/release/sign.sh --tag v0.336.0 --lane android \
#       --input ~/xchain-release-artifacts/0.336.0/
#
# Environment:
#   XCHAIN_RELEASE_GPG_KEY   GPG key fingerprint or email (required)
#   XCHAIN_RELEASE_TAG       Default --tag value (optional)
#   XCHAIN_RELEASE_DIR       Default --input value (optional)
#   XCHAIN_RELEASE_REPO      Default --repo value (optional)
#   XCHAIN_RELEASE_LANES     Default --lane value, comma-separated (optional)
#   GNUPGHOME                Override GPG home (optional)
#
# Status: HALF OF G180 IS DONE as of 2026-08-06. The release GPG key
# EXISTS and signs (K1, fingerprint in SECURITY.md), so this script can
# produce a real signed manifest today given XCHAIN_RELEASE_GPG_KEY.
# What G180 still covers is publication reaching a reader: the two
# channels and the desktop pin are written but not yet deployed, so a
# user cannot look the key up. Everything ahead of the signature - the
# pristine-clone checks, the dev-mock gate, the artifact-set gate, the
# manifest header - has run since the beginning.
#
# WHAT THIS SCRIPT IS FOR, so the gates below are not mistaken for
# ceremony: the maintainer's signature is the trust root for artifacts
# nobody else signs. The Chrome Web Store, Apple and Google re-sign
# their own surfaces, but the web tarball and the Linux desktop build
# carry nothing except this manifest. Whatever bytes reach the `gpg`
# call at the bottom of this file become, to a verifying user, "what
# the maintainer built from tag vX.Y.Z". Each gate below closes one way
# for that claim to be false while the manifest still verifies.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/release/lib.sh
source "$HERE/lib.sh"

INPUT_DIR=""
REPO_ROOT=""
TAG=""
FORCE=0
# Which artifact set this run is signing ( §7.5, ). Default
# `release`, so an invocation that says nothing signs a production set
# exactly as it always has.
RELEASE_SET=release
STAGING_OS=""
LANE_NAMES=()

# Where K1's passphrase is read from (operator ruling `dq-9`, 2026-08-10).
# Empty means a pinentry. It was a rehearsal-only affordance on that
# original ruling - a rehearsal only a human can start happens as often as
# a human remembers, and §7.5 has been caught five times shipping a step
# nothing ever ran - and the operator AMENDED it the same day to allow a
# production run to use one behind `--unattended`.
PASSPHRASE_FILE=""

# Whether this run may sign a PRODUCTION manifest without a human at the
# pinentry (the dq-9 amendment). Off unless typed, on every run: the whole
# value of the flag is that it cannot be inherited.
UNATTENDED=0

# Split one --lane value on commas so `--lane android,ios` and two flags
# mean the same thing. Empty words are dropped rather than becoming an
# unnamed lane, which xr_lane_scope would then have to refuse by accident.
add_lanes() {
    local raw="$1" word
    for word in $(printf '%s' "$raw" | tr ',' ' '); do
        [[ -n "$word" ]] && LANE_NAMES+=("$word")
    done
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --input|-i)
            INPUT_DIR="$2"
            shift 2
            ;;
        --lane|-l)
            add_lanes "$2"
            shift 2
            ;;
        --tag|-t)
            TAG="$2"
            shift 2
            ;;
        --repo|-r)
            REPO_ROOT="$2"
            shift 2
            ;;
        --force|-f)
            FORCE=1
            shift
            ;;
        # §7.5 rehearsal set . Spelled `--staging` to match
        # publish.sh's flag of the same name, so the two halves of the
        # rehearsal read the same way on the command line.
        --staging)
            RELEASE_SET=staging
            shift
            ;;
        # Which OS this rehearsal covers (§7.5, operator answer
        # 2026-08-07). Only meaningful with --staging, and refused
        # elsewhere rather than ignored - see the check below.
        --os)
            STAGING_OS="$2"
            shift 2
            ;;
        # K1's passphrase source (`dq-9`). Takes a PATH and never a value,
        # so the passphrase cannot reach a process listing, a shell history
        # or this script's own output.
        --passphrase-file)
            PASSPHRASE_FILE="$2"
            shift 2
            ;;
        # Permit an unattended PRODUCTION signature (the dq-9 amendment,
        # 2026-08-10). Deliberately takes no value: an authorisation that
        # can be spelled `--unattended=0` is one somebody will spell wrong.
        --unattended)
            UNATTENDED=1
            shift
            ;;
        --help|-h)
            # The usage block: everything between the license header's
            # closing rule and the first line of code. Bounded by content,
            # not by line numbers - those drifted and printed the licence.
            awk '/^#\*+$/{seen++; next} seen>=2 && /^set -euo pipefail/{exit} seen>=2{print}' "$0"
            # The lane roster is DERIVED here, at print time, from the
            # same file --lane validates against - one source, read twice,
            # rather than a list this comment block keeps a copy of. What
            # is shown is THIS checkout's copy; at signing time the
            # authoritative one is the tree passed to --repo, and the two
            # differ exactly when a lane row landed after the tag was cut.
            help_lanes="$(cd "$(dirname "$0")" && pwd)/shipped-lanes.txt"
            if [[ -r "$help_lanes" ]]; then
                echo "#"
                echo "# Lane names declared in this checkout's shipped-lanes.txt:"
                awk '!/^#/ && NF { printf "#   %-10s %s\n", $1, $2 }' "$help_lanes"
            fi
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

if [[ ${#LANE_NAMES[@]} -eq 0 && -n "${XCHAIN_RELEASE_LANES:-}" ]]; then
    add_lanes "$XCHAIN_RELEASE_LANES"
fi

if [[ -z "$TAG" ]]; then
    TAG="${XCHAIN_RELEASE_TAG:-}"
fi
if [[ -z "$TAG" ]]; then
    cat >&2 <<'EOF'
sign.sh: --tag <vX.Y.Z> or XCHAIN_RELEASE_TAG is required.

The manifest embeds the tag it describes so a signed manifest cannot
float between versions: without it, a manifest lifted from one release
and served as another verifies perfectly (see  §6). Pass the
release tag exactly as it exists in git.
EOF
    exit 2
fi

if [[ -z "$REPO_ROOT" ]]; then
    REPO_ROOT="${XCHAIN_RELEASE_REPO:-$(cd "$HERE/../.." && pwd)}"
fi
if [[ ! -d "$REPO_ROOT/.git" && ! -f "$REPO_ROOT/.git" ]]; then
    echo "sign.sh: --repo '$REPO_ROOT' is not a git checkout" >&2
    exit 2
fi

if [[ -z "${XCHAIN_RELEASE_GPG_KEY:-}" ]]; then
    cat >&2 <<'EOF'
sign.sh: XCHAIN_RELEASE_GPG_KEY is not set.

This says nothing about whether a key exists - only that this run was
not told which one to use. K1 was generated on 2026-08-05 and its
fingerprint is published in SECURITY.md; see G180 in
claude/reports/xchain-wallet/SPEC_GAPS.md for what remains of that gate
(publication reaching readers, which is a deploy rather than a key).

Path forward:
  1. Point GNUPGHOME at the keystore holding the release key
     (the release machine keeps it outside ~/.gnupg on purpose).
  2. Re-run with `XCHAIN_RELEASE_GPG_KEY=<fingerprint>`, taking the
     fingerprint from SECURITY.md rather than from memory.
  3. If you are standing up a NEW key instead, the ceremony runbook is
     the entry point; do not generate one ad hoc here.

To compute the unsigned manifest only (no signing), run:
  bash tools/release/verify.sh --input "$INPUT_DIR" --recompute
EOF
    exit 1
fi

if ! command -v gpg >/dev/null 2>&1; then
    echo "sign.sh: gpg not found in PATH" >&2
    exit 2
fi
if ! command -v git >/dev/null 2>&1; then
    echo "sign.sh: git not found in PATH" >&2
    exit 2
fi

# --- Pristine-clone gate ( §6) ------------------------------------
#
# The tag must exist, HEAD must be sitting on it, and the worktree must
# be clean. This is not defensive programming: `~/Sites` is shared with a
# second coder over NFS and a neighbour's uncommitted edits have compiled
# into a wallet build there before. A release signed out of that tree
# carries their work-in-progress under the maintainer's signature, and
# nothing downstream can tell.

TAG_COMMIT=""
if ! TAG_COMMIT="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "refs/tags/$TAG^{commit}")"; then
    echo "sign.sh: tag '$TAG' does not exist in $REPO_ROOT" >&2
    echo "  Sign from a fresh clone checked out AT the release tag." >&2
    exit 1
fi

HEAD_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
if [[ "$HEAD_COMMIT" != "$TAG_COMMIT" ]]; then
    echo "sign.sh: $REPO_ROOT is not checked out at $TAG." >&2
    echo "  HEAD:      $HEAD_COMMIT" >&2
    echo "  $TAG:      $TAG_COMMIT" >&2
    echo "  Sign from a fresh clone checked out at the release tag." >&2
    exit 1
fi

DIRT="$(git -C "$REPO_ROOT" status --porcelain)"
if [[ -n "$DIRT" ]]; then
    echo "sign.sh: $REPO_ROOT has uncommitted changes; refusing to sign." >&2
    printf '%s\n' "$DIRT" | sed 's/^/    /' >&2
    echo "  Build and sign from a throwaway clone, never the shared worktree." >&2
    exit 1
fi

# --- Dev-mock gate ------------------------------------------------------
#
# Refuse to sign if a shell bundle leaked the dev-mock SDK fallback
# (fabricated addresses, cannot sign or broadcast). A missing check
# script is a HARD failure, not a warning: "the gate could not run" and
# "the gate passed" must never produce the same release. The old warning
# path meant a rename or a bad checkout silently downgraded signing to
# unchecked.
DEV_MOCK_CHECK="$REPO_ROOT/tools/build-reproduce/check-no-dev-mock.sh"
DEV_MOCK_GATE_TREE="release"
# The same rehearsal exception the artifact list takes further down, for the
# same reason and under the same operator answer (`dq7`, 2026-08-07): a
# rehearsal exercises the CURRENT tooling against the LAST release's bytes.
#
# It is needed here as well as there, and that is not an expansion of the
# answer but the whole of it: a staging run that got its artifact list from
# the tools and its dev-mock gate from the tag still cannot be signed,
# because a tag predating `--artifacts` reports OK having read nothing and
# the receipt check below refuses it - correctly. Measured in that exact
# order against `v0.336.0` before this was written.
#
# `enforced` stays honest under this, which is the property that matters:
# the receipt check is untouched, so the word is written only if a gate
# really opened staged bundles and said how many. What changes is WHICH
# copy of the gate gets the chance to read them, and only for `--staging`.
if [[ "$RELEASE_SET" == "staging" ]]; then
    DEV_MOCK_GATE_TREE="tool"
    DEV_MOCK_CHECK="$(cd "$HERE/../.." && pwd)/tools/build-reproduce/check-no-dev-mock.sh"
fi
DEV_MOCK_STATE="enforced"
if [[ "${SIGN_SKIP_DEV_MOCK_CHECK:-0}" == "1" ]]; then
    # The escape hatch survives for artifact sets with no dist tree (a
    # docs tarball), but it no longer leaves the release indistinguishable
    # from a gated one: the state lands in the SIGNED header, so anyone
    # verifying can see the gate was off. Release runs never set it (§6
    # step 4).
    echo "sign.sh: SIGN_SKIP_DEV_MOCK_CHECK=1 - dev-mock gate SKIPPED." >&2
    echo "  This is recorded in the signed manifest header." >&2
    DEV_MOCK_STATE="SKIPPED"
elif [[ ! -f "$DEV_MOCK_CHECK" ]]; then
    echo "sign.sh: dev-mock gate script not found: $DEV_MOCK_CHECK" >&2
    echo "  Refusing to sign. A gate that cannot run has not passed." >&2
    exit 1
else
    # THE GATE IS POINTED AT THE ARTIFACTS, NOT AT THE REPO ( S33).
    #
    # It used to run bare, which scans the repo's dist/ trees. Signing is
    # documented to happen from a pristine clone checked out at the tag -
    # this script refuses a dirty or non-tag tree, so that is not optional -
    # and a pristine clone has no dist/. Every target therefore printed
    # `SKIP ... (not built)`, the gate exited 0 having scanned nothing, and
    # the `enforced` below was written into the SIGNED manifest header on
    # the strength of it. That is the exact failure the comment eight lines
    # above forbids, arriving through an empty scan instead of a missing
    # script, and the desktop updater refuses any release whose header is
    # not exactly `enforced` - so that one word carries real weight.
    #
    # $INPUT_DIR holds the shipped bytes, which is a better subject than a
    # local rebuild would have been anyway: it is what Phase 4 of every
    # store ceremony is about (the uploaded artifact is the CI-built one).
    # The gate now refuses a scan that covers nothing, so reaching the line
    # after this one means at least one shipped bundle was really read.
    #
    # EXCEPT THAT IT IS NOT THIS SCRIPT'S GATE ( S38). This file comes
    # from whichever checkout invoked it; $DEV_MOCK_CHECK comes from --repo,
    # which is the tree at the release tag. Those are routinely different
    # trees, deliberately: --repo exists so a current sign.sh can sign an
    # older tag's artifacts, and that is how the only signed manifest this
    # project has published was made (v0.336.0, --lane android, by a sign.sh
    # that tag does not contain).
    #
    # So the empty-scan refusal above is a property of the TAG's copy of the
    # gate, and every tag cut before it was written carries a copy that does
    # not take --artifacts at all. Driven against v0.336.0: the flag is
    # ignored, the pristine clone's absent dist/ trees are scanned instead,
    # three SKIP lines and `OK` come back, exit 0 - and `enforced` goes into
    # the SIGNED header on a scan that read zero bytes. That is the exact
    # defect the empty-scan refusal was built to end, arriving from the one
    # direction it cannot see, and the desktop updater refuses any release
    # whose header is not exactly `enforced`, so the word carries weight.
    #
    # Requiring the gate's RECEIPT rather than its exit status is what closes
    # it, and the receipt is derived rather than a proxy: only a gate that
    # really opened staged bundles can say how many it opened. Grepping the
    # gate script for `--artifacts` would pass on a comment mentioning it.
    echo "sign.sh: running pre-sign dev-mock gate against $INPUT_DIR ..." >&2
    # Named on every run, not only on a refusal: which of the two trees the
    # gate came from is the single fact this whole section turns on, and a
    # signing log that does not say it leaves a reader inferring it.
    echo "  gate ($DEV_MOCK_GATE_TREE tree): $DEV_MOCK_CHECK" >&2
    DEV_MOCK_INPUT="$(cd "$INPUT_DIR" && pwd)"
    DEV_MOCK_OUT=""
    if ! DEV_MOCK_OUT="$( cd "$REPO_ROOT" && bash "$DEV_MOCK_CHECK" --artifacts "$DEV_MOCK_INPUT" 2>&1 )"; then
        printf '%s\n' "$DEV_MOCK_OUT" >&2
        echo "sign.sh: pre-sign dev-mock gate FAILED. Refusing to sign." >&2
        exit 1
    fi
    printf '%s\n' "$DEV_MOCK_OUT" >&2

    if ! printf '%s\n' "$DEV_MOCK_OUT" | grep -qE '^OK - [1-9][0-9]* bundle\(s\) scanned'; then
        echo "sign.sh: the dev-mock gate exited 0 without saying it read anything." >&2
        echo "  Gate script: $DEV_MOCK_CHECK" >&2
        echo "  That script comes from --repo ($REPO_ROOT), the tree at $TAG," >&2
        echo "  while this sign.sh comes from the checkout you invoked. A gate" >&2
        echo "  predating --artifacts ignores the flag, scans the pristine" >&2
        echo "  clone's absent dist/ trees, and reports OK having read nothing." >&2
        echo "  Refusing to sign: 'the gate could not run' and 'the gate passed'" >&2
        echo "  must never produce the same release, and this header is what" >&2
        echo "  the desktop updater reads as proof the gate ran." >&2
        echo "  Fix: sign a tag whose own tools/build-reproduce/check-no-dev-mock.sh" >&2
        echo "  takes --artifacts, or set SIGN_SKIP_DEV_MOCK_CHECK=1 deliberately," >&2
        echo "  which records SKIPPED in the header instead of claiming enforced." >&2
        exit 1
    fi
fi

# --- Tag/artifact version gate ( S33) -----------------------------
#
# This script's own reason for embedding the tag, stated in its --tag
# diagnostic, is "so a signed manifest cannot float between versions:
# without it, a manifest lifted from one release and served as another
# verifies perfectly". Every gate below then checks the artifact SET - how
# many, which arches, which lanes, which profile, whether they are signed -
# and not one of them checks that those artifacts are the version the tag
# names. The anchor was asserted and derived from nothing.
#
# It is reachable by accident rather than by attack, which is why it
# matters. `pnpm release:sign` builds both --tag and --input out of the
# local package.json, so on a checkout whose package.json is behind the
# staged release (this repo is worked by several sessions at once, and one
# was 55 commits behind while a v0.336.0 set sat staged) the documented
# command signs a v0.335.0 manifest over v0.336.0 bytes. Every gate passes,
# the signature is good, and verify.sh anchors the manifest to the wrong
# tag - which the store ceremonies then read as artifact provenance.
#
# Channel pointers carry no version in their name and are skipped; they are
# excluded from the manifest entirely (lib.sh).
# Compared on the NUMERIC CORE (X.Y.Z) rather than the whole string: a
# prerelease tag (v0.336.0-rc1) is legitimate and its artifacts carry the
# same core, and this gate is about a release signing ANOTHER release's
# bytes, not about prerelease spelling.
TAG_VERSION="$(printf '%s' "${TAG#v}" | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' || true)"
if [[ -z "$TAG_VERSION" ]]; then
    echo "sign.sh: --tag '$TAG' carries no X.Y.Z version to check the artifacts against." >&2
    exit 2
fi
VERSION_MISMATCH=""
while IFS= read -r artifact; do
    name="$(basename "$artifact")"
    versions="$(printf '%s' "$name" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
    [[ -z "$versions" ]] && continue
    if ! printf '%s\n' "$versions" | grep -qxF "$TAG_VERSION"; then
        VERSION_MISMATCH+="    $name"$'\n'
    fi
done < <(find "$INPUT_DIR" -maxdepth 1 -type f | sort)

if [[ -n "$VERSION_MISMATCH" ]]; then
    echo "sign.sh: --tag $TAG does not match the staged artifacts." >&2
    echo "  Expected every versioned filename to carry $TAG_VERSION. These do not:" >&2
    printf '%s' "$VERSION_MISMATCH" >&2
    echo "  Refusing to sign. A manifest naming one version over another" >&2
    echo "  version's bytes verifies perfectly and is wrong in the one way" >&2
    echo "  the embedded tag exists to prevent." >&2
    exit 1
fi

# THE CHECK ABOVE READS THE NAME, AND A NAME IS CHOSEN BY WHOEVER STAGED THE
# FILE ( S46). Driven rather than argued: the real CI-built
# xchain-wallet-extension-v0.336.0.zip from release run 31072271075, copied to
# xchain-wallet-extension-v0.337.0.zip, passes every gate above and every gate
# below and is hashed into the manifest. One `cp` defeats the guard whose own
# message says it exists to stop a manifest naming one version over another
# version's bytes.
#
# That matters most for the extension, which is why this check is scoped to it
# rather than pretended to be general. The zip's manifest.json version is not
# our bookkeeping: it is the version the Chrome Web Store itself reads,
# displays and enforces monotonically, and it is what the store-version
# monitor compares the publish log against. A stale zip signed and uploaded
# under a new tag therefore produces a live store version no publish-log row
# matches, which is the rogue-publish signal, raised by the release that was
# supposed to be legitimate.
#
# The other lanes are NOT covered here and the limit is stated rather than
# dressed up: the mobile artifacts have their own verifiers
# (verify-android-manifest.mjs, verify-ios-artifact.mjs) which read their
# internal version pairs, and the desktop and web bundles declare no internal
# version this script can read without unpacking an installer format per OS.
INTERNAL_MISMATCH=""
while IFS= read -r artifact; do
    name="$(basename "$artifact")"
    case "$name" in xchain-wallet-extension-v*.zip) ;; *) continue ;; esac
    # No node_modules in a pristine clone (row 50), so this stays dependency
    # free: unzip to stdout, and a regex over the one field.
    inner="$(unzip -p "$artifact" manifest.json 2>/dev/null \
        | grep -oE '"version"[[:space:]]*:[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"' \
        | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
    if [[ -z "$inner" ]]; then
        INTERNAL_MISMATCH+="    $name: no readable manifest.json version inside the zip"$'\n'
    elif [[ "$inner" != "$TAG_VERSION" ]]; then
        INTERNAL_MISMATCH+="    $name: manifest.json says $inner, the tag says $TAG_VERSION"$'\n'
    fi
done < <(find "$INPUT_DIR" -maxdepth 1 -type f | sort)

if [[ -n "$INTERNAL_MISMATCH" ]]; then
    echo "sign.sh: a staged extension zip does not CONTAIN the version its name claims." >&2
    printf '%s' "$INTERNAL_MISMATCH" >&2
    echo "  Refusing to sign. The filename check above passes on a renamed copy;" >&2
    echo "  this one reads the manifest.json the Chrome Web Store itself reads." >&2
    echo "  Stage the zip built by the release run for THIS tag rather than" >&2
    echo "  renaming one you already had." >&2
    exit 1
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

# --- Which copy of an executable gate runs  ---------------------
#
# A CHECK THE RELEASE PREDATES USED TO CRASH THE CEREMONY, and the crash
# was a node stack trace rather than a refusal.
#
# `verify-signatures.mjs` and `launch-probe.mjs` are resolved from
# $REPO_ROOT, the tree at the tag. Driven 2026-08-12 while preparing the
# v0.336.0 re-sign: every gate passed - dev-mock, artifact set, arches,
# lanes, signatures - and then `node` died with MODULE_NOT_FOUND, because
# `launch-probe.mjs` landed after that tag was cut. So the current signing
# path cannot sign ANY tag older than its newest check, and it says so in
# a language nobody reading a ceremony runbook can act on.
#
# The rule below distinguishes DATA from CODE, which the two-tree design
# had never had to. `expected-artifacts.txt` and `shipped-lanes.txt` stay
# tag-side unconditionally: they are what that release DECLARED it ships,
# and a newer list could excuse a lane the tag never built. A probe is not
# a declaration - it opens the staged bytes and reports what it found - so
# where a release predates one, the alternative to running this checkout's
# copy is running NO check at all, and this file's own doctrine is that a
# gate which could not run has not passed. The tag's copy still WINS
# wherever it exists, so no release that carries a check is ever judged by
# a different one, and the fallback is announced rather than silent.
#
# The dev-mock gate is deliberately NOT given this fallback: it is the one
# gate whose answer is a word in the signed header, and requiring the
# TAG's copy to produce that word is what  S38 closed. A tag that
# cannot run it is refused, and `prepare-resign-tag.sh` exists to cut one
# that can.
TOOL_ROOT_FOR_GATES="$(cd "$HERE/../.." && pwd)"
gate_script() {
    local rel="$1"
    if [[ -f "$REPO_ROOT/$rel" ]]; then
        printf '%s' "$REPO_ROOT/$rel"
        return 0
    fi
    if [[ -f "$TOOL_ROOT_FOR_GATES/$rel" ]]; then
        echo "sign.sh: $TAG predates $rel - running this checkout's copy." >&2
        echo "  tag tree:  $REPO_ROOT (does not carry it)" >&2
        echo "  tool tree: $TOOL_ROOT_FOR_GATES/$rel" >&2
        echo "  A check the release predates is run, not skipped: the only" >&2
        echo "  alternative is no check, and the artifacts are the subject" >&2
        echo "  either way." >&2
        printf '%s' "$TOOL_ROOT_FOR_GATES/$rel"
        return 0
    fi
    echo "sign.sh: $rel is in neither tree. Refusing to sign." >&2
    echo "  tag tree:  $REPO_ROOT" >&2
    echo "  tool tree: $TOOL_ROOT_FOR_GATES" >&2
    return 1
}

# --- Artifact-set gate --------------------------------------------------
EXPECTED="$REPO_ROOT/tools/release/expected-artifacts.txt"
LANES="$REPO_ROOT/tools/release/shipped-lanes.txt"

# A REHEARSAL READS ITS RULES FROM THE TOOLS, NOT FROM THE TAG (§7.5,
# frontier row 101, operator answer `dq7` 2026-08-07). This is the one
# deliberate exception to the line above and it is narrow on purpose.
#
# A PRODUCTION manifest is a public claim about a released tree, so its gate
# data has to be the data that tree shipped with - otherwise a newer list
# could excuse a lane the tag never built, or demand one it could not have.
# That is why $REPO_ROOT is the default and stays the default.
#
# A rehearsal is the opposite thing. It exists to exercise the tooling that
# will cut the NEXT release, against the LAST release's bytes, and its
# manifest never leaves the staging feed: publish.sh refuses a `--staging`
# target without the `.staging-feed` marker and a production target with it,
# in both directions. Reading the staging profile from the tag makes the
# rehearsal permanently one release behind its own tooling, which is not a
# delay but a dead end - measured 2026-08-07 against `v0.336.0`, whose
# `expected-artifacts.txt` declares no staging rows at all, so `--staging`
# refused at the only tag that exists and would refuse the same way at every
# tag cut before the profile that describes it.
#
# The tag still decides everything a signature is ABOUT: the pristine-clone
# check, the tag/version agreement and the artifacts themselves are
# untouched by this. What moves is only which file lists the shapes a
# rehearsal set may contain.
if [[ "$RELEASE_SET" == "staging" ]]; then
    TOOL_ROOT="$(cd "$HERE/../.." && pwd)"
    if [[ "$TOOL_ROOT" != "$REPO_ROOT" ]]; then
        echo "sign.sh: REHEARSAL - reading the artifact list from the TOOL tree" >&2
        echo "  tools:   $TOOL_ROOT/tools/release/expected-artifacts.txt" >&2
        echo "  release: $REPO_ROOT (still gates the tag, the tree and the bytes)" >&2
    fi
    EXPECTED="$TOOL_ROOT/tools/release/expected-artifacts.txt"
    LANES="$TOOL_ROOT/tools/release/shipped-lanes.txt"
fi

# GATE_EXPECTED is what every artifact-level gate below is pointed at. It
# is the committed list for a full release, and a per-run scope derived
# from that list plus shipped-lanes.txt for a partial one (--lane,
# ). Derived rather than hand-written on purpose: the command line
# names a LANE, and the committed files decide what that lane contains.
COVERAGE_LANES=""
GATE_EXPECTED="$EXPECTED"
SCOPE_FILE=""
# --lane and --staging are mutually exclusive, and refusing the
# combination here rather than letting it through is the same call
# publish.sh already makes at the other end: it rejects `--staging` for
# any manifest carrying a `# lanes:` header, because "a lane with no
# channel pointer has nothing to rehearse there". A partial rehearsal set
# would produce a manifest that publish.sh must then refuse, which turns
# a nonsense invocation into a confusing failure two steps later.
if [[ -n "$STAGING_OS" && "$RELEASE_SET" != "staging" ]]; then
    echo "sign.sh: --os is only meaningful with --staging." >&2
    echo "  A production release covers every OS by definition; scoping one" >&2
    echo "  is what --lane is for. Ignoring the flag here would gate a full" >&2
    echo "  release against the full list while its operator believed the" >&2
    echo "  run was narrowed, which is the worst of the three outcomes." >&2
    exit 2
fi

# The passphrase file was a REHEARSAL-ONLY affordance until the operator
# amended `dq-9` on 2026-08-10 to allow an unattended PRODUCTION signature.
# The amendment is honoured with a second flag rather than by deleting the
# check, and the distinction matters more than it looks.
#
# The original ruling's reasoning still stands on its own terms: a
# production manifest signed from a file is a ceremony that silently
# stopped being one, and K1 is the key attesting the bytes users install.
# What changed is who decided to accept that, not whether it costs
# anything. So an unattended production signature must be TYPED, every
# time, by the run that wants it - it can never be inherited from a
# staging command someone copied, from an env default, or from a
# passphrase file that happens to be lying next to the key.
#
# `--unattended` alone is refused for the same reason in reverse: a flag
# that reads as an authorisation while changing nothing would be taken for
# one, and the next reader would believe a control exists that does not.
if [[ -n "$PASSPHRASE_FILE" && "$RELEASE_SET" != "staging" && "$UNATTENDED" -ne 1 ]]; then
    echo "sign.sh: --passphrase-file on a production run needs --unattended." >&2
    echo "  The operator amended dq-9 on 2026-08-10 to allow this, and the" >&2
    echo "  flag is what makes each such run a choice rather than an" >&2
    echo "  inherited default. A production manifest signed from a file is" >&2
    echo "  a ceremony that stopped being one; the manifest records that in" >&2
    echo "  its own '# signing: unattended' header so a reader can weigh it." >&2
    exit 2
fi
if [[ "$UNATTENDED" -eq 1 && -z "$PASSPHRASE_FILE" ]]; then
    echo "sign.sh: --unattended without --passphrase-file does nothing." >&2
    echo "  This run would still meet a pinentry. Refusing rather than" >&2
    echo "  proceeding, because a flag that reads as an authorisation and" >&2
    echo "  changes nothing is worse than no flag at all." >&2
    exit 2
fi
if [[ "$UNATTENDED" -eq 1 && "$RELEASE_SET" == "staging" ]]; then
    echo "sign.sh: --unattended is meaningless with --staging." >&2
    echo "  A rehearsal already reads its passphrase from a file (dq-9)." >&2
    exit 2
fi

# A missing or over-readable passphrase file fails BEFORE any hashing,
# per the fail-fast posture the rest of this script keeps: the mode check
# is here because the file is the whole secret, and 0600 is what the
# release store's own K1 material already carries.
if [[ -n "$PASSPHRASE_FILE" ]]; then
    if [[ ! -r "$PASSPHRASE_FILE" ]]; then
        echo "sign.sh: --passphrase-file '$PASSPHRASE_FILE' is not readable." >&2
        exit 2
    fi
    # GNU stat FIRST, BSD second, and the order is load-bearing rather
    # than arbitrary. `stat -f` is `--file-system` on GNU, so the BSD form
    # does not fail inertly there: it prints a filesystem status block to
    # stdout and exits non-zero, and the fallback then appends the real
    # mode to that block (measured on a Linux host: `pf_mode` came back as
    # six lines of filesystem dump followed by `644`). The reverse is inert
    # as intended, because macOS `stat -c` exits 1 with empty stdout.
    pf_mode="$(stat -c '%a' "$PASSPHRASE_FILE" 2>/dev/null \
        || stat -f '%Lp' "$PASSPHRASE_FILE" 2>/dev/null || true)"
    # An unreadable mode FAILS CLOSED rather than skipping the check. A
    # garbled read must never decide a secret's permissions, and "we could
    # not tell" resolving to "carry on" is how the BSD-first ordering above
    # would have gone unnoticed on a venue.
    if ! [[ "$pf_mode" =~ ^[0-7]{3,4}$ ]]; then
        echo "sign.sh: could not read the mode of --passphrase-file" >&2
        echo "  '$PASSPHRASE_FILE'. It holds K1's passphrase and this run" >&2
        echo "  cannot confirm who can read it, so it refuses to use it." >&2
        exit 2
    fi
    if [[ "${pf_mode: -2}" != "00" ]]; then
        echo "sign.sh: --passphrase-file '$PASSPHRASE_FILE' is mode $pf_mode." >&2
        echo "  It holds K1's passphrase and is readable by group or other." >&2
        echo "  chmod 600 it before signing anything with it." >&2
        exit 2
    fi
fi

if [[ ${#LANE_NAMES[@]} -gt 0 && "$RELEASE_SET" == "staging" ]]; then
    echo "sign.sh: --staging cannot be combined with --lane." >&2
    echo "  The rehearsal set is defined by which formats can auto-update," >&2
    echo "  not by which store lane shipped, and publish.sh refuses a" >&2
    echo "  partial-coverage manifest on the staging feed anyway (§7.5)." >&2
    exit 2
fi

if [[ ${#LANE_NAMES[@]} -gt 0 ]]; then
    COVERAGE_LANES="${LANE_NAMES[*]}"
    SCOPE_FILE="$(mktemp "${TMPDIR:-/tmp}/xchain-lane-scope.XXXXXX")"
    # Removed on every exit path: a scope file left behind is a list that
    # looks committed and is not, and this one demands less than the real
    # one by design.
    trap 'rm -f "$SCOPE_FILE"' EXIT
    xr_lane_scope "$LANES" "$EXPECTED" "${LANE_NAMES[@]}" > "$SCOPE_FILE"
    GATE_EXPECTED="$SCOPE_FILE"
    echo "sign.sh: PARTIAL release - gating against lane(s): $COVERAGE_LANES" >&2
    grep -v '^#' "$SCOPE_FILE" | grep . | sed 's/^/  scope: /' >&2
fi

if [[ "$RELEASE_SET" == "staging" ]]; then
    if [[ -n "$STAGING_OS" ]]; then
        echo "sign.sh: REHEARSAL set (§7.5), scoped to $STAGING_OS - gating" >&2
        echo "  against that OS's staging rows only, and recording the scope" >&2
        echo "  in the signed header as 'rehearsal-os: $STAGING_OS'." >&2
    else
        echo "sign.sh: REHEARSAL set (§7.5) - gating against every staging row." >&2
        echo "  Pass --os <${XR_STAGING_OSES[*]}> to rehearse one OS." >&2
    fi
fi
xr_check_expected "$INPUT_DIR" "$GATE_EXPECTED" "$RELEASE_SET" "$STAGING_OS"

# The gate above reads NAMES. This one opens the bytes, because on
# 2026-08-06 snapcraft was shown packing x86-64 libraries into a snap whose
# own metadata declared `architectures: [arm64]`, exit 0, no warning
# (). Name, metadata and contents all have to agree before a
# signature says they do: an artifact signed under the wrong arch installs,
# verifies against this manifest, and cannot start.
xr_check_payload_arches "$INPUT_DIR"

# A lane that already has users must not vanish from a release. The gate
# above cannot ask this: every store lane is `optional` there until it has
# shipped once, and nothing about a first upload edits that file
# ( §6 release parity,  §2).
#
# It reads the FULL expected list even on a partial release, because its
# two drift checks are about whether the two committed files agree with
# each other - a question whose answer does not depend on what is being
# signed today. Only the parity requirement is narrowed, by COVERAGE_LANES.
#
# A REHEARSAL IS NOT A RELEASE AND THIS GATE DOES NOT APPLY TO IT (§7.5,
# 2026-08-07). Lane parity asks "does this release abandon users who already
# installed a lane" - a question about something being PUBLISHED to those
# users. A staging set is defined by §7.5 as the update-capable DESKTOP
# formats only, so it contains no Android or iOS artifact by construction,
# and its manifest goes to the staging feed, which no user's app has ever
# fetched. Driven before this was written: the gate refused a correct
# Linux rehearsal for staging no `.apk` and no `.aab`, which is the gate
# working perfectly on a question nobody asked it.
#
# The two drift checks it also performs are not lost, only deferred: they
# compare two committed files with each other, and every production
# signing run makes them.
if [[ "$RELEASE_SET" == "staging" ]]; then
    echo "sign.sh: REHEARSAL - skipping the shipped-lane parity gate." >&2
    echo "  A staging set holds update-capable desktop formats only (§7.5)," >&2
    echo "  so it has no store lane to be at parity with, and nothing here" >&2
    echo "  reaches a user: the manifest goes to the staging feed." >&2
else
    xr_check_shipped_lanes "$INPUT_DIR" "$LANES" "$EXPECTED" "$COVERAGE_LANES"
fi

# A profile the build cannot actually produce must not be signed into the
# record as though it had .
xr_assert_store_profile_buildable "$INPUT_DIR" "$GATE_EXPECTED"

# --- Signature gate  --------------------------------------------
# Every gate above this line counts artifacts: how many, which arches,
# which profile, which lanes. None of them asks whether the artifacts are
# SIGNED, and the build cannot be relied on to fail if they are not -
# electron-builder.config.cjs skips Windows signing silently when its three
# Azure variables are unset, and macOS signing degrades to a warning. So a
# release cut with one missing repository secret reaches exactly this point
# looking perfect.
#
# It has to run BEFORE xr_write_manifest rather than after, and that
# ordering is the whole point: K1 attests the BYTES, not the publisher, so
# a manifest written over unsigned installers verifies perfectly forever
# and every downstream check - verify.sh, the feed sweep, the updater's own
# hash check - agrees with it. Once signed, nothing left in the pipeline
# can tell the difference.
# Resolved into a variable rather than inlined: a command substitution
# used as an argument throws its exit status away, so `node "$(...)"`
# would run node with an empty path on the refusal branch.
SIGNATURE_GATE="$(gate_script tools/release/verify-signatures.mjs)" || exit 1
node "$SIGNATURE_GATE" "$INPUT_DIR" "$GATE_EXPECTED" "$RELEASE_SET"

# --- Launch probe ( row 144) --------------------------------------
# EVERY GATE ABOVE THIS LINE READS THE ARTIFACTS. NONE OF THEM RUNS ONE.
#
# v0.338.0 shipped a macOS build that died about three seconds after launch
# with `Fatal process out of memory: Failed to reserve virtual memory for
# CodeRange`, because the hardened runtime's `com.apple.security.cs.allow-jit`
# entitlement was false. It passed the signature gate (the signature was
# real), the arch gate (the Mach-O header was right), the payload gates, the
# reproducibility check (the bytes matched the container exactly), Apple's
# notarization (which asks about malware, not about working), and the §7.5
# rehearsal (which downloads the artifact and checks its hash). A file that
# is correct in every readable respect and cannot start is invisible to all
# of them.
#
# So this launches it: fresh throwaway profile, a few seconds, still alive,
# no crash banner in its output. It sits here, after the signature gate and
# before xr_write_manifest, for the same reason the signature gate does -
# once K1 has attested the bytes, every downstream check agrees with the
# manifest forever and nothing left in the pipeline can tell.
#
# NO --require-probed HERE, deliberately. This runs on the release Mac
# against a set that also holds Linux artifacts no Mac can execute, so a
# minimum-launch count would refuse every release. What prevents a silent
# pass instead is the probe's own banner: a run that launched nothing says
# so in block capitals rather than printing an "ok" line. The CI lanes,
# where the host and the lane match by construction, DO pass a minimum.
#
# It opens a real window on the operator's desktop for a few seconds, and
# over SSH (no Aqua session) it reports NOT PROBED by name rather than
# failing the ceremony.
LAUNCH_PROBE="$(gate_script tools/release/launch-probe.mjs)" || exit 1
node "$LAUNCH_PROBE" "$INPUT_DIR" "$RELEASE_SET"

echo "sign.sh: hashing artifacts in $INPUT_DIR ..." >&2
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# The provenance declaration, and it is EMPTY unless this is an unattended
# production run. A rehearsal already announces itself through
# `# rehearsal-os:` and lives on a feed no user reads, so stamping it here
# would spend the field's meaning on the case that never needed it.
SIGNING_PROVENANCE=""
if [[ "$UNATTENDED" -eq 1 && "$RELEASE_SET" != "staging" ]]; then
    SIGNING_PROVENANCE="unattended"
fi
xr_write_manifest "$INPUT_DIR" "$TAG" "$TAG_COMMIT" "$BUILT_AT" "$DEV_MOCK_STATE" \
    "$GATE_EXPECTED" "$COVERAGE_LANES" "$STAGING_OS" "$SIGNING_PROVENANCE"

echo "sign.sh: signing manifest with key $XCHAIN_RELEASE_GPG_KEY ..." >&2
# Loopback pinentry ONLY when a passphrase file was supplied. The array
# stays empty on every other path, so a run that did not ask for one
# reaches gpg with exactly the arguments it always had and meets a pinentry.
GPG_PASSPHRASE_ARGS=()
if [[ -n "$PASSPHRASE_FILE" ]]; then
    GPG_PASSPHRASE_ARGS=(--pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE")
    if [[ "$SIGNING_PROVENANCE" == "unattended" ]]; then
        # Loud, on the production path only. The operator authorised this;
        # nobody should be able to discover it after the fact from a log
        # they had to go looking for.
        echo "sign.sh: *** UNATTENDED PRODUCTION SIGNATURE (dq-9 amendment," >&2
        echo "sign.sh: *** operator 2026-08-10). No human is at the pinentry" >&2
        echo "sign.sh: *** for the key that attests what users install. The" >&2
        echo "sign.sh: *** manifest records this as '# signing: unattended'." >&2
    fi
    echo "sign.sh: passphrase from $PASSPHRASE_FILE (dq-9)" >&2
fi
gpg --batch --yes \
    "${GPG_PASSPHRASE_ARGS[@]+"${GPG_PASSPHRASE_ARGS[@]}"}" \
    --local-user "$XCHAIN_RELEASE_GPG_KEY" \
    --armor \
    --detach-sign \
    --output "$SIG" \
    "$MANIFEST"

echo "sign.sh: ok" >&2
echo "  tag:       $TAG ($TAG_COMMIT)" >&2
echo "  manifest:  $MANIFEST" >&2
echo "  signature: $SIG" >&2
if [[ -n "$COVERAGE_LANES" ]]; then
    echo "  coverage:  PARTIAL - lane(s) $COVERAGE_LANES only" >&2
    echo >&2
    echo "  This manifest attests the artifacts it hashes and says NOTHING" >&2
    echo "  about any other lane of $TAG. Publish it under the same versioned" >&2
    echo "  name; verify.sh reads the coverage out of the signed header, so a" >&2
    echo "  reader is told what it does not cover rather than inferring it." >&2
fi
echo >&2
echo "  This one signature is checked three ways: by verify.sh, by a user" >&2
echo "  following https://docs.xchain.io/components/wallet/release/verify-release, and by the desktop updater" >&2
echo "  against the key pinned in the app ( S5)." >&2
echo >&2
echo "  Publish the manifest under its VERSIONED name so verify.sh can" >&2
echo "  anchor it: RELEASE_HASHES/$TAG.txt (+ .asc)." >&2
