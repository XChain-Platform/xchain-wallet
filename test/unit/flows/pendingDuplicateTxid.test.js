// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Signing an identical payment again after an ambiguous broadcast leaves two
// pending records with the same txid. The network holds one spend, so the
// balance nets it once.

import { describe, expect, it } from 'vitest';
import { addressBalances } from '../../../packages/core/src/flows/balances.js';
import { unconfirmedPendingDeltas } from '../../../packages/core/src/flows/pendingDeltas.js';

const CHAIN_ID = 'bitcoin-regtest';
const SOURCE = 'bcrt1qsource';
const TXID = 'ab'.repeat(32);

const chainRegistry = {
    chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'regtest' ? CHAIN_ID : null),
    descriptorFor: (chainId) => (
        chainId === CHAIN_ID ? { id: CHAIN_ID, coin: 'bitcoin', networkKind: 'regtest' } : null
    ),
    get(chainId) { return this.descriptorFor(chainId); },
};
const sdkRegistry = {
    get: () => ({
        getBalances: async () => [],
        getAddress: async () => ({ address: SOURCE, balances: { confirmed: '10' } }),
    }),
};

const record = (id, extra = {}) => ({
    id,
    chain: 'bitcoin',
    network: 'regtest',
    fromAddress: SOURCE,
    status: 'queued',
    txid: TXID,
    tick: 'BTC',
    amount: '0.75',
    nativeDebitSats: '75000990',
    balanceDebits: [{ tick: 'BTC', amount: '0.75' }],
    ...extra,
});

describe('two pending records for one txid', () => {
    it('net the balance once', async () => {
        const vault = { pendingTxs: { list: async () => [record('p1'), record('p2')] } };
        const shape = await addressBalances({
            sdkRegistry, chainRegistry, chainId: CHAIN_ID, address: SOURCE, vault,
        });
        expect(String(shape.native.quantity)).toBe('924999010');
    });

    it('net the concurrent pre-flight once', () => {
        const deltas = unconfirmedPendingDeltas(
            [record('p1'), record('p2')],
            { coin: 'bitcoin', network: 'regtest', source: SOURCE },
        );
        expect(deltas).toEqual([{ tick: 'BTC', amount: '0.75' }]);
    });

    it('still net two different transactions separately', async () => {
        const vault = { pendingTxs: { list: async () => [record('p1'), record('p2', { txid: 'cd'.repeat(32) })] } };
        const shape = await addressBalances({
            sdkRegistry, chainRegistry, chainId: CHAIN_ID, address: SOURCE, vault,
        });
        expect(String(shape.native.quantity)).toBe('849998020');
    });
});
