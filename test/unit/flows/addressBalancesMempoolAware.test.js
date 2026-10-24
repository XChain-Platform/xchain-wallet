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

// The tracker reports a coin that the mempool is spending as still confirmed and
// books the spend in `pending` as a signed net (inputs out, change in). The
// spendable quantity is therefore the confirmed figure less the local debit,
// once, however the explorer's own pending field reads.
function sdkWith(addressBody) {
    return { get: () => ({ getBalances: async () => [], getAddress: async () => addressBody }) };
}

const sent = {
    chain: 'bitcoin',
    network: 'regtest',
    fromAddress: SOURCE,
    status: 'broadcast',
    txid: 'aa'.repeat(32),
    nativeDebitSats: '75000000',
    balanceDebits: [{ tick: 'BTC', amount: '0.75' }],
};

const vault = { pendingTxs: { list: async () => [sent] } };

describe('addressBalances against a mempool-aware explorer', () => {
    it('deducts an unconfirmed spend once when the explorer books it as negative pending', async () => {
        const shape = await addressBalances({
            sdkRegistry: sdkWith({ address: SOURCE, balances: { confirmed: '10', pending: '-7.5' } }),
            chainRegistry, chainId: CHAIN_ID, address: SOURCE, vault,
        });
        expect(String(shape.native.quantity)).toBe('925000000');
    });

    it('never surfaces a negative pending figure as incoming coins', async () => {
        const shape = await addressBalances({
            sdkRegistry: sdkWith({ address: SOURCE, balances: { confirmed: '10', pending: '-7.5' } }),
            chainRegistry, chainId: CHAIN_ID, address: SOURCE, vault,
        });
        const pending = shape.native.pendingQuantity;
        expect(pending == null || BigInt(pending) <= 0n).toBe(true);
    });
});
