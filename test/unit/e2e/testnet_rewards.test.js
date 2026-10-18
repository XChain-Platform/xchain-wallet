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

function fetchRows(rewards, claims) {
    return vi.fn(async (url) => response(url.includes('/rewards/') ? rewards : claims));
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
        ['bare arrays', (rows) => rows],
        ['data arrays', (rows) => ({ data: rows })],
        ['rows arrays', (rows) => ({ rows })],
    ])('reads rewards and claims from %s', async (_label, wrap) => {
        const fetch = fetchRows(
            wrap([{ amount: '1.5' }]),
            wrap([{ amount: '0.25', status: 'valid' }]),
        );

        await expect(unclaimedReward(ADDRESS, { ...OPTIONS, fetch })).resolves.toBe(1.25);
        expect(fetch.mock.calls.map(([url]) => url)).toEqual([
            `${OPTIONS.explorerUrl}/${OPTIONS.coin}/api/rewards/${ADDRESS}/address`,
            `${OPTIONS.explorerUrl}/${OPTIONS.coin}/api/collects/${ADDRESS}/address`,
        ]);
    });

    it('throws when an explorer answer is not successful', async () => {
        const fetch = vi.fn(async () => response([], { ok: false, status: 503 }));

        await expect(unclaimedReward(ADDRESS, { ...OPTIONS, fetch }))
            .rejects.toThrow('explorer reward request returned HTTP 503');
    });

    it('refuses a claimant with no partial reward available', async () => {
        const fetch = fetchRows([], []);

        await expect(preflightClaimantReward(input(), { ...OPTIONS, fetch }))
            .rejects.toThrow(/^Claimant reward preflight refused: reward seen 0 /);
    });

    it.each([
        ['at', '1.5'],
        ['above', '1.50000001'],
    ])('refuses a requested amount %s the reward', async (_label, amount) => {
        const fetch = fetchRows([{ amount: '1.5' }], []);

        await expect(preflightClaimantReward(input(amount), { ...OPTIONS, fetch }))
            .rejects.toThrow(/^Claimant reward preflight refused: reward seen 1.5;/);
    });

    it('passes a valid requested amount below the reward', async () => {
        const fetch = fetchRows([{ amount: '1.5' }], []);

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
        const fetch = fetchRows([{ amount: '0.00000001' }], []);
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
