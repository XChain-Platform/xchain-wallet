// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression ( / F4): COINPAY must re-derive the obligation at sign time.
//
// A COINPAY carries a native-coin output paying `payeeAddress` `coinAmount`.
// Both values were fetched by an indexer query, hydrated into form state, and
// handed back down to the signing flow, which trusted them. Anything that could
// alter them in between - a compromised renderer, a stale draft, a caller
// passing its own values - got a signed, broadcast payment of real coin to an
// address of its choosing, on a review screen that agreed with itself.
//
// coinpayAction now re-reads the obligation and refuses on any disagreement.

import { describe, it, expect } from 'vitest';
import { coinpayAction } from '../../../packages/core/src/flows/coinpayAction.js';
import { verifyCoinpayObligation } from '../../../packages/core/src/flows/coinpayQueries.js';

const PAYER = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';       // BTC testnet
const PAYEE = 'n2eMqTT929pb1RDNuqEnxdaLau1rxy3efi';       // BTC testnet
const ATTACKER = 'mzBc4XEFSdzCDcTxAgf6EZXgsZWpztRhef';    // BTC testnet
const AMOUNT = 250000;

const OBLIGATION = {
    action_index: '4242',
    payer_address: PAYER,
    payee_address: PAYEE,
    coin_amount: AMOUNT,
    coinpay_status: 'pending_coinpay',
    expiration: 900000,
};

// Returns an sdkRegistry whose obligation row can be overridden per-test.
function fakeSdkRegistry(row = OBLIGATION, { envelope = 'bare' } = {}) {
    const rows = row === null ? [] : [row];
    const resp = envelope === 'bare' ? rows : { data: rows };
    return {
        get: () => ({
            getCoinpayObligations: async () => resp,
        }),
    };
}

const chainRegistry = {
    get: () => ({ id: 'bitcoin-testnet', coin: 'bitcoin', networkKind: 'testnet' }),
};

// coinpayAction's opts. vault/walletId are stubs: every test here must fail
// during verification, BEFORE any signing machinery is reached. If a test ever
// gets past the guard it will die on the stub vault instead, and the assertion
// on the message text will catch that.
const baseOpts = {
    vault: {},
    walletId: 'w1',
    password: 'pw',
    chainRegistry,
    chainId: 'bitcoin-testnet',
    from: {
        address: PAYER,
        publicKey: '02'.padEnd(66, 'a'),
        derivationPath: "m/44'/1'/0'/0/0",
    },
    orderMatchActionIndex: '4242',
    payeeAddress: PAYEE,
    coinAmount: AMOUNT,
};

describe('coinpayAction: refuses to sign an unverified payment', () => {
    it('rejects a swapped payee (the attack this closes)', async () => {
        const err = await coinpayAction({
            ...baseOpts,
            sdkRegistry: fakeSdkRegistry(),
            payeeAddress: ATTACKER,          // tampered after the obligation was fetched
        }).catch((e) => e);
        expect(err.message).toMatch(/payee mismatch for ORDER_MATCH #4242/);
        // The error names both addresses, so the mismatch is diagnosable.
        expect(err.message).toContain(PAYEE);
        expect(err.message).toContain(ATTACKER);
    });

    it('rejects an inflated amount', async () => {
        await expect(coinpayAction({
            ...baseOpts,
            sdkRegistry: fakeSdkRegistry(),
            coinAmount: AMOUNT * 100,
        })).rejects.toThrow(/obligation owes 250000 base units, asked to sign 25000000/);
    });

    it('rejects an underpayment', async () => {
        await expect(coinpayAction({
            ...baseOpts,
            sdkRegistry: fakeSdkRegistry(),
            coinAmount: 1,
        })).rejects.toThrow(/amount mismatch/);
    });

    it('rejects an obligation that does not exist', async () => {
        await expect(coinpayAction({
            ...baseOpts,
            sdkRegistry: fakeSdkRegistry(null),
        })).rejects.toThrow(/no COINPAY obligation for ORDER_MATCH #4242/);
    });

    it('rejects paying an already-fulfilled obligation', async () => {
        await expect(coinpayAction({
            ...baseOpts,
            sdkRegistry: fakeSdkRegistry({ ...OBLIGATION, coinpay_status: 'fulfilled' }),
        })).rejects.toThrow(/is "fulfilled", not pending/);
    });

    it('rejects paying an expired obligation', async () => {
        await expect(coinpayAction({
            ...baseOpts,
            sdkRegistry: fakeSdkRegistry({ ...OBLIGATION, coinpay_status: 'expired' }),
        })).rejects.toThrow(/is "expired", not pending/);
    });

    it("rejects an obligation owed by somebody else's address", async () => {
        await expect(coinpayAction({
            ...baseOpts,
            sdkRegistry: fakeSdkRegistry({ ...OBLIGATION, payer_address: ATTACKER }),
        })).rejects.toThrow(/is owed by .* not by/);
    });

    it('rejects a malformed payee even when the obligation agrees', async () => {
        // A payee the obligation itself vouches for, but which no chain can pay:
        // the output would be unspendable and the coin lost.
        await expect(coinpayAction({
            ...baseOpts,
            sdkRegistry: fakeSdkRegistry({ ...OBLIGATION, payee_address: 'not-an-address' }),
            payeeAddress: 'not-an-address',
        })).rejects.toThrow(/coinpayAction: "not-an-address" is not a valid bitcoin testnet address/);
    });
});

describe('verifyCoinpayObligation: accepts the honest payment', () => {
    it('returns the obligation row when everything agrees', async () => {
        const row = await verifyCoinpayObligation({
            sdkRegistry: fakeSdkRegistry(),
            chainId: 'bitcoin-testnet',
            payerAddress: PAYER,
            orderMatchActionIndex: '4242',
            payeeAddress: PAYEE,
            coinAmount: AMOUNT,
        });
        expect(row.payee_address).toBe(PAYEE);
        expect(row.coin_amount).toBe(AMOUNT);
    });

    it('reads the row through a wrapped response envelope too', async () => {
        // The verifier fails closed on zero rows, so mis-reading a legitimate
        // envelope would block real payments. Cover the wrapped shape.
        const row = await verifyCoinpayObligation({
            sdkRegistry: fakeSdkRegistry(OBLIGATION, { envelope: 'wrapped' }),
            chainId: 'bitcoin-testnet',
            payerAddress: PAYER,
            orderMatchActionIndex: '4242',
            payeeAddress: PAYEE,
            coinAmount: AMOUNT,
        });
        expect(row.action_index).toBe('4242');
    });

    it('tolerates a numeric action_index from the explorer', async () => {
        const row = await verifyCoinpayObligation({
            sdkRegistry: fakeSdkRegistry({ ...OBLIGATION, action_index: 4242 }),
            chainId: 'bitcoin-testnet',
            payerAddress: PAYER,
            orderMatchActionIndex: '4242',
            payeeAddress: PAYEE,
            coinAmount: AMOUNT,
        });
        expect(row.coin_amount).toBe(AMOUNT);
    });
});
