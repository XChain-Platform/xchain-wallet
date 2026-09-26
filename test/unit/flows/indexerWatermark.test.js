// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §28.3 "Indexed" timeline stage. `indexerWatermark` reads
// the explorer /status report and returns the latest block the indexer has
// processed for the chain's coin. It prefers the SDK's own coin prefix,
// falls back to the highest last_block across coins when the prefix is
// unavailable, and degrades to `watermark: null` (never throws) when the
// status call is unsupported or the field is missing.

import { describe, it, expect } from 'vitest';
import { indexerWatermark, chainTipBlockTime } from '../../../packages/core/src/flows/balances.js';

// Registry whose single SDK exposes getStatus() + explorer.coin. Pass
// `status` for the resolved /status body, `coin` for the explorer prefix
// (null to drop it), and `getStatus: false` for an SDK that can't report.
function makeRegistry({ status, coin = 'RBTC', getStatus } = {}) {
    const sdk = {
        explorer: coin === null ? {} : { coin },
        getStatus: getStatus === false
            ? undefined
            : async () => (typeof status === 'function' ? status() : status),
    };
    return { get: () => sdk };
}

describe('indexerWatermark', () => {
    it('requires sdkRegistry and chainId', async () => {
        await expect(indexerWatermark({ chainId: 'bitcoin-regtest' }))
            .rejects.toThrow(/sdkRegistry is required/);
        await expect(indexerWatermark({ sdkRegistry: makeRegistry() }))
            .rejects.toThrow(/chainId is required/);
    });

    it('returns the last_block value for the SDK coin prefix', async () => {
        const registry = makeRegistry({
            coin: 'RBTC',
            status: { last_block: { RBTC: 512, RLTC: 999 } },
        });
        const r = await indexerWatermark({ sdkRegistry: registry, chainId: 'bitcoin-regtest' });
        expect(r).toEqual({ chainId: 'bitcoin-regtest', watermark: 512 });
    });

    it('falls back to the highest last_block when the coin prefix is unknown', async () => {
        const registry = makeRegistry({
            coin: null,
            status: { last_block: { RLTC: 700, RDOGE: 1234 } },
        });
        const r = await indexerWatermark({ sdkRegistry: registry, chainId: 'litecoin-regtest' });
        expect(r.watermark).toBe(1234);
    });

    it('falls back to the max when the coin prefix key is missing/null', async () => {
        const registry = makeRegistry({
            coin: 'RBTC',
            status: { last_block: { RBTC: null, RLTC: 42 } },
        });
        const r = await indexerWatermark({ sdkRegistry: registry, chainId: 'bitcoin-regtest' });
        expect(r.watermark).toBe(42);
    });

    it('returns null watermark when the SDK has no getStatus', async () => {
        const registry = makeRegistry({ getStatus: false });
        const r = await indexerWatermark({ sdkRegistry: registry, chainId: 'bitcoin-regtest' });
        expect(r).toEqual({ chainId: 'bitcoin-regtest', watermark: null });
    });

    it('returns null watermark when last_block is absent', async () => {
        const registry = makeRegistry({ status: { supported: {} } });
        const r = await indexerWatermark({ sdkRegistry: registry, chainId: 'bitcoin-regtest' });
        expect(r.watermark).toBeNull();
    });

    it('returns null watermark when last_block has no finite values', async () => {
        const registry = makeRegistry({ status: { last_block: { RBTC: null, RLTC: undefined } } });
        const r = await indexerWatermark({ sdkRegistry: registry, chainId: 'bitcoin-regtest' });
        expect(r.watermark).toBeNull();
    });
});

