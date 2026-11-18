// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The tracker books a confirmed coin the mempool is spending as still confirmed
// and takes its value off `pending`, so `pending` is a signed net. A spend this
// wallet has no record of (another device, a restored vault, a lost record)
// shows up only there. The spendable figure must come down by it, once, and
// never on top of a local debit that already describes the same spend.

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

function sdkWith(balances) {
    return {
        get: () => ({
            getBalances: async () => [],
            getAddress: async () => ({ address: SOURCE, balances }),
        }),
    };
}

const read = (balances, pendingTxs = []) => addressBalances({
    sdkRegistry: sdkWith(balances),
    chainRegistry,
    chainId: CHAIN_ID,
    address: SOURCE,
    vault: { pendingTxs: { list: async () => pendingTxs } },
});

const localSend = {
    chain: 'bitcoin',
    network: 'regtest',
    fromAddress: SOURCE,
    status: 'broadcast',
    txid: 'bb'.repeat(32),
    nativeDebitSats: '75000000',
};

describe('addressBalances with a spend the wallet has no record of', () => {
    it('takes a negative tracker pending off the spendable figure', async () => {
        const shape = await read({ confirmed: '10', pending: '-0.50000000' });
        expect(String(shape.native.quantity)).toBe('950000000');
    });

    it('does not surface the negative pending as an incoming amount or leak its marker', async () => {
        const shape = await read({ confirmed: '10', pending: '-0.50000000' });
        expect(shape.native.pendingQuantity).toBeUndefined();
        expect(shape.native).not.toHaveProperty('pendingOutgoingQuantity');
    });

    it('leaves a positive pending as an incoming amount and the confirmed figure whole', async () => {
        const shape = await read({ confirmed: '10', pending: '0.25000000' });
        expect(String(shape.native.quantity)).toBe('1000000000');
        expect(String(shape.native.pendingQuantity)).toBe('25000000');
    });

    it('nets a recorded local send once, ignoring the tracker figure for the same spend', async () => {
        const shape = await read({ confirmed: '10', pending: '-0.75000000' }, [localSend]);
        expect(String(shape.native.quantity)).toBe('925000000');
    });

    it('rounds a sub-satoshi outgoing figure up so Home never shows more than can be spent', async () => {
        const shape = await read({ confirmed: '1', pending: '-0.000000001' });
        expect(String(shape.native.quantity)).toBe('99999999');
    });
});
