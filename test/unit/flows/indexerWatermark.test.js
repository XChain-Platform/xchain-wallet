// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit:  / §28.3 "Indexed" timeline stage. `indexerWatermark` reads
// the explorer /status report and returns the latest block the indexer has
// processed for the chain's coin. It prefers the SDK's own coin prefix,
// falls back to the highest last_block across coins when the prefix is
// unavailable, and degrades to `watermark: null` (never throws) when the
// status call is unsupported or the field is missing.

import { describe, it, expect } from 'vitest';
import { indexerWatermark } from '../../../packages/core/src/flows/balances.js';

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