// PC-42: `chainTipBlockTime` reads the SAME /status report for
// `last_block_time`, the quantity every timestamp-gated flag-day is measured
// against. It deliberately does NOT share indexerWatermark's cross-coin
// fallback: a higher block index from a sibling coin is a safe lower bound for
// "indexed", but a sibling's TIMESTAMP would be a claim about a different
// chain's flag-day progress.
describe('chainTipBlockTime', () => {
    it('returns this chain\'s own coin block time', async () => {
        const registry = makeRegistry({
            status: { last_block_time: { RBTC: 1785117499, RDOGE: 1784302383 } },
            coin: 'RBTC',
        });
        await expect(chainTipBlockTime({ sdkRegistry: registry, chainId: 'bitcoin-regtest' }))
            .resolves.toEqual({ chainId: 'bitcoin-regtest', blockTime: 1785117499 });
    });

    it('never borrows a sibling coin\'s timestamp', async () => {
        const registry = makeRegistry({
            status: { last_block_time: { RDOGE: 1784302383 } },
            coin: 'RBTC',
        });
        const res = await chainTipBlockTime({ sdkRegistry: registry, chainId: 'bitcoin-regtest' });
        expect(res.blockTime).toBeNull();
    });

    it('degrades to null rather than throwing on every gap', async () => {
        const cases = [
            makeRegistry({ getStatus: false }),
            makeRegistry({ status: {} }),
            makeRegistry({ status: { last_block_time: null } }),
            makeRegistry({ status: { last_block_time: { RBTC: null } } }),
            makeRegistry({ status: { last_block_time: { RBTC: 'soon' } } }),
            makeRegistry({ status: { last_block_time: { RBTC: 1 } }, coin: null }),
            { get: () => { throw new Error('no sdk for chain'); } },
            makeRegistry({ status: () => { throw new Error('explorer down'); } }),
        ];
        for (const sdkRegistry of cases) {
            const res = await chainTipBlockTime({ sdkRegistry, chainId: 'bitcoin-regtest' });
            expect(res).toEqual({ chainId: 'bitcoin-regtest', blockTime: null });
        }
    });

    it('still guards its required inputs', async () => {
        await expect(chainTipBlockTime({ chainId: 'bitcoin-regtest' })).rejects.toThrow(/sdkRegistry/);
        await expect(chainTipBlockTime({ sdkRegistry: makeRegistry({}) })).rejects.toThrow(/chainId/);
    });
});

// With `withProtocolTime`, the read also returns the time the indexer will
// date the next block by. On testnet that is the median of the newest eleven
// block stamps, which trails the tip's own stamp; elsewhere it is null.
describe('chainTipBlockTime withProtocolTime', () => {
    // The newest eleven TLTC block stamps, tip first.
    const TLTC_STAMPS = [
        1790460068, 1790459694, 1790459332, 1790459031, 1790458728, 1790458382,
        1790458068, 1790457767, 1790457411, 1790457009, 1790456634,
    ];
    const blocksPage = (stamps, tip = 4901902) => ({
        data: stamps.map((t, i) => ({ block_index: String(tip - i), timestamp: String(t), actions: {} })),
    });

    function makeTestnetRegistry({ blocks, coin = 'TLTC' } = {}) {
        const calls = [];
        const sdk = {
            explorer: {
                coin,
                get: async (path, opts) => {
                    calls.push({ path, opts });
                    return typeof blocks === 'function' ? blocks() : blocks;
                },
            },
            getStatus: async () => ({ last_block_time: { [coin]: TLTC_STAMPS[0] } }),
        };
        return { registry: { get: () => sdk }, calls };
    }

    it('returns the median of the newest eleven block stamps on testnet', async () => {
        const { registry, calls } = makeTestnetRegistry({ blocks: blocksPage(TLTC_STAMPS) });
        const res = await chainTipBlockTime({ sdkRegistry: registry, chainId: 'litecoin-testnet', withProtocolTime: true });
        expect(res).toEqual({ chainId: 'litecoin-testnet', blockTime: 1790460068, protocolTime: 1790458382 });
        expect(calls).toEqual([{ path: '/blocks', opts: { limit: 11, noRetry: true } }]);
    });

    it('makes no blocks read and returns null on networks dated by their own stamps', async () => {
        for (const chainId of ['litecoin-mainnet', 'litecoin-regtest']) {
            const { registry, calls } = makeTestnetRegistry({ blocks: blocksPage(TLTC_STAMPS) });
            const res = await chainTipBlockTime({ sdkRegistry: registry, chainId, withProtocolTime: true });
            expect(res.protocolTime).toBeNull();
            expect(calls).toEqual([]);
        }
    });

    it('returns null for a short, gapped or failed blocks read', async () => {
        const gapped = blocksPage(TLTC_STAMPS);
        gapped.data[10].block_index = '4901880';
        const cases = [
            blocksPage(TLTC_STAMPS.slice(0, 10)),
            gapped,
            { data: null },
            () => { throw new Error('explorer down'); },
        ];
        for (const blocks of cases) {
            const { registry } = makeTestnetRegistry({ blocks });
            const res = await chainTipBlockTime({ sdkRegistry: registry, chainId: 'litecoin-testnet', withProtocolTime: true });
            expect(res.protocolTime).toBeNull();
            expect(res.blockTime).toBe(1790460068);
        }
    });

    it('leaves the default result shape unchanged', async () => {
        const { registry, calls } = makeTestnetRegistry({ blocks: blocksPage(TLTC_STAMPS) });
        const res = await chainTipBlockTime({ sdkRegistry: registry, chainId: 'litecoin-testnet' });
        expect(res).toEqual({ chainId: 'litecoin-testnet', blockTime: 1790460068 });
        expect(calls).toEqual([]);
    });
});
