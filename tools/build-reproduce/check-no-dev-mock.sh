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

# check-no-dev-mock.sh - pre-release gate.
#
# Greps the EXECUTABLE `dist/` bundles for the dev-mock SDK fallback. The dev-mock
# SDK serves fabricated addresses and balances and cannot sign or broadcast;
# shipping a bundle that can reach it would put pseudo-addresses in front of a
# mainnet user, who has no way to tell by looking. Hard-fails the release.
#
# Why this check is meaningful (it previously was not, twice):
#   1. The fallback lives in a catch branch in each shell's sdkFactory, so its
#      warning string used to be compiled into EVERY build, good or bad, and
#      this grep tripped on a perfectly healthy bundle. It only ever "passed"
#      because CI never built, so dist/ never existed. The sdkFactories now
#      refuse the fallback under `import.meta.env.PROD` (statically replaced by
#      Vite), so a production build eliminates that branch.
#   2. : grepping only the three WARNING strings was a false green. The
#      mock IMPLEMENTATION (createDevMockSdk) was referenced from live code
#      paths (the initial SDKRegistry factory + the devMockFactory argument),
#      so it could never be dead-code-eliminated and shipped in every build
#      while this gate reported OK. The mock definitions are now themselves
#      gated on `import.meta.env.PROD` (null in production), so a healthy
#      release bundle contains neither the warnings NOR the implementation.
#      The IMPLEMENTATION markers below ("Dev SDK stub", "devmockpsbt") are
#      strings unique to the mock's own code, which is what this gate actually
#      exists to keep out of a mainnet user's hands.
#
# Sourcemaps are EXCLUDED: a .map file embeds the original source by definition,
# so it will always contain the string, and it is never executed. Scanning them
# would make this gate unsatisfiable again.
#
# Usage:
#   bash tools/build-reproduce/check-no-dev-mock.sh
#   bash tools/build-reproduce/check-no-dev-mock.sh --artifacts release-artifacts/vX.Y.Z
#
# Runs in CI post-build via:
#   .github/workflows/ci.yml (build job)
#
# THE THIRD TIME THIS GATE WAS A FALSE GREEN ( S33), and unlike the two
# above it was not the marker set that was wrong - it was the SUBJECT.
#
# The gate scans the repo's `dist/` trees. The documented way to sign a
# release is from a pristine clone checked out at the tag (sign.sh refuses a
# dirty or non-tag tree, correctly), and a pristine clone has no `dist/` by
# definition. So every target printed `SKIP ... (not built)`, `failures`
# stayed 0, and the script printed `OK - no dev-SDK markers in dist/, real
# xchain-sdk present` and exited 0 having scanned nothing at all. sign.sh
# then wrote `# dev-mock-gate: enforced` into the SIGNED manifest header on
# that basis, and the desktop updater refuses any release whose header is not
# exactly `enforced`, so the one word that says this gate ran was true only in
# the sense that the script had been invoked.
#
# sign.sh already states the rule this violated, four lines above where it
# calls this script: "'the gate could not run' and 'the gate passed' must
# never produce the same release." It applied that to a MISSING script and not
# to an empty scan, which produces the identical release.
#
# Two changes close it, and they only make sense together:
#
#   1. Scanning nothing is a HARD FAILURE. A count of scanned targets is kept
#      and the summary line reports it, so "scanned three bundles" and
#      "skipped three bundles" can no longer print the same word.
#   2. `--artifacts <dir>` gives the gate something real to scan at signing
#      time: the web tarball and the extension zip out of the release staging
#      directory, which are the shipped bytes themselves rather than a local
#      rebuild of them. Without this, change 1 would simply make every
#      pristine-clone signing run refuse.
#
# The desktop renderer has no artifact-side equivalent: its bundle is sealed
# inside app.asar in each installer. That is reported as a stated GAP rather
# than a SKIP, on the same doctrine tools/release/expected-artifacts.txt
# already applies to its `*-unverified` signature classes - "we did not look"
# and "we looked and it was fine" must not be indistinguishable. The renderer
# IS gated on the built tree by the release workflow's own post-build step
# (.github/workflows/release.yml), which is where its dist actually exists.
set -euo pipefail

ARTIFACT_DIR=""
while [ $# -gt 0 ]; do
    case "$1" in
        --help|-h)
            cat <<'USAGE'
check-no-dev-mock.sh - pre-release gate.

Greps the EXECUTABLE bundles for the dev-mock SDK fallback. The dev-mock SDK
serves fabricated addresses and balances and cannot sign or broadcast, so a
bundle that can reach it would put pseudo-addresses in front of a mainnet
user who has no way to tell by looking. Hard-fails the release.

