// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The `token.supplyHistory` host route behind TokenDetail's supply chart,
// driven through the real host. The chart reads a `data` list of
// { height, supply } points, so the route has to hand the folded series back
// in that shape; a route that returned the flow's bare `points` would leave
// the chart hidden on every shell.

import { describe, it, expect } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const CHAIN = 'bitcoin-regtest';

function makeHost(sdk) {
    const calls = [];
    const host = createBackgroundHost({
        vault: {
            wallets: { list: async () => [], get: async () => null },
            settings: { get: async () => ({ schemaVersion: 2 }), put: async () => {} },
        },
        chainRegistry: {
            get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }),
            list: () => [],
            chainIdFor: () => CHAIN,
        },
        sdkRegistry: { get: (chainId) => { calls.push(chainId); return sdk; }, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: { load: async () => ({}), save: async () => {}, clear: async () => {} },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { calls, call: (type, request) => host.handle({ type, request }) };
}

describe('token.supplyHistory', () => {
    it('returns the folded series under data, each point carrying its block as height', async () => {
        const sdk = {
            getIssues: async () => ({ data: [{ block_index: 10, tx_index: 0, mint_supply: '100' }] }),
            getMints: async () => ({ data: [{ block_index: 12, tx_index: 1, amount: '50' }] }),
            getDestroys: async () => ({ data: [{ block_index: 15, tx_index: 0, amount: '20' }] }),
            getToken: async () => ({ supply: { current: '130' } }),
        };
        const h = makeHost(sdk);
        const res = await h.call('token.supplyHistory', { chainId: CHAIN, tick: 'SUPPLYPROBE' });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(h.calls).toEqual([CHAIN]);
        expect(res.result.data.map((p) => [p.height, p.supply])).toEqual([[10, '100'], [12, '150'], [15, '130']]);
        expect(res.result.reconciled).toBe(true);
    });

    it('refuses a request with no tick instead of answering an empty series', async () => {
        const h = makeHost({});
        const res = await h.call('token.supplyHistory', { chainId: CHAIN });
        expect(res.ok).toBe(false);
    });
});
