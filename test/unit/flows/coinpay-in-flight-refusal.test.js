// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A COINPAY reads `pending_coinpay` until it confirms and indexes, so Payments
// due keeps offering Pay for a match whose payment is already on its way, and a
// second review (another window, or the same one after a lock) passes the
// obligation re-read. Paying it again sends the coin a second time and settles
// nothing. The flow refuses while this wallet holds an in-flight COINPAY for
// the same match on the same network.

import { describe, it, expect } from 'vitest';
import {
    buildCoinpayPsbtRequest,
    coinpayAction,
} from '../../../packages/core/src/flows/coinpayAction.js';
import { OFFER_LIFECYCLE_REFUSAL } from '../../../packages/core/src/flows/marketExpiry.js';

const PAYER = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';
const PAYEE = 'n2eMqTT929pb1RDNuqEnxdaLau1rxy3efi';
const OTHER = 'mzBc4XEFSdzCDcTxAgf6EZXgsZWpztRhef';

const OBLIGATION = {
    action_index: '4242',
    payer_address: PAYER,
    payee_address: PAYEE,
    coin_amount: '0.0025',
    coinpay_status: 'pending_coinpay',
    expiration: 4_102_444_800,
};

function sdkRegistry() {
    return {
        get: () => ({
            getCoinpayObligations: async () => [OBLIGATION],
            actions: { createAction: () => ({ actionString: 'COINPAY|0|4242' }) },
            encoder: { createTx: async () => ({ psbt: 'deadbeef', encoding: 'opreturn' }) },
        }),
    };
}

const chainRegistry = {
    get: () => ({ id: 'bitcoin-testnet', coin: 'bitcoin', networkKind: 'testnet' }),
    validateAddress: () => true,
};

function pending(overrides = {}) {
    return {
        id: 'p1',
        chain: 'bitcoin',
        network: 'testnet',
        action: 'COINPAY',
        actionSummary: 'Pay 0.0025 BTC for match #4242',
        fromAddress: PAYER,
        toAddress: PAYEE,
        status: 'broadcast',
        ...overrides,
    };
}

function opts(rows) {
    return {
        // Past the guard the stub vault has no signing machinery, so a call
        // that is not refused dies later with an unrelated error.
        vault: { pendingTxs: { list: async () => rows } },
        walletId: 'w1',
        password: 'pw',
        chainRegistry,
        sdkRegistry: sdkRegistry(),
        chainId: 'bitcoin-testnet',
        from: { address: PAYER, publicKey: '02'.padEnd(66, 'a'), derivationPath: "m/44'/1'/0'/0/0" },
        orderMatchActionIndex: '4242',
        payeeAddress: PAYEE,
        coinAmount: 250000,
    };
}

const IN_FLIGHT = /already on its way/;

describe('COINPAY: a match with a payment in flight is not paid again', () => {
    for (const status of ['signed', 'queued', 'broadcasting', 'broadcast']) {
        it(`refuses while the earlier payment is ${status}`, async () => {
            const err = await coinpayAction(opts([pending({ status })])).catch((e) => e);
            expect(err?.name).toBe(OFFER_LIFECYCLE_REFUSAL);
            expect(err?.message).toMatch(IN_FLIGHT);
            expect(err?.message).toMatch(/Nothing was sent/);
        });
    }

    it('refuses on the air-gapped build path too', async () => {
        const err = await buildCoinpayPsbtRequest(opts([pending()])).catch((e) => e);
        expect(err?.message).toMatch(IN_FLIGHT);
    });

    it('refuses a same-network match when its source metadata differs', async () => {
        const err = await coinpayAction(opts([pending({ fromAddress: OTHER })])).catch((e) => e);
        expect(err?.message).toMatch(IN_FLIGHT);
    });

    it('matches the auto-pay summary wording and a params snapshot', async () => {
        const auto = pending({ actionSummary: 'Auto-paid match #4242 for order #77' });
        const snap = pending({ actionSummary: 'Pay', params: { ORDER_MATCH_ACTION_INDEX: '4242' } });
        for (const row of [auto, snap]) {
            const err = await coinpayAction(opts([row])).catch((e) => e);
            expect(err?.message).toMatch(IN_FLIGHT);
        }
    });

    it('does not refuse for a failed earlier payment, another match, or another network', async () => {
        const rows = [
            pending({ status: 'failed' }),
            pending({ status: 'dropped' }),
            pending({ actionSummary: 'Pay 0.0025 BTC for match #42420' }),
            pending({ network: 'mainnet', fromAddress: OTHER }),
            pending({ chain: 'litecoin', fromAddress: OTHER }),
            pending({ action: 'SEND' }),
        ];
        const err = await coinpayAction(opts(rows)).catch((e) => e);
        expect(err?.message || '').not.toMatch(IN_FLIGHT);
    });

    it('does not refuse when the pending list cannot be read', async () => {
        const o = opts([]);
        o.vault = { pendingTxs: { list: async () => { throw new Error('locked'); } } };
        const err = await coinpayAction(o).catch((e) => e);
        expect(err?.message || '').not.toMatch(IN_FLIGHT);
    });
});