Usage:
  bash tools/build-reproduce/check-no-dev-mock.sh
  bash tools/build-reproduce/check-no-dev-mock.sh --artifacts release-artifacts/vX.Y.Z

Options:
  --artifacts <dir>  Scan the shipped bundles inside a release staging
                     directory (the web tarball and the extension zip)
                     instead of the repo's dist/ trees. This is what
                     sign.sh uses: the signing tree is a pristine clone
                     and has no dist/ to scan.
  --help             Show this text.

Exits 0 only if at least one bundle was actually scanned and was clean.
USAGE
            exit 0
            ;;
        --artifacts|-a)
            if [ $# -lt 2 ]; then
                echo "check-no-dev-mock.sh: --artifacts needs a directory" >&2
                exit 2
            fi
            ARTIFACT_DIR="$2"
            shift 2
            ;;
        *)
            echo "check-no-dev-mock.sh: unknown argument: $1" >&2
            echo "Try --help." >&2
            exit 2
            ;;
    esac
done

# Each entry: <bundle dir>|<comma-separated SDK-unique literals>. Any one of
# the literals appearing in an executable chunk proves the real SDK bundled.
#
# The marker set is PER TARGET because the shells reach the SDK differently.
# Web and extension go through the package index (sdkFactory), so the
# index-only literals appear in their bundles. The desktop renderer
# deliberately does not: it imports `xchain-sdk/src/wallet.js` directly to
# keep the package index out of the popup graph (renderer/signerFactories/
# ledgerFactory.js), so CONTRACT_LINT_FAILED and ENCODER_NOT_CONFIGURED are
# legitimately absent there. Giving every target the same list would have
# made this gate unsatisfiable for desktop - the third repeat of the failure
# this file's header already documents twice.
#
#  §6: desktop was missing entirely. `packages/desktop/renderer/dist`
# is the executable renderer bundle; `packages/desktop/dist` is
# electron-builder's INSTALLER output (asar + platform binaries) and is not
# a source tree to grep.
SCAN_TARGETS=(
    "packages/web/dist|CONTRACT_LINT_FAILED,ENCODER_NOT_CONFIGURED"
    "packages/extension/dist|CONTRACT_LINT_FAILED,ENCODER_NOT_CONFIGURED"
    "packages/desktop/renderer/dist|SDKWalletError,MULTISIG_DERIVE_FAILED"
)

# --- Artifact mode ------------------------------------------------------
#
# The same markers, pointed at the release staging directory instead of the
# repo. The unpacked trees are given the SAME literals as their repo-tree
# counterparts because they are the same bundles: the web tarball is
# packages/web/dist and the extension zip is packages/extension/dist, as
# built by the release workflow.
if [ -n "$ARTIFACT_DIR" ]; then
    if [ ! -d "$ARTIFACT_DIR" ]; then
        echo "check-no-dev-mock.sh: artifact dir '$ARTIFACT_DIR' does not exist" >&2
        exit 1
    fi
    UNPACK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/xchain-devmock.XXXXXX")"
    trap 'rm -rf "$UNPACK_ROOT"' EXIT

    SCAN_TARGETS=()

    web_tarball="$(find "$ARTIFACT_DIR" -maxdepth 1 -name 'xchain-wallet-web-v*.tar.gz' | head -n 1)"
    if [ -n "$web_tarball" ]; then
        mkdir -p "$UNPACK_ROOT/web"
        # A staged artifact that will not unpack is a hard failure, never a
        # skip: "we could not read it" and "we read it and it was clean"
        # must not produce the same release, which is this file's whole
        # subject one level down.
        if ! tar xzf "$web_tarball" -C "$UNPACK_ROOT/web" 2>/dev/null; then
            echo "FAIL $(basename "$web_tarball") is not a readable gzip tarball"
            echo
            echo "Pre-release gate FAILED - a staged release artifact could not be unpacked."
            exit 1
        fi
        SCAN_TARGETS+=("$UNPACK_ROOT/web|CONTRACT_LINT_FAILED,ENCODER_NOT_CONFIGURED|$(basename "$web_tarball")")
    fi

    ext_zip="$(find "$ARTIFACT_DIR" -maxdepth 1 -name 'xchain-wallet-extension-v*.zip' | head -n 1)"
    if [ -n "$ext_zip" ]; then
        mkdir -p "$UNPACK_ROOT/extension"
        if ! unzip -q "$ext_zip" -d "$UNPACK_ROOT/extension" 2>/dev/null; then
            echo "FAIL $(basename "$ext_zip") is not a readable zip archive"
            echo
            echo "Pre-release gate FAILED - a staged release artifact could not be unpacked."
            exit 1
        fi
        SCAN_TARGETS+=("$UNPACK_ROOT/extension|CONTRACT_LINT_FAILED,ENCODER_NOT_CONFIGURED|$(basename "$ext_zip")")
    fi

    # Stated, not silent. The renderer bundle is sealed inside app.asar in
    # every installer, so there is nothing here to grep; it is gated on the
    # built tree by the release workflow instead.
    echo "GAP  desktop renderer - sealed in app.asar, gated post-build in release.yml, not here"
