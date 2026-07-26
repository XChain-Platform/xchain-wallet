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
