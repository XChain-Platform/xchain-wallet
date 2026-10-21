// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import { describe, expect, it } from 'vitest';
import xchainSdk from 'xchain-sdk';
import { TESTNET_CHAIN_ID } from '../../e2e/fixtures/testnet.js';
import { preflightRunInputKeys } from '../../e2e/fixtures/testnet_keys.js';

const TREASURY = Object.freeze({
    wif: 'cS9nRNmyK8RA5QC7MQAAErJSgR5kmD7mRjpn1TaiDnLqFn4jj3SF',
    address: 'tb1qz2qzsfp5g3g2ez6k4z4x56vuzs3uh3hehhq469',
});
const STRANGER_ADDRESS = 'tb1qzz55z44a8g0er7wtr4ylk74wwcxpve3z63e0tn';

const wallet = new xchainSdk.WalletUtils(TESTNET_CHAIN_ID);
const legacy = wallet.deriveAddress(wallet.importWIF(TREASURY.wif).publicKey, { type: 'p2pkh' });

function input(overrides = {}) {
    return { ...TREASURY, claimant: { wif: TREASURY.wif, address: legacy }, ...overrides };
}

describe('testnet key preflight', () => {
    it('accepts a treasury and a claimant that own their declared addresses', () => {
        expect(preflightRunInputKeys(input())).toBeUndefined();
        expect(() => preflightRunInputKeys(input({ claimant: TREASURY }))).not.toThrow();
    });

    it('refuses a treasury key that does not derive its address, naming the role', () => {
        expect(() => preflightRunInputKeys(input({ address: STRANGER_ADDRESS })))
            .toThrow(/Key preflight refused: treasury: KEY\/ADDRESS MISMATCH/);
    });

    it('refuses a claimant key that does not derive its address, even when the treasury is sound', () => {
        expect(() => preflightRunInputKeys(input({ claimant: { wif: TREASURY.wif, address: STRANGER_ADDRESS } })))
            .toThrow(/Key preflight refused: claimant: KEY\/ADDRESS MISMATCH/);
    });

    it('refuses a claimant address of an unsupported type', () => {
        expect(() => preflightRunInputKeys(input({ claimant: { wif: TREASURY.wif, address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' } })))
            .toThrow(/Key preflight refused: claimant: .*neither/);
    });

    it('proves both keys through the wallet it is given', () => {
        const seen = [];
        const spy = {
            importWIF: (wif) => { seen.push(wif); return wallet.importWIF(wif); },
            deriveAddress: (pub, opts) => wallet.deriveAddress(pub, opts),
        };
        preflightRunInputKeys(input(), spy);
        expect(seen).toHaveLength(2);
    });

    it('never echoes a key in its refusal', () => {
        let message = '';
        try {
            preflightRunInputKeys(input({ address: STRANGER_ADDRESS }));
        } catch (err) {
            message = err.message;
        }
        expect(message).not.toContain(TREASURY.wif);
    });
});
