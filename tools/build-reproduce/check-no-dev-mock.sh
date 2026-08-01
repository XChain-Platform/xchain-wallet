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
#
# Runs in CI post-build via:
#   .github/workflows/ci.yml (build job)
set -euo pipefail

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

for entry in "${SCAN_TARGETS[@]}"; do
    dir="${entry%%|*}"
    sdk_markers="${entry#*|}"
    if [ ! -d "$dir" ]; then
        echo "SKIP $dir (not built)"
        continue
    fi
    for marker in "${MARKERS[@]}"; do
        if grep -r -l -F --exclude='*.map' "$marker" "$dir" > /dev/null 2>&1; then
            echo "FAIL $dir contains dev-SDK marker: \"$marker\""
            grep -r -l -F --exclude='*.map' "$marker" "$dir" | sed 's/^/    /'
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
        echo "FAIL $dir does not contain the real xchain-sdk (none of: $sdk_markers)"
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

echo "OK - no dev-SDK markers in dist/, real xchain-sdk present"
