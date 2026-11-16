// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi } from 'vitest';
import {
    FILE_FUNDING_NOT_CONFIRMED,
    fundingMayBeOnChain,
    waitForFundingConfirmed,
} from '../../../packages/core/src/flows/multipartFundingWait.js';

const TXID = 'ab'.repeat(32);
const ADDRESS = 'funding-source';

function scriptedSdk(states) {
    let reading = 0;
    const state = () => states[Math.min(reading, states.length - 1)];
    return {
        encoder: {
            getTxBlock: vi.fn(async () => {
                if (state() === 'confirmed') {
                    reading += 1;
                    return { block_hash: 'block', block_height: 42 };
                }
                if (state() === 'unknown') throw new Error('block unavailable');
                return null;
            }),
            getUTXOs: vi.fn(async () => {
                if (state() === 'mempool') {
                    reading += 1;
                    return [{ txid: TXID, confirmations: 0 }];
                }
                if (state() === 'unknown') throw new Error('utxos unavailable');
                return [];
            }),
        },
        getUnconfirmed: vi.fn(async () => {
            const current = state();
            reading += 1;
            if (current === 'unknown') throw new Error('mempool unavailable');
            return [];
        }),
    };
}

function fakeClock() {
    let current = 0;
    return {
        now: vi.fn(() => current),
        sleep: vi.fn(async (ms) => { current += ms; }),
    };
}

function waitArgs(states, options = {}) {
    const clock = fakeClock();
    return {
        clock,
        args: {
            sdk: scriptedSdk(states),
            txid: TXID,
            address: ADDRESS,
            timeoutMs: 100,
            pollMs: 25,
            sleep: clock.sleep,
            now: clock.now,
            ...options,
        },
    };
}

describe('funding confirmation success', () => {
    it('returns from a first confirmed reading without sleeping', async () => {
        const { args, clock } = waitArgs(['confirmed']);
        await expect(waitForFundingConfirmed(args)).resolves.toEqual({ txid: TXID, chainState: 'confirmed' });
        expect(clock.sleep).not.toHaveBeenCalled();
    });

    it('waits through the mempool and then returns confirmed', async () => {
        const { args, clock } = waitArgs(['mempool', 'confirmed']);
        await expect(waitForFundingConfirmed(args)).resolves.toEqual({ txid: TXID, chainState: 'confirmed' });
        expect(clock.sleep).toHaveBeenCalledTimes(1);
        expect(clock.sleep).toHaveBeenCalledWith(25);
    });

    it('does not treat one dropped reading as a verdict', async () => {
        const { args, clock } = waitArgs(['dropped', 'confirmed']);
        await expect(waitForFundingConfirmed(args)).resolves.toEqual({ txid: TXID, chainState: 'confirmed' });
        expect(clock.sleep).toHaveBeenCalledTimes(1);
    });
});

describe('funding confirmation failures', () => {
    it('ends after two consecutive dropped readings', async () => {
        const { args, clock } = waitArgs(['dropped', 'dropped']);
        await expect(waitForFundingConfirmed(args)).rejects.toMatchObject({
            code: FILE_FUNDING_NOT_CONFIRMED, chainState: 'dropped', txid: TXID,
        });
        expect(clock.sleep).toHaveBeenCalledTimes(1);
    });

    it('reports the last mempool reading after the timeout', async () => {
        const { args, clock } = waitArgs(['mempool'], { timeoutMs: 50, pollMs: 25 });
        await expect(waitForFundingConfirmed(args)).rejects.toMatchObject({
            code: FILE_FUNDING_NOT_CONFIRMED, chainState: 'mempool', txid: TXID,
        });
        expect(clock.sleep).toHaveBeenCalledTimes(2);
    });

    it('ends at once as unknown when there is no read surface', async () => {
        const clock = fakeClock();
        const args = {
            sdk: {}, txid: TXID, address: ADDRESS, timeoutMs: 100,
            pollMs: 25, sleep: clock.sleep, now: clock.now,
        };
        const error = await waitForFundingConfirmed(args).catch((err) => err);
        expect(error).toMatchObject({ code: FILE_FUNDING_NOT_CONFIRMED, chainState: 'unknown', txid: TXID });
        expect(error.message).toMatch(/upload is saved/i);
        expect(error.message).toMatch(/do not pay again/i);
        expect(clock.sleep).not.toHaveBeenCalled();
    });
});

describe('funding wait progress', () => {
    it('reports state and injected elapsed time while waiting', async () => {
        const onWait = vi.fn();
        const { args } = waitArgs(['mempool', 'confirmed'], { onWait });
        await waitForFundingConfirmed(args);
        expect(onWait).toHaveBeenCalledWith({ chainState: 'mempool', waitedMs: 0 });
    });

    it('ignores a throwing progress listener', async () => {
        const onWait = vi.fn(() => { throw new Error('listener failed'); });
        const { args } = waitArgs(['mempool', 'confirmed'], { onWait });
        await expect(waitForFundingConfirmed(args)).resolves.toMatchObject({ chainState: 'confirmed' });
        expect(onWait).toHaveBeenCalledTimes(1);
    });

    it('does not schedule a real timer', async () => {
        const timer = vi.spyOn(globalThis, 'setTimeout');
        const { args } = waitArgs(['mempool', 'confirmed']);
        await waitForFundingConfirmed(args);
        expect(timer).not.toHaveBeenCalled();
        timer.mockRestore();
    });
});

describe('funding wait validation', () => {
    it.each([
        ['txid', { txid: 'not-a-txid' }],
        ['timeoutMs', { timeoutMs: 0 }],
        ['timeoutMs', { timeoutMs: Infinity }],
        ['pollMs', { pollMs: 0 }],
        ['pollMs', { pollMs: Number.NaN }],
        ['sleep', { sleep: null }],
        ['now', { now: null }],
    ])('refuses an invalid %s', async (field, override) => {
        const { args } = waitArgs(['confirmed'], override);
        await expect(waitForFundingConfirmed(args)).rejects.toMatchObject({
            code: 'FILE_FUNDING_WAIT_INVALID', message: expect.stringContaining(field),
        });
    });
});

describe('fundingMayBeOnChain', () => {
    it('is true for every funding wait state except dropped', () => {
        for (const chainState of ['confirmed', 'mempool', 'unknown']) {
            expect(fundingMayBeOnChain({ code: FILE_FUNDING_NOT_CONFIRMED, chainState })).toBe(true);
        }
        expect(fundingMayBeOnChain({ code: FILE_FUNDING_NOT_CONFIRMED, chainState: 'dropped' })).toBe(false);
    });

    it('is false for a foreign error', () => {
        expect(fundingMayBeOnChain(new Error('other'))).toBe(false);
    });
});
