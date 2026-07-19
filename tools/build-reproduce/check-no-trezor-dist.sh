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

# check-no-trezor-dist.sh - T-RSL redistribution gate.
#
# Greps the built `dist/` bundles of all three shipped wallet shells (web,
# extension, desktop) for any `@trezor` scope token and hard-fails on a hit.
#
# Why this matters: `@trezor/connect-web` carries the Trezor Reference Source
# License, which forbids redistribution. Commit c541ac7 dropped the bundled dep
# and switched web + desktop to load Trezor Connect from Trezor's hosted global
# build (connect.trezor.io); the MV3 extension drops Trezor entirely (Chrome
# bans remote code in extension_pages). A stray re-add of the npm dep, or a
# transitive dep pulling `@trezor/*` back into a shipped chunk, would silently
# re-bundle T-RSL code into a redistributed artifact. Absence of the scope token
# in the built output is the evidence that has not happened.
#
# Note the match target: the scope token `@trezor`, NOT the word "trezor". The
# shells legitimately reference the vendor by name (the hosted-script URL
# `connect.trezor.io`, the CSP allow-list, the Trezor signer UI), and none of
# those redistribute licensed code. Only an `@trezor/*` import or bundled module
# specifier does, and that is exactly what the scope token catches.
#
# Desktop path note: the desktop renderer builds to `packages/desktop/renderer/
# dist` (Vite `root` is the `renderer/` dir), not `packages/desktop/dist`.
# electron-builder later pulls that renderer bundle into the asar; the renderer
# bundle is the redistributable web code, so it is the correct grep target.
#
# Sourcemaps (`*.map`) are EXCLUDED: a .map embeds the original source by
# definition, so the JSDoc comments in trezorFactory.js that explain the
# migration (all referencing `@trezor/connect-web` in prose) live there and
# always will. A .map is never executed and is not the redistributed code path;
# scanning it would make this gate unsatisfiable for no security gain.
#
# Usage:
#   bash tools/build-reproduce/check-no-trezor-dist.sh            # default dirs
#   bash tools/build-reproduce/check-no-trezor-dist.sh DIR [DIR]  # explicit dirs
#
# Runs in CI post-build via .github/workflows/ci.yml (build job). Requires the
# shells to be built first (`pnpm -r --if-present build`); a missing dist dir is
# a hard failure, because a gate that silently skips an unbuilt shell proves
# nothing.
set -euo pipefail

if [ "$#" -gt 0 ]; then
    DIST_DIRS=("$@")
else
    DIST_DIRS=(
        "packages/web/dist"
        "packages/extension/dist"
        "packages/desktop/renderer/dist"
    )
fi

TOKEN="@trezor"

failures=0

for dir in "${DIST_DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        echo "FAIL $dir not built - run 'pnpm -r --if-present build' first"
        failures=$((failures + 1))
        continue
    fi
    if grep -r -l -F --exclude='*.map' "$TOKEN" "$dir" > /dev/null 2>&1; then
        echo "FAIL $dir contains a '$TOKEN' scope token:"
        grep -r -l -F --exclude='*.map' "$TOKEN" "$dir" | sed 's/^/    /'
        failures=$((failures + 1))
    else
        echo "OK   $dir - no '$TOKEN' scope token"
    fi
done

if [ "$failures" -gt 0 ]; then
    echo
    echo "T-RSL redistribution gate FAILED - '$TOKEN' code leaked into a shipped bundle."
    echo "Fix: remove the @trezor/* dependency; Trezor Connect loads from the hosted"
    echo "script (connect.trezor.io), it must never be bundled. See c541ac7 and"
    echo "packages/*/src/signers/trezorFactory.js."
    exit 1
fi

echo
echo "OK - no @trezor scope tokens in any shipped dist bundle."
