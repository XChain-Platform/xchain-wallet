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

#
# bin/ci-full.sh: run EVERY tier this repo's GitHub CI runs, in one process.
#
# .github/workflows/ci.yml fans this repo out as seven parallel jobs (test,
# drift-guards, build, coverage, e2e, audit, verdict). The pre-push venue gate
# used to run only `npm run ci`, which is the `test` job alone, so a push could
# gate green locally and then go red on GitHub on a job the gate never ran
# (2026-08-15: exactly that, on three repos at once). This script IS the local
# twin of the workflow: every job's run-steps, transcribed, in job order. When
# ci.yml gains or changes a job, change this script in the same commit.
#
# ci.yml is the only workflow in scope. Every other workflow here triggers on
# `v*` tags (release.yml, windows-swap-check.yml, mobile.yml) or on a weekly
# schedule plus workflow_dispatch (electron-cadence.yml, credential-expiry.yml),
# so none of them can turn a branch push red.
#
# Layout: siblings resolve at ../<repo>, which is both the platform monorepo
# layout and the venue gate's work/ layout (.ci-siblings ships them there). A
# sibling a GitHub job checks out is REQUIRED here: missing means fail loud,
# never skip, because GitHub will run the step this gate would be skipping.
# xchain-documentation is that sibling, and it deliberately rides master (the
# `test` job pins `ref: master` because the docs smokes assert the PUBLISHED
# documentation a user reads); the venue harness ships it at its own default
# branch, which is master, so nothing is pinned here.
#
# No database: no job in this workflow touches one, so there is no CI_DB_* /
# TEST_DB_* mapping to make. No docker either.
#
# SKIPPED-BY-DESIGN (printed loudly at run time too, so every gate log shows
# the gap):
#
#   - job `e2e`, step "Upload Playwright report": actions/upload-artifact, a
#     GitHub-only step with no local equivalent, and `if: failure()` anyway.
#   - job `verdict`: tools/release/run-verdict.mjs classifies the jobs of a
#     GitHub Actions RUN, read by run_id through the Actions API. There is no
#     run to read on a venue, and what it reports (which tier stated a finding
#     versus which never started) is exactly what this script's own per-tier
#     PASS/FAIL lines say directly.
#
# The implicit non-steps need no transcription: actions/checkout, corepack
# enable, actions/setup-node with its pnpm cache, and `pnpm install
# --frozen-lockfile`, which the venue gate performs before it calls this script.
#
# All tiers run even after one fails (GitHub reports every red job, so this
# reports every red tier); the exit code is red if any tier was.
#
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
SIB="$(cd .. && pwd)"

FAILED=""
# >>> ci-tier (generated block; re-run the tier wirer to update) >>>
# Tier classes. A push grades the FAST tier only: the unit job, the pin and
# drift guards, and the structure and hygiene checks the hook runs before it
# dispatches. The tiers named below (coverage re-runs, perf scenarios) are
# skipped when the gate sets CI_TIER=fast, and each skip is recorded so the
# closing verdict can never claim a green it did not earn. Nothing stops
# being graded: a scheduled sweep re-runs this same script with CI_TIER=full
# on every repo every three hours and before any release or deploy, and a
# red there is tracked down and fixed first. CI_TIER is unset for a hand
# run, so a bare `npm run ci:full` still runs every tier as it always did.
CI_TIER_FULL_ONLY=(
  "coverage ratchet (test:unit:coverage)"
  "e2e: Playwright browsers"
  "e2e suite (test:e2e)"
)
DEFERRED=""
ci_tier_deferred() {
  [ "${CI_TIER:-full}" = "fast" ] || return 1
  local t
  for t in ${CI_TIER_FULL_ONLY[@]+"${CI_TIER_FULL_ONLY[@]}"}; do
    if [ "$t" = "$1" ]; then
      DEFERRED="$DEFERRED [$1]"
      echo; echo "ci:full ===== $1 DEFERRED (CI_TIER=fast, runs in the full sweep) ====="
      return 0
    fi
  done
  return 1
}
# <<< ci-tier <<<
# >>> ci-tier timer (generated block; re-run the tier wirer to update) >>>
run_tier() {
  ci_tier_deferred "$1" && return 0  # ci-tier guard (generated)
  local name="$1"; shift
  local __ci_tier_t0=$SECONDS
  echo; echo "ci:full ===== $name ====="
  if "$@"; then
    echo "ci:full ----- $name PASS ($(( SECONDS - __ci_tier_t0 ))s)"
  else
    FAILED="$FAILED [$name]"
    echo "ci:full ----- $name FAIL ($(( SECONDS - __ci_tier_t0 ))s)"
  fi
}
# <<< ci-tier timer <<<
need_sib() {
  local s
  for s in "$@"; do
    if [ ! -d "$SIB/$s" ]; then
      echo "ci:full: MISSING SIBLING $SIB/$s" >&2
      echo "ci:full: GitHub CI checks this sibling out and runs steps against it," >&2
      echo "ci:full: so skipping here would gate green on a subset. Declare it in" >&2
      echo "ci:full: .ci-siblings (venue) or clone it beside this repo (hand run)." >&2
      exit 1
    fi
  done
}

