// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  P8 BET read passthroughs backing BetFeedsList (market browser),
// BetFeedDetail (market + pools + timeline), MyBets and the oracle console.

import { describe, it, expect, vi } from 'vitest';
import {
    betFeedsForChain,
    betFeedDetail,
    betsForQuery,
    oracleStats,
    projectBetPayout,
    betPoolAmounts,
} from '../../../packages/core/src/flows/betQueries.js';

function fakeRegistry(sdk) {
    return { get: vi.fn(() => sdk) };
}

describe('BET query passthroughs', () => {
    it('betFeedsForChain with no filter lists every market on the chain', async () => {
        const sdk = { getBetFeeds: vi.fn(async () => ({ data: [] })) };
        await betFeedsForChain({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', opts: { limit: 50 } });
        expect(sdk.getBetFeeds).toHaveBeenCalledWith(null, null, { limit: 50 });
    });

    it('betFeedsForChain filters on the STORED feed status', async () => {
        const sdk = { getBetFeeds: vi.fn(async () => ({ data: [] })) };
        await betFeedsForChain({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', query: 'open', type: 'status' });
        // Filtering server-side on the stored status is what keeps the wallet's
        // idea of "still taking bets" identical to the chain's.
        expect(sdk.getBetFeeds).toHaveBeenCalledWith('open', 'status', undefined);
    });

    it('betFeedDetail fetches one market by its creating action_index', async () => {
        const sdk = { getBetFeed: vi.fn(async () => ({ data: [{ action_index: '2343' }] })) };
        await betFeedDetail({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', feedIndex: 2343 });
        expect(sdk.getBetFeed).toHaveBeenCalledWith(2343, undefined);
    });

    it('betsForQuery scopes to one market with type=feed', async () => {
        const sdk = { getBets: vi.fn(async () => ({ data: [] })) };
        await betsForQuery({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', query: '2343', type: 'feed' });
        expect(sdk.getBets).toHaveBeenCalledWith('2343', 'feed', undefined);
    });

    it('betsForQuery scopes to one bettor with type=address', async () => {
        const sdk = { getBets: vi.fn(async () => ({ data: [] })) };
        await betsForQuery({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', query: 'addr-1', type: 'address' });
        expect(sdk.getBets).toHaveBeenCalledWith('addr-1', 'address', undefined);
    });

    it('oracleStats fetches one address record', async () => {
        const sdk = { getOracleStats: vi.fn(async () => ({ total_feeds: 1 })) };
        await oracleStats({ sdkRegistry: fakeRegistry(sdk), chainId: 'c', address: 'addr-1' });
        expect(sdk.getOracleStats).toHaveBeenCalledWith('addr-1', undefined);
    });

    it('each validates its required args', async () => {
        const sdk = {
            getBetFeeds: vi.fn(), getBetFeed: vi.fn(), getBets: vi.fn(), getOracleStats: vi.fn(),
        };
        const reg = fakeRegistry(sdk);
        await expect(betFeedsForChain({ chainId: 'c' })).rejects.toThrow(/sdkRegistry is required/);
        await expect(betFeedsForChain({ sdkRegistry: reg })).rejects.toThrow(/chainId is required/);
        await expect(betFeedDetail({ sdkRegistry: reg, chainId: 'c' })).rejects.toThrow(/feedIndex is required/);
        await expect(oracleStats({ sdkRegistry: reg, chainId: 'c' })).rejects.toThrow(/address is required/);
    });

    it('reports a missing chain rather than throwing on undefined', async () => {
        const reg = { get: vi.fn(() => null) };
        await expect(betFeedsForChain({ sdkRegistry: reg, chainId: 'nope' })).rejects.toThrow(/no SDK for chain nope/);
    });

    it('reports an SDK that predates the BET read surface', async () => {
        // An older vendored SDK is a real deployment state, and the failure should
        // name the missing method rather than surfacing as "x is not a function".
        const reg = fakeRegistry({});
        await expect(betFeedsForChain({ sdkRegistry: reg, chainId: 'c' })).rejects.toThrow(/sdk.getBetFeeds is unavailable/);
        await expect(betFeedDetail({ sdkRegistry: reg, chainId: 'c', feedIndex: 1 })).rejects.toThrow(/sdk.getBetFeed is unavailable/);
        await expect(betsForQuery({ sdkRegistry: reg, chainId: 'c' })).rejects.toThrow(/sdk.getBets is unavailable/);
        await expect(oracleStats({ sdkRegistry: reg, chainId: 'c', address: 'a' })).rejects.toThrow(/sdk.getOracleStats is unavailable/);
    });
});

// . The projection is the ONE number a parimutuel bettor decides on, and it
// reached the screen as nothing at all: BetFeedDetail forwarded the explorer's
// pool ROWS straight into payout math that indexes amounts BY outcome. Both ways
// that fails are silent, so these tests pin the shape rather than the arithmetic.
describe('projectBetPayout pool normalization', () => {
    // The explorer's getBetFeedPools is a GROUP BY outcome: rows, in outcome
    // order, and ONLY for outcomes that already carry an open bet.
    const EXPLORER_ROWS = Object.freeze([
        { outcome: 0, bet_count: 3, pool: '300.00000000' },
    ]);

    function projectingSdk() {
        return { betting: { projectPayout: vi.fn(async () => ({ payout: '1.0', profit: '0.0' })) } };
    }

    it('keys the explorer rows by outcome instead of forwarding them', async () => {
        const sdk = projectingSdk();
        await projectBetPayout({
            sdkRegistry: fakeRegistry(sdk), chainId: 'c',
            pools: EXPLORER_ROWS, outcomeCount: 2, outcome: 0, stake: '100', feePct: '1.00',
        });
        const arg = sdk.betting.projectPayout.mock.calls[0][0];
        // Rows forwarded unchanged stringify to "[object Object]" inside the
        // bignumber parse, which throws where the UI can only swallow it.
        expect(arg.pools).toEqual(['300.00000000', '0']);
        expect(arg.outcome).toBe(0);
        expect(arg.stake).toBe('100');
        expect(arg.feePct).toBe('1.00');
    });

    it('projects for an outcome nobody has backed yet, which is the reported bug', async () => {
        // The exact D-97 case: a 300-token pool on outcome 0, the user selects the
        // opposing outcome 1. Unnormalized, index 1 sits past the end of a
        // one-row list and the SDK rejects it as out of range.
        const sdk = projectingSdk();
        const out = await projectBetPayout({
            sdkRegistry: fakeRegistry(sdk), chainId: 'c',
            pools: EXPLORER_ROWS, outcomeCount: 2, outcome: 1, stake: '100',
        });
        expect(sdk.betting.projectPayout.mock.calls[0][0].pools).toEqual(['300.00000000', '0']);
        expect(out).toEqual({ payout: '1.0', profit: '0.0' });
    });

    it('reaches the backed outcome even when the market outcome count is unknown', async () => {
        const sdk = projectingSdk();
        await projectBetPayout({
            sdkRegistry: fakeRegistry(sdk), chainId: 'c',
            pools: [], outcome: 2, stake: '5',
        });
        expect(sdk.betting.projectPayout.mock.calls[0][0].pools).toEqual(['0', '0', '0']);
    });

    it('leaves the SDK range check meaningful for an outcome off the end of the market', async () => {
        // A declared count is authoritative: outcome 7 of a 2-outcome market must
        // still reach the SDK as out of range rather than be padded into legality.
        const sdk = projectingSdk();
        await projectBetPayout({
            sdkRegistry: fakeRegistry(sdk), chainId: 'c',
            pools: EXPLORER_ROWS, outcomeCount: 2, outcome: 7, stake: '5',
        });
        expect(sdk.betting.projectPayout.mock.calls[0][0].pools).toHaveLength(2);
    });

    it('omits feePct and decimals rather than passing null through', async () => {
        const sdk = projectingSdk();
        await projectBetPayout({
            sdkRegistry: fakeRegistry(sdk), chainId: 'c',
            pools: EXPLORER_ROWS, outcomeCount: 2, outcome: 0, stake: '1', feePct: null, decimals: null,
        });
        const arg = sdk.betting.projectPayout.mock.calls[0][0];
        expect('feePct' in arg).toBe(false);
        expect('decimals' in arg).toBe(false);
    });

    it('names the missing method on an SDK that predates the projection', async () => {
        await expect(projectBetPayout({ sdkRegistry: fakeRegistry({}), chainId: 'c', pools: [], outcome: 0, stake: '1' }))
            .rejects.toThrow(/sdk.betting.projectPayout is unavailable/);
    });
});

describe('betPoolAmounts', () => {
    it('passes a dense amount list through untouched', () => {
        // The SDK's own callers already hand it one; re-keying by a non-existent
        // `outcome` field would zero the whole thing out.
        expect(betPoolAmounts(['10', '20'], 2)).toEqual(['10', '20']);
    });

    it('fills gaps between non-contiguous outcomes', () => {
        const rows = [{ outcome: 0, pool: '5' }, { outcome: 3, pool: '7' }];
        expect(betPoolAmounts(rows, 4)).toEqual(['5', '0', '0', '7']);
    });

    it('reads a null or absent pool as zero rather than as NaN downstream', () => {
        expect(betPoolAmounts([{ outcome: 0, pool: null }, { outcome: 1 }], 2)).toEqual(['0', '0']);
    });

    it('grows to the declared outcome count and never shrinks below the rows', () => {
        expect(betPoolAmounts([{ outcome: 0, pool: '1' }], 3)).toEqual(['1', '0', '0']);
        expect(betPoolAmounts([{ outcome: 4, pool: '1' }], 2)).toHaveLength(5);
    });

    it('survives a missing or non-array pools field', () => {
        expect(betPoolAmounts(undefined, 2)).toEqual(['0', '0']);
        expect(betPoolAmounts(null, 0)).toEqual([]);
    });

    it('ignores a row with an unusable outcome index instead of misplacing it', () => {
        const rows = [{ outcome: 'x', pool: '9' }, { outcome: -1, pool: '9' }, { outcome: 1, pool: '4' }];
        expect(betPoolAmounts(rows, 2)).toEqual(['0', '4']);
    });
});
