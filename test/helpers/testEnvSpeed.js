// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// How much slower is THIS run than the box the ceilings were written on?
//
// WHY THIS EXISTS. Every time ceiling in the suite - the 20s unit default,
// import-exports' 60s, the argon2id 120s, testing-library's 1s async wait -
// was sized by someone watching it pass on a fast dev box. None of them was
// sized for the machine that decides whether a release can be cut. The
// result was seven "failing tests" in CI that are not seven defects and in
// most cases not defects at all: the same commit passes locally and always
// has.
//
// It matters beyond tidiness because `tools/release/verify-validated-commit.mjs`
// refuses to cut a signed release unless `ci.yml` concluded SUCCESS on the tag
// commit, and it deliberately has no skip switch. A suite whose ceilings only
// hold on one laptop is therefore a release blocker, not a test-health
// nuisance.
//
// WHAT MAKES A RUN SLOW. Two multipliers stack, and they were being
// mistaken for each other:
//
//   1. Coverage instrumentation. V8's precise coverage deoptimises hot
//      functions, including ones inside dependencies the coverage lens does
//      not even report on (@noble/hashes is where the argon2id loop lives).
//      Measured on one box, same hardware, kdf.test.js: 13.4s plain against
//      45.7s instrumented, a flat 3x.
//   2. The runner. Measured on ubuntu-latest, 2026-08-03, run 30827175941:
//      ONE argon2id derivation took 104s instrumented, against 5.0s for the
//      same derivation instrumented here. That 20x is not core speed; most
//      of it was the fork pool oversubscribing the runner (see unit.config.js).
//
// So the ceilings are expressed as a base sized on a dev box, multiplied
// here. A number that adapts is worth more than a bigger number, because the
// next machine is not this one either.
//
// WHAT THIS IS NOT. It is not a licence to let real hangs through. The
// factor applies to ceilings that bound honest CPU-bound work whose cost is
// known and explained at the point it is set; an infinite loop still fails,
// it just takes longer to say so on the slow machine where it is harder to
// tell apart from legitimate slowness anyway.

/**
 * True when this run carries coverage instrumentation.
 *
 * Set by `test/vitest/unit.config.js`, which detects `--coverage` on the
 * vitest command line and exports it into the test environment. Detection
 * lives in the config rather than here because the config is the only place
 * that sees the invocation; a test file only sees its environment.
 */
export const INSTRUMENTED = process.env.XCHAIN_TEST_INSTRUMENTED === '1';

/**
 * Multiplier applied to CPU-bound ceilings on an instrumented run.
 *
 * 5x, and the number is not a guess. Instrumentation alone is a measured 3x
 * on identical hardware; the remaining headroom covers a shared runner whose
 * worst observed case was a 204s test against a 120s ceiling. Sizing to the
 * observed worst case plus instrumentation is what makes the ceiling a hang
 * detector rather than a machine-speed detector.
 *
 * It is exported so `unit.config.js` can apply the SAME number to the
 * suite-wide default. That config cannot read `INSTRUMENTED` above, because
 * it is the thing that sets the environment variable it derives from, and it
 * has already been evaluated by then - so it passes its own detection in
 * through `slowTimeout`'s option rather than keeping a second copy of 5.
 */
export const SPEED_FACTOR_WHEN_INSTRUMENTED = 5;

export const SPEED_FACTOR = INSTRUMENTED ? SPEED_FACTOR_WHEN_INSTRUMENTED : 1;

/**
 * A ceiling for work whose cost is CPU-bound and known.
 *
 * Pass the budget you measured on a dev box; this returns the budget for the
 * machine actually running. Do NOT use it to paper over a test that is slow
 * for a reason nobody has explained - the base number should always have a
 * comment saying what the work is and why it costs what it costs.
 *
 * @param {number} baseMs budget measured on a fast dev box
 * @param {{instrumented?: boolean}} [opts] override the detected environment;
 *   only `unit.config.js` needs this, for the reason given above
 * @returns {number} budget for this run
 */
export function slowTimeout(baseMs, { instrumented = INSTRUMENTED } = {}) {
    return baseMs * (instrumented ? SPEED_FACTOR_WHEN_INSTRUMENTED : 1);
}
