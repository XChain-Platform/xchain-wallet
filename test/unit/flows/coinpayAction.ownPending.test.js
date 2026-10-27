// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The explorer lists a COINPAY obligation as pending until the payment
// confirms. A payment this vault already signed or broadcast for the same
// match must stop a second one, which the protocol would burn.

import { describe, it, expect } from 'vitest';
import {
    buildCoinpayPsbtRequest,
    coinpayAction,
} from '../../../packages/core/src/flows/coinpayAction.js';

const PAYER = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';
const PAYEE = 'n2eMqTT929pb1RDNuqEnxdaLau1rxy3efi';
const OTHER = 'mzBc4XEFSdzCDcTxAgf6EZXgsZWpztRhef';

const OBLIGATION = {
    action_index: '4242',
    payer_address: PAYER,
    payee_address: PAYEE,
    coin_amount: '0.0025',
    coinpay_status: 'pending_coinpay',
    expiration: 900000,
};

const sdkRegistry = {
    get: () => ({
        getCoinpayObligations: async () => [OBLIGATION],
        actions: { createAction: () => ({ actionString: 'COINPAY|0|4242' }) },
        encoder: { createTx: async () => ({ psbt: 'deadbeef', encoding: 'opreturn' }) },
    }),
};
const chainRegistry = {
    get: () => ({ id: 'bitcoin-testnet', coin: 'bitcoin', networkKind: 'testnet' }),
};

function opts(pendingTxs) {
    return {
        vault: { pendingTxs: { list: async () => pendingTxs } },
        walletId: 'w1',
        password: 'pw',
        chainRegistry,
        sdkRegistry,
        chainId: 'bitcoin-testnet',
        from: { address: PAYER, publicKey: '02'.padEnd(66, 'a'), derivationPath: "m/44'/1'/0'/0/0" },
        orderMatchActionIndex: '4242',
        payeeAddress: PAYEE,
        coinAmount: 250000,
    };
}

const inFlight = (over = {}) => ({
    action: 'COINPAY',
    status: 'broadcast',
    fromAddress: PAYER,
    actionSummary: 'Pay 0.0025 BTC for match #4242',
    ...over,
});

describe('coinpayAction: a payment already in flight stops a second one', () => {
    it.each(['signed', 'queued', 'broadcasting', 'broadcast', 'indexed'])(
        'refuses while the earlier payment is %s',
        async (status) => {
            await expect(coinpayAction(opts([inFlight({ status })])))
                .rejects.toThrow(/already in flight/);
        },
    );

    it('refuses the watcher PSBT build too', async () => {
        await expect(buildCoinpayPsbtRequest(opts([inFlight()])))
            .rejects.toThrow(/already in flight/);
    });

    it('matches on the params snapshot when the summary differs', async () => {
        await expect(coinpayAction(opts([inFlight({
            actionSummary: 'something else', params: { ORDER_MATCH_ACTION_INDEX: '4242' },
        })]))).rejects.toThrow(/already in flight/);
    });

    it('ignores a failed earlier payment, another match and another payer', async () => {
        for (const tx of [
            inFlight({ status: 'failed' }),
            inFlight({ actionSummary: 'Pay 0.0025 BTC for match #42420' }),
            inFlight({ fromAddress: OTHER }),
        ]) {
            const err = await coinpayAction(opts([tx])).catch((e) => e);
            expect(err.message).not.toMatch(/already in flight/);
        }
    });
});