# The workflow lands the docs checkout inside the workspace at .docs-sibling
# because actions/checkout refuses a path outside it, then points
# XCHAIN_DOCS_ROOT there. Beside the repo IS the resolver's own default
# (test/smoke/_docs-repo.js reads <repo>/../xchain-documentation), so the local
# twin of that step is the sibling itself, named explicitly.
export XCHAIN_DOCS_ROOT="${XCHAIN_DOCS_ROOT:-$SIB/xchain-documentation}"

# Required, and NOT because "some smokes skip": nineteen docs-coupled smokes,
# the three store-ceremony gates, the verify-release and reproducible-builds
# page gates and the privacy gates all take their documented skip when this
# sibling is absent, and the `test` job is what the release gate certifies a tag
# on. A gate that cannot find its sibling must not be indistinguishable from a
# gate whose sibling is fine.
need_sib xchain-documentation

# --- job: test -------------------------------------------------------------
# `pnpm run ci` is unit + integration + security + fuzz + smoke, the same gate
# the pre-push hook used to run on its own.
run_tier "test (pnpm run ci)" pnpm run ci

# --- regression suite --------------------------------------------------
# test:regression is not part of any ci.yml job's `pnpm run ci` bundle, so
# nothing else in this script or the workflow ever ran it; a pinned past
# defect could regress and every gate would still say green. Run it here so
# this script stays the one place that runs every tier this repo has.
run_tier "regression suite (test:regression)" pnpm test:regression

# --- job: drift-guards -----------------------------------------------------
# No sibling checkout, matching the workflow: since DD6 the shells consume the
# published @dankest-llc/xchain-sdk, so the installed package is the SDK a
# release would ship and the parity guard reads that. XCHAIN_REQUIRE_SIBLINGS=1
# is what turns the guard from a default skip into a real assertion.
run_tier "drift: wallet<->SDK derivation parity" \
  env XCHAIN_REQUIRE_SIBLINGS=1 \
  pnpm exec vitest run --config test/vitest/integration.config.js \
    test/integration/hd/wallet-sdk-derivation-parity.test.js
# Same escape, second site: PreflightPanel hand-copies the Tier-1 finding codes
# and the report schema version, and xchain-sdk/src/preflight/constants.js names
# that test as the enforcement point of its additive-only promise. It also runs
# non-strict inside the `test` tier above, where an unresolvable SDK is a skip;
# only here can that skip become a failure.
run_tier "drift: wallet<->SDK preflight schema/code parity" \
  env XCHAIN_REQUIRE_SIBLINGS=1 \
  pnpm exec vitest run --config test/vitest/unit.config.js \
    test/unit/components/PreflightPanel.tier1Notice.test.jsx
run_tier "drift: wallet<->hub chain-registry snapshot" \
  node bin/sync-chain-registry.mjs --check

# --- job: build ------------------------------------------------------------
# The three gates after the build can only be checked against a real dist/, so
# they live here and not in the test job. The heap bump is not optional: `-r`
# builds the web SPA as one large synchronous graph and a stock old-space
# aborts partway, which took these three gates down with it.
run_tier "build: all packages" \
  env NODE_OPTIONS=--max-old-space-size=6144 pnpm -r --if-present build
run_tier "build: no dev-mock SDK in the shipped bundles" \
  bash tools/build-reproduce/check-no-dev-mock.sh
run_tier "build: no bundled @trezor code in the shipped bundles" \
  bash tools/build-reproduce/check-no-trezor-dist.sh
run_tier "build: SRI hashes match the built assets" \
  node test/smoke/security/web-sri.smoke.js

# --- job: coverage ---------------------------------------------------------
run_tier "coverage ratchet (test:unit:coverage)" pnpm test:unit:coverage

# --- job: e2e --------------------------------------------------------------
# Browser binaries are not in the pnpm store, so the workflow fetches them and
# so does this. The Playwright config spawns the Vite dev server itself, so
# there is nothing to start; CI=1 makes it refuse to reuse a stray one.
run_tier "e2e: Playwright browsers" pnpm exec playwright install --with-deps chromium
run_tier "e2e suite (test:e2e)" env CI=1 pnpm test:e2e
echo "ci:full: SKIPPED-BY-DESIGN e2e/Upload Playwright report: actions/upload-artifact is a GitHub-only step (and if: failure()); the report stays on disk at test/e2e/playwright-report/."

# --- job: audit ------------------------------------------------------------
# Deliberately --prod: the dev toolchain's advisories never reach a user.
run_tier "audit: production dependencies" pnpm audit --prod --audit-level=high

# --- job: verdict ----------------------------------------------------------
echo "ci:full: SKIPPED-BY-DESIGN verdict: tools/release/run-verdict.mjs classifies a GitHub Actions run's jobs by run_id through the Actions API; no such run exists on a venue, and the per-tier PASS/FAIL lines above are the local statement of the same finding."

echo
# >>> ci-tier summary (generated) >>>
echo "ci:full: tier class ${CI_TIER:-full}"
if [ -n "${DEFERRED:-}" ]; then
  echo "ci:full: DEFERRED to the full sweep:$DEFERRED"
fi
# <<< ci-tier summary <<<
if [ -n "$FAILED" ]; then
  echo "ci:full: RED tiers:$FAILED"
  exit 1
fi
# >>> ci-tier verdict (generated) >>>
if [ "${CI_TIER:-full}" = "fast" ]; then
  echo "ci:full: all FAST tiers green; the DEFERRED tiers above were NOT graded here"
else
  echo "ci:full: all tiers green (same set GitHub CI runs)"
fi
# <<< ci-tier verdict <<<
