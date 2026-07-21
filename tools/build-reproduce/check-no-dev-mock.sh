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

DIST_DIRS=(
    "packages/web/dist"
    "packages/extension/dist"
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
# These literals exist only in xchain-sdk's own source, so each web-style dist
# must contain at least one of them in an executable chunk.
REAL_SDK_MARKERS=(
    "CONTRACT_LINT_FAILED"
    "ENCODER_NOT_CONFIGURED"
)

failures=0

for dir in "${DIST_DIRS[@]}"; do
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
    for marker in "${REAL_SDK_MARKERS[@]}"; do
        if grep -r -l -F --exclude='*.map' "$marker" "$dir" > /dev/null 2>&1; then
            real_sdk_found=1
            break
        fi
    done
    if [ "$real_sdk_found" -eq 0 ]; then
        echo "FAIL $dir does not contain the real xchain-sdk (no SDK-unique literals found)"
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
