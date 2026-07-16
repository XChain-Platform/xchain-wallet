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
# Why this check is meaningful (it previously was not): the fallback lives in a
# catch branch in each shell's sdkFactory, so its warning string used to be
# compiled into EVERY build, good or bad, and this grep tripped on a perfectly
# healthy bundle. It only ever "passed" because CI never built, so dist/ never
# existed. The sdkFactories now refuse the fallback under `import.meta.env.PROD`,
# which Vite statically replaces, so a production build dead-code-eliminates the
# dev-mock branch entirely. Absence of the marker is therefore real evidence.
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
    "xchain-sdk unavailable"
    "falling back to dev-mock SDK"
    "DO NOT USE FOR MAINNET"
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
done

if [ "$failures" -gt 0 ]; then
    echo
    echo "Pre-release gate FAILED - dev-SDK stub leaked into a production bundle."
    echo "Fix: ensure xchain-sdk is installed before running the build."
    exit 1
fi

echo "OK - no dev-SDK markers in dist/"