fi

MARKERS=(
    # Fallback warning strings (sdkFactory catch branch):
    "xchain-sdk unavailable"
    "falling back to dev-mock SDK"
    "DO NOT USE FOR MAINNET"
    # Mock implementation strings ( - the mock itself, not its warning):
    "Dev SDK stub"
    "devmockpsbt"
)

#  positive check: absence of the mock proves nothing if the REAL SDK
# also failed to bundle (the wallet would then run on a throwing placeholder).
# The literals live in the SCAN_TARGETS table above, per target, because
# which SDK modules a shell pulls in is a property of that shell.

failures=0
scanned=0
skipped=0

for entry in "${SCAN_TARGETS[@]+"${SCAN_TARGETS[@]}"}"; do
    dir="${entry%%|*}"
    rest="${entry#*|}"
    sdk_markers="${rest%%|*}"
    # Third field is a display label. In artifact mode the scanned directory
    # is an unpack under $TMPDIR, and a FAIL naming that path tells an
    # operator mid-ceremony nothing about WHICH artifact is bad.
    if [ "$rest" = "$sdk_markers" ]; then label="$dir"; else label="${rest#*|}"; fi
    if [ ! -d "$dir" ]; then
        echo "SKIP $label (not built)"
        skipped=$((skipped + 1))
        continue
    fi
    scanned=$((scanned + 1))
    for marker in "${MARKERS[@]}"; do
        if grep -r -l -F --exclude='*.map' "$marker" "$dir" > /dev/null 2>&1; then
            echo "FAIL $label contains dev-SDK marker: \"$marker\""
            grep -r -l -F --exclude='*.map' "$marker" "$dir" | sed "s|^$dir|    $label|"
            failures=$((failures + 1))
        fi
    done
    real_sdk_found=0
    IFS=',' read -r -a target_sdk_markers <<< "$sdk_markers"
    for marker in "${target_sdk_markers[@]}"; do
        if grep -r -l -F --exclude='*.map' "$marker" "$dir" > /dev/null 2>&1; then
            real_sdk_found=1
            break
        fi
    done
    if [ "$real_sdk_found" -eq 0 ]; then
        echo "FAIL $label does not contain the real xchain-sdk (none of: $sdk_markers)"
        failures=$((failures + 1))
    fi
done

if [ "$failures" -gt 0 ]; then
    echo
    echo "Pre-release gate FAILED - dev-SDK stub leaked into a production bundle,"
    echo "or the real xchain-sdk did not bundle."
    echo "Fix: ensure xchain-sdk is installed before running the build, and that"
    echo "the shell's vite config still gives the linked SDK the CJS transform"
    echo "(build.commonjsOptions.include + the polyfill-shim resolver, )."
    exit 1
fi

# Scanning nothing is not passing. This is the whole point of the header's
# third false-green note: without it the line below prints for a run that
# looked at zero bytes, and sign.sh records `enforced` on the strength of it.
if [ "$scanned" -eq 0 ]; then
    echo
    echo "Pre-release gate FAILED - it scanned NOTHING ($skipped target(s) absent)."
    echo "A gate that could not run has not passed; sign.sh states that rule about"
    echo "a missing script and it holds identically for an empty scan."
    if [ -n "$ARTIFACT_DIR" ]; then
        echo "Fix: '$ARTIFACT_DIR' holds no xchain-wallet-web-v*.tar.gz and no"
        echo "xchain-wallet-extension-v*.zip. Stage the release artifacts first."
    else
        echo "Fix: build the shells first, or pass --artifacts <release staging dir>"
        echo "to scan the shipped bundles instead. A pristine clone has no dist/,"
        echo "which is exactly the tree a release is signed from."
    fi
    exit 1
fi

if [ "$skipped" -gt 0 ]; then
    echo "OK - $scanned bundle(s) scanned, clean; $skipped not built and not scanned"
else
    echo "OK - $scanned bundle(s) scanned, no dev-SDK markers, real xchain-sdk present"
fi
