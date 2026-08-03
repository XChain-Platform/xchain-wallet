// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: test/e2e/timeout-budget.js - the load-aware Playwright budget .
//
// This is test infrastructure testing test infrastructure, which earns its
// keep for one reason: the thing it computes is invisible when it is wrong.
// A budget that silently collapses to zero turns the whole e2e suite red and
// looks like a wallet regression; one that silently pins at maximum hides a
// wedged test for six minutes. Neither shows up in a Playwright run's output
// as a budget problem, so pin the arithmetic here where it fails loudly.

import { describe, it, expect } from 'vitest';
import {
    BASE_EXPECT_TIMEOUT_MS,
    BASE_KDF_STEP_TIMEOUT_MS,
    BASE_TEST_TIMEOUT_MS,
    CI_MIN_SCALE,
    MAX_LOAD_SCALE,
    SATURATION_LOAD_PER_CPU,
    describeBudget,
    kdfStepTimeout,
    loadScale,
    timeoutBudget,
} from '../e2e/timeout-budget.js';

describe('e2e timeout budget', () => {
    describe('loadScale', () => {
        it('does not stretch an idle machine', () => {
            expect(loadScale({ load: 0, cpuCount: 32 })).toBe(1);
        });

        it('stretches to the ceiling on a saturated machine', () => {
            const scale = loadScale({
                load: SATURATION_LOAD_PER_CPU * 32,
                cpuCount: 32,
            });
            expect(scale).toBe(MAX_LOAD_SCALE);
        });

        it('never exceeds the ceiling, however overloaded the box', () => {
            expect(loadScale({ load: 400, cpuCount: 2 })).toBe(MAX_LOAD_SCALE);
        });

        it('interpolates between idle and saturated', () => {
            // Half of saturation lands halfway up the range.
            const half = loadScale({
                load: (SATURATION_LOAD_PER_CPU / 2) * 32,
                cpuCount: 32,
            });
            expect(half).toBeCloseTo(1 + (MAX_LOAD_SCALE - 1) / 2, 6);
        });

        it('stretches the same for the same per-core load on a smaller box', () => {
            // The point of dividing by core count: load 8 on 32 cores is a
            // quiet machine, load 8 on 4 cores is a wedged one. A CI runner
            // and this dev box must not read the same absolute number the
            // same way.
            const bigBox = loadScale({ load: 8, cpuCount: 32 });
            const smallBox = loadScale({ load: 1, cpuCount: 4 });
            expect(bigBox).toBeCloseTo(smallBox, 6);
            expect(loadScale({ load: 8, cpuCount: 4 })).toBe(MAX_LOAD_SCALE);
        });

        it('honours an explicit override, above the ceiling', () => {
            // The escape hatch is deliberately unclamped: someone debugging a
            // slow venue by hand gets the number they asked for.
            expect(loadScale({ load: 0, cpuCount: 32, override: '10' })).toBe(10);
        });

        it('honours an override that pins the old, tighter budget', () => {
            expect(loadScale({ load: 400, cpuCount: 2, override: '1' })).toBe(1);
        });

        it.each([
            ['unset', undefined],
            ['null', null],
            ['empty', ''],
            ['non-numeric', 'yes'],
            ['zero', '0'],
            ['negative', '-3'],
            ['infinite', 'Infinity'],
        ])('ignores a %s override rather than zeroing the budget', (_label, override) => {
            const scale = loadScale({ load: 400, cpuCount: 2, override });
            expect(scale).toBe(MAX_LOAD_SCALE);
        });

        it('survives a platform that reports no load or no cores', () => {
            expect(loadScale({})).toBe(1);
            expect(loadScale({ load: NaN, cpuCount: 0 })).toBe(1);
        });
    });

    describe('timeoutBudget', () => {
        it('returns the base budget on an idle machine', () => {
            const budget = timeoutBudget({ env: {}, load: 0, cpuCount: 32 });
            expect(budget.scale).toBe(1);
            expect(budget.timeout).toBe(BASE_TEST_TIMEOUT_MS);
            expect(budget.expectTimeout).toBe(BASE_EXPECT_TIMEOUT_MS);
        });

        it('scales both budgets together under load', () => {
            const budget = timeoutBudget({ env: {}, load: 32, cpuCount: 32 });
            expect(budget.scale).toBe(MAX_LOAD_SCALE);
            expect(budget.timeout).toBe(BASE_TEST_TIMEOUT_MS * MAX_LOAD_SCALE);
            expect(budget.expectTimeout).toBe(BASE_EXPECT_TIMEOUT_MS * MAX_LOAD_SCALE);
        });

        it('reads the override off the supplied env', () => {
            const budget = timeoutBudget({
                env: { PW_TIMEOUT_SCALE: '1' },
                load: 32,
                cpuCount: 32,
            });
            expect(budget.timeout).toBe(BASE_TEST_TIMEOUT_MS);
        });

        it('is always at least as generous as the pre- fixed budget', () => {
            // The regression this guards: someone retunes the base numbers
            // down and quietly reintroduces the 15s assertion budget that
            // made the suite load-sensitive in the first place.
            for (const load of [0, 1, 4, 8, 16, 64]) {
                const budget = timeoutBudget({ env: {}, load, cpuCount: 32 });
                expect(budget.timeout).toBeGreaterThanOrEqual(120_000);
                expect(budget.expectTimeout).toBeGreaterThanOrEqual(15_000);
            }
        });

        it('reads the real machine when nothing is supplied', () => {
            const budget = timeoutBudget({ env: {} });
            expect(budget.scale).toBeGreaterThanOrEqual(1);
            expect(budget.scale).toBeLessThanOrEqual(MAX_LOAD_SCALE);
            expect(budget.timeout).toBeGreaterThan(0);
            expect(budget.expectTimeout).toBeGreaterThan(0);
        });

        it('rounds to whole seconds so the logged line reads cleanly', () => {
            const budget = timeoutBudget({ env: {}, load: 3, cpuCount: 32 });
            expect(budget.timeout % 1000).toBe(0);
            expect(budget.expectTimeout % 1000).toBe(0);
        });
    });

    describe('describeBudget', () => {
        it('names the scale and both timeouts in seconds', () => {
            const line = describeBudget(timeoutBudget({ env: {}, load: 0, cpuCount: 32 }));
            expect(line).toContain('1.00x');
            expect(line).toContain(`test ${BASE_TEST_TIMEOUT_MS / 1000}s`);
            expect(line).toContain(`expect ${BASE_EXPECT_TIMEOUT_MS / 1000}s`);
        });
    });

    // . A hosted runner is not CONTENDED, it is small and slow, and
    // load average cannot tell those apart: one Playwright worker on a 4-core
    // runner scores about 1.0x, so the suite handed its tightest budget to its
    // slowest machine and `e2e` came back 2 failed / 8 flaky on waits that pay
    // an Argon2id derivation.
    describe('the CI floor', () => {
        // The exact shape of the runner: idle by load average, and therefore
        // scored 1.0x by the contention model on its own.
        const IDLE_RUNNER = { load: 0.2, cpuCount: 4 };

        it('scores an idle runner near 1x WITHOUT the floor, which is the bug', () => {
            // 0.2 over 4 cores is 0.05 per core against a 0.35 saturation
            // point, so the contention model reads this machine as almost
            // completely unloaded - which it is. It is just slow, and that is
            // the thing this model cannot see.
            const measured = loadScale({ ...IDLE_RUNNER, ci: false });
            expect(measured).toBeLessThan(1.2);
            expect(measured).toBeLessThan(CI_MIN_SCALE);
        });

        it('floors the scale on CI instead', () => {
            expect(loadScale({ ...IDLE_RUNNER, ci: true })).toBe(CI_MIN_SCALE);
        });

        it('never LOWERS a genuinely contended box to the floor', () => {
            const busy = { load: 32, cpuCount: 32, ci: true };
            expect(loadScale(busy)).toBeGreaterThanOrEqual(CI_MIN_SCALE);
            expect(loadScale(busy)).toBe(MAX_LOAD_SCALE);
        });

        it('still lets an explicit override win, so a CI failure can be reproduced at 1x', () => {
            expect(loadScale({ ...IDLE_RUNNER, ci: true, override: '1' })).toBe(1);
        });

        it('reads CI from the environment', () => {
            const onCi = timeoutBudget({ env: { CI: 'true' }, ...IDLE_RUNNER });
            const offCi = timeoutBudget({ env: {}, ...IDLE_RUNNER });
            expect(onCi.scale).toBe(CI_MIN_SCALE);
            expect(offCi.scale).toBeLessThan(CI_MIN_SCALE);
        });
    });

    describe('the KDF step budget', () => {
        it('scales with everything else rather than being sized by hand', () => {
            expect(kdfStepTimeout({ env: { CI: 'true' }, load: 0.2, cpuCount: 4 }))
                .toBe(BASE_KDF_STEP_TIMEOUT_MS * CI_MIN_SCALE);
            expect(kdfStepTimeout({ env: {}, load: 0, cpuCount: 32 }))
                .toBe(BASE_KDF_STEP_TIMEOUT_MS);
        });

        it('stays under the test ceiling, so a wedged unlock fails on its own assertion', () => {
            // Otherwise the test timeout fires first and the failure names the
            // test rather than the step, one line further up the stack.
            expect(BASE_KDF_STEP_TIMEOUT_MS).toBeLessThan(BASE_TEST_TIMEOUT_MS);
            const ci = timeoutBudget({ env: { CI: 'true' }, load: 0.2, cpuCount: 4 });
            expect(ci.kdfStepTimeout).toBeLessThan(ci.timeout);
        });

        it('gives the runner more than the hand-written 90s that failed', () => {
            const ci = timeoutBudget({ env: { CI: 'true' }, load: 0.2, cpuCount: 4 });
            expect(ci.kdfStepTimeout).toBeGreaterThan(90_000);
        });
    });
});
