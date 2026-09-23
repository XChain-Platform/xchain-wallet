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

# tools/regtest/test-integration.sh - one-command regtest-backed
# integration driver (G004 / §52).
#
# The default `pnpm test:integration` runs the network-free integration
# suite (mock backend, jsdom - see test/integration/README.md) and must
# stay that way so `pnpm ci` needs no Docker / regtest stack.
#
# The honest signed -> broadcast -> mined -> indexed -> read-back round
# trip that can only run against a live upstream regtest stack. It removes
# the manual "bring the stack up first" step by gating on wait-ready.sh
# before handing off to the regtest and extension E2E suites, failing fast
# (with the bootstrap diagnostic) instead of running against a half-up
# stack and producing confusing failures.
#
# The extension suite's test collection is validated before either suite
# runs: a load error or an empty match leaves those specs silently absent
# from every run that reaches this far, which is worse than a red test.
#
# Usage:
#   pnpm test:integration:regtest              # gate + run both suites
#   pnpm test:integration:regtest -- --headed  # extra args pass through
#
# Environment (consumed by wait-ready.sh):
#   XCHAIN_REGTEST_BASE_URL         Default http://localhost
#   XCHAIN_REGTEST_TIMEOUT_MS       Default 60000
#   XCHAIN_REGTEST_PROBE_TIMEOUT_MS Default 3000, per-probe bound

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${REPO_ROOT}"

echo "[test-integration] gating on a healthy upstream regtest stack ..."
bash "${SCRIPT_DIR}/wait-ready.sh"

echo "[test-integration] stack ready - validating extension test collection"
if ! EXTENSION_COLLECTION="$(pnpm exec playwright test --list \
    --config test/e2e/playwright.extension.config.js 2>&1)"; then
    printf '%s\n' "${EXTENSION_COLLECTION}" >&2
    echo "[test-integration] extension collection failed to load" >&2
    exit 1
fi
printf '%s\n' "${EXTENSION_COLLECTION}"
if ! grep -Eq '^Total: [1-9][0-9]* tests? in [1-9][0-9]* files?$' \
    <<<"${EXTENSION_COLLECTION}"; then
    echo "[test-integration] extension collection is empty" >&2
    exit 1
fi

echo "[test-integration] running the regtest round-trip suite"
pnpm exec playwright test --config test/e2e/playwright.regtest.config.js "$@"

echo "[test-integration] running the extension suite"
exec pnpm exec playwright test --config test/e2e/playwright.extension.config.js "$@"
