// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// orderAction / cancelOrder / editOrder must name the funding address, not
// just the pubkey. Third instance of the same fault (sendToken,
// dispenserAction D-43), and the most expensive of the three: an ORDER holds
// the seller's tokens in escrow, and CANCEL is the only way to get them back
// before the expiration - which defaults to ninety days.
//
// The SDK says `change` is "deliberately NOT a fallback" for `sourceAddress`
// (xchain-sdk/src/encoder.js createTx), and these three supplied NEITHER, so
// the encoder resolved UTXOs from the raw public key and answered
// "Error getting utxos: <pubkey> has no matching Script".
//
// Why it stayed latent: the CREATE lane composes through the confirm screen,
// which hands down a prebuilt PSBT and skips `createTx` entirely. Cancel and
// edit have no confirm screen at all, so they always build live - and neither
// had ever been driven against a chain until the campaign's DEX ORDER lane
// spec (test/e2e/tests/dex/order-lifecycle.regtest.spec.js), which found it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'order-tx-1' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { orderAction, cancelOrder, editOrder } from '../../../packages/core/src/flows/orderAction.js';

const FROM = {
    address: 'rltc1qseller',
    publicKey: '0375d452',
    derivationPath: "m/84'/1'/0'/0/0",
};

function opts(extra) {
    return {
        vault: {},
        walletId: 'w1',
        password: 'pw',
        chainRegistry: { get: () => ({ nativeTicker: 'LTC' }) },
        sdkRegistry: {},
        chainId: 'litecoin-regtest',
        from: FROM,
        ...extra,
    };
}

/** A token-for-native-coin order: the shape that actually escrows. */
const CREATE = {
    VERSION: '0',
    GIVE_COIN: 'LTC',
    GIVE_TICK: 'XCHAIN',
    GIVE_AMOUNT: '100',
    GET_COIN: 'LTC',
    GET_TICK: '',
    GET_AMOUNT: '0.5',
};

const encoderOptsOfLastCall = () => vi.mocked(submitAction).mock.calls[0][0].encoderOpts;

describe('the ORDER flows name the funding address for UTXO selection', () => {
    beforeEach(() => { vi.mocked(submitAction).mockClear(); });

    it('[REGRESSION] cancel passes sourceAddress', async () => {
        await cancelOrder(opts({ orderActionIndex: '1395' }));
        expect(encoderOptsOfLastCall().sourceAddress).toBe(FROM.address);
    });

    it('[REGRESSION] edit passes sourceAddress', async () => {
        await editOrder(opts({ orderActionIndex: '1395', params: { EXPIRATION: '1900000000' } }));
        expect(encoderOptsOfLastCall().sourceAddress).toBe(FROM.address);
    });

    // The create lane is normally rescued by the confirm screen's prebuilt
    // PSBT, but watcher mode and any caller that submits without one build
    // live, so it must carry the address on its own.
    it('[REGRESSION] create passes sourceAddress even though the confirm screen usually hides the need', async () => {
        await orderAction(opts({ params: CREATE }));
        expect(encoderOptsOfLastCall().sourceAddress).toBe(FROM.address);
    });

    it('supplies change as well, which is a separate concern (the change sink)', async () => {
        await cancelOrder(opts({ orderActionIndex: '1395' }));
        expect(encoderOptsOfLastCall().change).toBe(FROM.address);
    });

    it('keeps sending the pubkey the encoder signs against', async () => {
        await cancelOrder(opts({ orderActionIndex: '1395' }));
        expect(encoderOptsOfLastCall().pubkey).toBe(FROM.publicKey);
    });
});
