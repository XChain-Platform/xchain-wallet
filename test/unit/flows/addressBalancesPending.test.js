// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { addressBalances } from '../../../packages/core/src/flows/balances.js';

const CHAIN_ID = 'bitcoin-regtest';
const SOURCE = 'bcrt1qsource';

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

function vaultWith(pending) {
    return { pendingTxs: { list: async () => pending } };
}

const sent = {
    chain: 'bitcoin',
    network: 'regtest',
    fromAddress: SOURCE,
    status: 'broadcast',
    nativeDebitSats: '75000000',
    balanceDebits: [{ tick: 'BTC', amount: '0.75' }],
};

describe('addressBalances nets unconfirmed sends', () => {
    it('subtracts a broadcast send from the single-address read', async () => {
        const shape = await addressBalances({
            sdkRegistry, chainRegistry, chainId: CHAIN_ID, address: SOURCE, vault: vaultWith([sent]),
        });
        expect(String(shape.native.quantity)).toBe('925000000');
    });

    it('leaves the read alone for a terminal or indexed send', async () => {
        const shape = await addressBalances({
            sdkRegistry, chainRegistry, chainId: CHAIN_ID, address: SOURCE,
            vault: vaultWith([{ ...sent, status: 'indexed' }, { ...sent, status: 'failed' }]),
        });
        expect(String(shape.native.quantity)).toBe('1000000000');
    });

    it('survives an unreadable pending list', async () => {
        const vault = { pendingTxs: { list: async () => { throw new Error('locked'); } } };
        const shape = await addressBalances({
            sdkRegistry, chainRegistry, chainId: CHAIN_ID, address: SOURCE, vault,
        });
        expect(String(shape.native.quantity)).toBe('1000000000');
    });
});
