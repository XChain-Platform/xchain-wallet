// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
    claimAmount,
    partialAmount,
    preflightClaimantReward,
    rewardTotal,
    unclaimedReward,
} from '../../e2e/fixtures/testnet_rewards.js';

const ADDRESS = 'claimant-address';
const OPTIONS = Object.freeze({
    explorerUrl: 'https://explorer.invalid',
    coin: 'COIN',
});

function response(body, { ok = true, status = 200 } = {}) {
    return { ok, status, json: vi.fn(async () => body) };
}

function fetchClaimable(claimable) {
    return vi.fn(async () => response({ claimable }));
}

function input(amount) {
    return {
        claimant: {
            address: ADDRESS,
            wif: 'claimant-private-key',
            ...(amount === undefined ? {} : { amount }),
        },
    };
}

describe('testnet claimant rewards', () => {
    it('subtracts valid claims from accrued rewards and ignores invalid claims', () => {
        const total = rewardTotal(
            [{ amount: '2.25' }, { amount: 0.75 }],
            [
                { amount: '0.5', status: 'valid' },
                { amount: '2', status: 'invalid' },
                { amount: '0.25', status: 'VALID' },
            ],
        );

        expect(total).toBe(2.25);
    });

    it.each([
        ['a bare object', { claimable: '1.25000000' }],
        ['an envelope with array data', { total: 1, data: [{ claimable: '1.25000000' }] }],
        ['an envelope with object data', { total: 1, data: { claimable: '1.25000000' } }],
    ])('reads claimable from %s', async (_label, body) => {
        const fetch = vi.fn(async () => response(body));

        await expect(unclaimedReward(ADDRESS, { ...OPTIONS, fetch })).resolves.toBe(1.25);
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledWith(
            `${OPTIONS.explorerUrl}/${OPTIONS.coin}/api/staking/${ADDRESS}`,
            { signal: expect.any(AbortSignal) },
        );
    });

    it('throws when an explorer answer is not successful', async () => {
        const fetch = vi.fn(async () => response([], { ok: false, status: 503 }));

        await expect(unclaimedReward(ADDRESS, { ...OPTIONS, fetch }))
            .rejects.toThrow('explorer reward request returned HTTP 503');
    });

    it('uses a non-sensitive error when the explorer answer does not parse', async () => {
        const parseMessage = 'body contained private diagnostics';
        const fetch = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: vi.fn(async () => { throw new Error(parseMessage); }),
        }));

        let refusal;
        try {
            await unclaimedReward(ADDRESS, { ...OPTIONS, fetch });
        } catch (error) {
            refusal = error;
        }

        expect(refusal).toBeInstanceOf(Error);
        expect(refusal.message).toBe('Claimant reward read failed: no claimable total');
        expect(refusal.message).not.toContain(parseMessage);
        expect(refusal.message).not.toContain(ADDRESS);
    });

    it('uses a non-sensitive error when the explorer answer has no claimable total', async () => {
        const bodyMessage = 'private explorer response';
        const fetch = vi.fn(async () => response({ message: bodyMessage }));

        let refusal;
        try {
            await unclaimedReward(ADDRESS, { ...OPTIONS, fetch });
        } catch (error) {
            refusal = error;
        }

        expect(refusal).toBeInstanceOf(Error);
        expect(refusal.message).toBe('Claimant reward read failed: no claimable total');
        expect(refusal.message).not.toContain(bodyMessage);
        expect(refusal.message).not.toContain(ADDRESS);
    });

    it.each([
        ['zero', '0.00000000'],
        ['negative', '-0.25000000'],
    ])('refuses a claimant with a %s claimable total', async (_label, claimable) => {
        const fetch = fetchClaimable(claimable);

        await expect(preflightClaimantReward(input(), { ...OPTIONS, fetch }))
            .rejects.toThrow(/^Claimant reward preflight refused: reward seen /);
    });

    it.each([
        ['at', '1.5'],
        ['above', '1.50000001'],
    ])('refuses a requested amount %s the reward', async (_label, amount) => {
        const fetch = fetchClaimable('1.50000000');

        await expect(preflightClaimantReward(input(amount), { ...OPTIONS, fetch }))
            .rejects.toThrow(/^Claimant reward preflight refused: reward seen 1.5;/);
    });

    it('passes a valid requested amount below the reward', async () => {
        const fetch = fetchClaimable('1.50000000');

        await expect(preflightClaimantReward(input('0.75'), { ...OPTIONS, fetch }))
            .resolves.toBe(1.5);
    });

    it('halves only whole satoshis', () => {
        expect(partialAmount(0.00000003)).toBe('0.00000001');
        expect(partialAmount(1.00000001)).toBe('0.5');
        expect(claimAmount(0.00000003)).toBe('0.00000001');
    });

    it('does not expose the claimant address in refusal messages', async () => {
        const address = 'private-claimant-address';
        const fetch = fetchClaimable('0.00000001');
        let refusal;

        try {
            await preflightClaimantReward({ claimant: { address } }, { ...OPTIONS, fetch });
        } catch (error) {
            refusal = error;
        }

        expect(refusal).toBeInstanceOf(Error);
        expect(refusal.message).toMatch(/^Claimant reward preflight refused/);
        expect(refusal.message).not.toContain(address);
    });
});
