#!/usr/bin/env bash
# check-no-dev-mock.sh - pre-release gate.
#
# Greps `dist/` bundles for the dev-mock SDK fallback warning. Presence
# of that string in a production build means xchain-sdk didn't resolve
# during the Vite bundle pass - shipping it would produce pseudo-addresses
# on mainnet. Hard-fails the release pipeline.
#
# Usage:
#   bash tools/build-reproduce/check-no-dev-mock.sh
#
# Runs in CI post-build via:
#   .github/workflows/release.yml (planned)
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
        if grep -r -l -F "$marker" "$dir" > /dev/null 2>&1; then
            echo "FAIL $dir contains dev-SDK marker: \"$marker\""
            grep -r -l -F "$marker" "$dir" | sed 's/^/    /'
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
