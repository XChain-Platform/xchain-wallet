// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Playwright timeout budget, sized for the machine the run
// actually lands on.
//
// The dev-server suite was LOAD-SENSITIVE: on a busy dev box it failed a
// DIFFERENT spec each run while every one of those specs passed on its own.
// Full-suite wall time moved 3.6min -> 9.3min across the same three runs,
// which is the tell - nothing was racing, assertions were simply arriving
// after a fixed 15s budget that had been sized on an idle machine. (One real
// race did hide in there, a click landing on a not-yet-enabled button; that
// one was found and fixed separately in 1d99c64. What is left is pressure.)
//
// The suite already runs serial (`workers: 1`), so it cannot throttle itself
// any further - it does not own the contention. Its neighbours do: a second
// coder's suites, CI gates, other dev servers on the same host. The only
// lever left is the budget, and a single hard-coded number cannot be right
// for both cases. Tight enough to fail a genuine hang fast on an idle box is
// too tight when the box is loaded; slack enough for a loaded box means a
// wedged test burns minutes before anyone hears about it.
//
// So measure, then stretch. On an idle machine the timings stay tight; on a
// loaded one the suite degrades into slowness instead of red.

import os from 'node:os';

/**
 * Per-test budget on an unloaded machine. Unchanged from the pre-
 * number: the test ceiling was never what failed. It exists here only so it
 * keeps pace with the assertion budget below, since a test whose ceiling is
 * a smaller multiple of its own assertions' would start dying of the test
 * timeout instead - the same red, one line further up the stack trace.
 */
export const BASE_TEST_TIMEOUT_MS = 120_000;

/**
 * Per-assertion budget on an unloaded machine. THIS is the number that made
 * the suite load-sensitive: it was 15s, and 15s is not enough for a confirm
 * screen whose intent line waits on a compose round trip through the in-page
 * host while the box is busy. That failure is what the diagnosis run caught:
 * the screen had painted its chain badge and its fallback fee estimate, and
 * the composed intent simply had not landed yet.
 */
export const BASE_EXPECT_TIMEOUT_MS = 30_000;

/**
 * Per-core load at which we stop stretching and call the box fully
 * contended.
 *
 * Deliberately well below 1.0. A single test here is one browser tab plus
 * one on-demand Vite transform, both single-threaded, so this suite starts
 * losing wall time long before every core has a runnable process queued. On
 * the 32-core machine where the sensitivity was diagnosed the suite went red
 * at a load average of 7-9, i.e. a per-core load around 0.25.
 */
export const SATURATION_LOAD_PER_CPU = 0.35;

/** Ceiling on the stretch, so a truly wedged test still fails the same day. */
export const MAX_LOAD_SCALE = 2;

/**
 * Floor on the stretch when the run is on CI, needed because everything above
 * measures the WRONG THING for a hosted runner.
 *
 * The model above is contention: a big box gets slow when its neighbours are
 * busy, and load average per core is exactly the right signal for that. A
 * hosted runner is not contended - one Playwright worker on an otherwise idle
 * machine reports a per-core load well under SATURATION_LOAD_PER_CPU, so it
 * scores about 1.0x. It is simply SMALL AND SLOW, which load average cannot
 * see. So the suite handed its TIGHTEST budget to its SLOWEST machine, and
 * `ci.yml`'s `e2e` job came back 2 failed / 8 flaky, with both hard failures
 * and five of the eight flaky ones waiting on a wallet create or unlock (run
 * 30827175941, 2026-08-03).
 *
 * The same defect as the unit suite's ceilings in, one venue over,
 * on a job the release gate requires to be green. The floor reuses the
 * existing ceiling rather than inventing a number: a runner is at least as
 * disadvantaged as a fully contended dev box.
 */
export const CI_MIN_SCALE = MAX_LOAD_SCALE;

/**
 * Budget for a step that pays a real Argon2id derivation: creating or
 * unlocking a wallet.
 *
 * This existed as a bare `90_000` inside the wallet fixture, with a comment
 * saying "Argon2id runs on the CI runner's CPU; this is the slow step" - the
 * one assertion in the suite that KNEW it was the slow step was also the one
 * that opted out of the budget built for exactly that problem.
 *
 * Deliberately below BASE_TEST_TIMEOUT_MS so a genuinely wedged unlock still
 * fails on ITS OWN assertion, naming the step, rather than on the test
 * ceiling one line further up the stack.
 */
export const BASE_KDF_STEP_TIMEOUT_MS = 90_000;

/**
 * How far to stretch the budget, as a multiplier in [1, MAX_LOAD_SCALE].
 *
 * Linear in the 1-minute load average per core, clamped at both ends. An
 * explicit `override` (the PW_TIMEOUT_SCALE env var) wins outright and is
 * NOT clamped: someone debugging a slow venue by hand should be able to ask
 * for 10x, and someone reproducing a CI timing failure should be able to
 * pin 1x. Only a finite positive number counts as an override; anything
 * else falls through to the measurement rather than silently zeroing the
 * budget.
 */
export function loadScale({ load, cpuCount, override, ci = false } = {}) {
    const pinned = Number(override);
    if (override !== undefined && override !== null && override !== ''
        && Number.isFinite(pinned) && pinned > 0) {
        return pinned;
    }

    const cores = Number.isFinite(cpuCount) && cpuCount > 0 ? cpuCount : 1;
    const oneMinute = Number.isFinite(load) && load > 0 ? load : 0;
    const perCpu = oneMinute / cores;
    const contention = Math.min(1, perCpu / SATURATION_LOAD_PER_CPU);
    const measured = 1 + contention * (MAX_LOAD_SCALE - 1);
    // The explicit override above still wins outright, including on CI:
    // pinning 1x to reproduce a CI timing failure has to keep working, and it
    // is the documented way to do that.
    return ci ? Math.max(measured, CI_MIN_SCALE) : measured;
}

/**
 * The timeouts to hand Playwright, plus the scale they came from so a run's
 * log can say what budget it had. A red run whose log shows 1.0x on a box
 * that was actually busy is a different bug report than one that shows 2.0x.
 *
 * Rounded to whole seconds purely so the logged line reads cleanly.
 */
export function timeoutBudget({ env = process.env, load, cpuCount } = {}) {
    const scale = loadScale({
        load: load ?? os.loadavg()[0],
        cpuCount: cpuCount ?? os.cpus().length,
        override: env.PW_TIMEOUT_SCALE,
        ci: !!env.CI,
    });

    const round = (ms) => Math.round((ms * scale) / 1000) * 1000;
    return {
        scale,
        timeout: round(BASE_TEST_TIMEOUT_MS),
        expectTimeout: round(BASE_EXPECT_TIMEOUT_MS),
        kdfStepTimeout: round(BASE_KDF_STEP_TIMEOUT_MS),
    };
}

/**
 * The KDF-step budget for the current run, for fixtures that cannot reach
 * Playwright's config. Same scale as everything else by construction, which
 * is the whole point: the step that pays the derivation should not be the one
 * assertion sized by hand.
 */
export function kdfStepTimeout(opts) {
    return timeoutBudget(opts).kdfStepTimeout;
}

/** One line naming the budget, for the top of a run's output. */
export function describeBudget(budget) {
    return `[timeout-budget] scale ${budget.scale.toFixed(2)}x`
        + ` · test ${budget.timeout / 1000}s`
        + ` · expect ${budget.expectTimeout / 1000}s`;
}
