// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An order or swap cancel is invisible to the explorer until it confirms and
// indexes: the cancels feed and the action detail both still say open. My
// orders in a second side panel, or the same list opened again after Done,
// offers Cancel on it, and the pre-sign re-read passes. The second cancel, or
// an edit of the same offer, indexes invalid and keeps its fee. The signing
// flow refuses while this wallet holds an in-flight cancel for the same offer
// on the same network, before anything is signed.

import { describe, it, expect } from 'vitest';
import { cancelOrder, editOrder } from '../../../packages/core/src/flows/orderAction.js';
import { swapAction } from '../../../packages/core/src/flows/swapAction.js';
import { OFFER_LIFECYCLE_REFUSAL } from '../../../packages/core/src/flows/marketExpiry.js';

const OWNER = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';

const chainRegistry = {
    get: () => ({ id: 'bitcoin-testnet', coin: 'bitcoin', networkKind: 'testnet' }),
    validateAddress: () => true,
};
// No getAction: the lifecycle re-read has nothing to say, as while a cancel is unconfirmed.
const sdkRegistry = { get: () => ({}) };

function pending(overrides = {}) {
    return {
        id: 'p1',
        chain: 'bitcoin',
        network: 'testnet',
        action: 'ORDER',
        actionSummary: 'Cancel order #4242',
        fromAddress: OWNER,
        toAddress: null,
        status: 'broadcast',
        ...overrides,
    };
}

function base(rows) {
    return {
        // Past the guard the stub vault has no settings or signing machinery,
        // so a call that is not refused dies later with an unrelated error.
        vault: { pendingTxs: { list: async () => rows } },
        walletId: 'w1',
        password: 'pw',
        chainRegistry,
        sdkRegistry,
        chainId: 'bitcoin-testnet',
        from: { address: OWNER, publicKey: '02'.padEnd(66, 'a'), derivationPath: "m/44'/1'/0'/0/0" },
    };
}

const cancel = (rows, idx = '4242') => cancelOrder({ ...base(rows), orderActionIndex: idx }).catch((e) => e);
const edit = (rows, idx = '4242') => editOrder({ ...base(rows), orderActionIndex: idx, params: { EXPIRATION: '4102444800' } }).catch((e) => e);
const swap = (rows, version, idx = '777') => swapAction({
    ...base(rows),
    params: { VERSION: version, SWAP_ACTION_INDEX: idx, ...(version === '2' ? { EXPIRATION: '4102444800' } : {}) },
}).catch((e) => e);

const ON_ITS_WAY = /already on its way|has a cancel on its way/;

describe('a second cancel of an order or swap is refused while the first is in flight', () => {
    for (const status of ['signed', 'queued', 'broadcasting', 'broadcast']) {
        it(`refuses an order cancel while the earlier cancel is ${status}`, async () => {
            const err = await cancel([pending({ status })]);
            expect(err?.name).toBe(OFFER_LIFECYCLE_REFUSAL);
            expect(err?.message).toMatch(/A cancel for this order is already on its way/);
            expect(err?.message).toMatch(/Nothing was signed/);
        });
    }

    it('refuses an edit of an order whose cancel is in flight', async () => {
        const err = await edit([pending()]);
        expect(err?.name).toBe(OFFER_LIFECYCLE_REFUSAL);
        expect(err?.message).toMatch(/This order has a cancel on its way/);
    });

    it('refuses a swap cancel and a swap edit while a cancel of that swap is in flight', async () => {
        const row = pending({ action: 'SWAP', actionSummary: 'Cancel swap #777' });
        for (const version of ['1', '2']) {
            const err = await swap([row], version);
            expect(err?.name).toBe(OFFER_LIFECYCLE_REFUSAL);
            expect(err?.message).toMatch(ON_ITS_WAY);
        }
    });

    it('matches a params snapshot as well as the summary', async () => {
        const err = await cancel([pending({ actionSummary: 'Order', params: { VERSION: '1', ORDER_ACTION_INDEX: '4242' } })]);
        expect(err?.message).toMatch(ON_ITS_WAY);
    });

    it('does not refuse for a failed, dropped or indexed cancel, another offer, an edit, or another network', async () => {
        const rows = [
            pending({ status: 'failed' }),
            pending({ status: 'dropped' }),
            pending({ status: 'indexed' }),
            pending({ actionSummary: 'Cancel order #42420' }),
            pending({ actionSummary: 'Edit order #4242' }),
            pending({ network: 'mainnet' }),
            pending({ chain: 'litecoin' }),
            pending({ action: 'SWAP', actionSummary: 'Cancel swap #4242' }),
        ];
        const err = await cancel(rows);
        expect(err?.message || '').not.toMatch(ON_ITS_WAY);
        expect(err?.name).not.toBe(OFFER_LIFECYCLE_REFUSAL);
    });

    it('does not refuse when the pending list cannot be read', async () => {
        const opts = { ...base([]), orderActionIndex: '4242' };
        opts.vault = { pendingTxs: { list: async () => { throw new Error('storage'); } } };
        const err = await cancelOrder(opts).catch((e) => e);
        expect(err?.message || '').not.toMatch(ON_ITS_WAY);
    });
});
