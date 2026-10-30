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
import { preflightRunInputKeys } from '../../e2e/fixtures/testnet_keys.js';

const { WalletUtils } = xchainSdk;

function generatedKey(wallet, type) {
    const key = wallet.generateKeyPair();
    const address = wallet.deriveAddress(key.publicKey, { type });
    if (Buffer.isBuffer(key.privateKey)) key.privateKey.fill(0);
    return { wif: key.wif, address };
}

function fixture() {
    const wallet = new WalletUtils('bitcoin-testnet');
    return {
        wallet,
        treasury: generatedKey(wallet, 'p2wpkh'),
        claimant: generatedKey(wallet, 'p2pkh'),
        stranger: generatedKey(wallet, 'p2wpkh'),
    };
}

function refusal(input, wallet) {
    try {
        preflightRunInputKeys(input, { wallet });
    } catch (error) {
        return error;
    }
    throw new Error('expected key preflight to refuse');
}

describe('testnet run-input key preflight', () => {
    it('accepts a matching p2wpkh treasury and p2pkh claimant', () => {
        const { wallet, treasury, claimant } = fixture();

        expect(() => preflightRunInputKeys({ ...treasury, claimant }, { wallet })).not.toThrow();
    });

    it('also accepts a matching p2wpkh claimant', () => {
        const { wallet, treasury } = fixture();

        expect(() => preflightRunInputKeys({ ...treasury, claimant: treasury }, { wallet })).not.toThrow();
    });

    it('refuses a treasury address derived from another key without exposing input', () => {
        const { wallet, treasury, claimant, stranger } = fixture();
        const input = { ...treasury, address: stranger.address, claimant };
        const error = refusal(input, wallet);

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/^Key preflight refused.*treasury/i);
        for (const secret of [input.wif, input.address, input.claimant.wif, input.claimant.address]) {
            expect(error.message).not.toContain(secret);
        }
    });

    it('refuses a claimant address derived from another key without exposing input', () => {
        const { wallet, treasury, claimant, stranger } = fixture();
        const input = { ...treasury, claimant: { ...claimant, address: stranger.address } };
        const error = refusal(input, wallet);

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/^Key preflight refused.*claimant/i);
        for (const secret of [input.wif, input.address, input.claimant.wif, input.claimant.address]) {
            expect(error.message).not.toContain(secret);
        }
    });

    it('refuses a claimant address of neither supported type', () => {
        const { wallet, treasury, claimant } = fixture();
        const error = refusal({
            ...treasury,
            claimant: { ...claimant, address: 'not-a-testnet-address' },
        }, wallet);

        expect(error.message).toMatch(/^Key preflight refused.*claimant/i);
    });

    it('allows an absent claimant for the run-input preflight to diagnose', () => {
        const { wallet, treasury } = fixture();

        expect(() => preflightRunInputKeys(treasury, { wallet })).not.toThrow();
    });

    it('refuses instead of skipping when the supplied wallet cannot validate', () => {
        const { treasury, claimant } = fixture();

        expect(() => preflightRunInputKeys({ ...treasury, claimant }, { wallet: {} }))
            .toThrow(/^Key preflight refused.*treasury/i);
    });

    it('proves both present keys through the supplied wallet', () => {
        const { wallet, treasury, claimant } = fixture();
        const imported = [];
        const spy = {
            importWIF: (wif) => {
                imported.push(wif);
                return wallet.importWIF(wif);
            },
            deriveAddress: (publicKey, options) => wallet.deriveAddress(publicKey, options),
        };

        preflightRunInputKeys({ ...treasury, claimant }, { wallet: spy });

        expect(imported).toEqual([treasury.wif, claimant.wif]);
    });
});
