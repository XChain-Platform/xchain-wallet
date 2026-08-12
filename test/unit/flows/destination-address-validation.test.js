// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: SEND / SWEEP must not build a PSBT for a destination
// that isn't a valid address on the chain being broadcast to.
//
// Before this, the only destination check was a leading-character guess in
// Send.jsx, which (a) does no checksum, so any typo preserving the first letter
// passed, (b) cannot tell mainnet from testnet on the shared 'm'/'n'/'2'
// leaders, and (c) lived in the UI, so the dApp bridge - which calls sendToken /
// sweepToken directly with site-supplied params - had no check at all. Every one
// of those produces an unspendable output: the tokens are simply gone.

import { describe, it, expect } from 'vitest';
import { isValidAddressForChain } from '../../../packages/core/src/shared/utils/addressValidation.js';
import { sendToken } from '../../../packages/core/src/flows/sendToken.js';
import { sweepToken } from '../../../packages/core/src/flows/sweepToken.js';

// Real addresses (no keys, structure only) for checksum-true fixtures.
const BTC_MAINNET_P2PKH = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const BTC_MAINNET_BECH32 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const LTC_MAINNET_P2PKH = 'LM2WMpR1Rp6j3Sa59cMXMs1SPzj9eXpGc1';
const DOGE_MAINNET_P2PKH = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';
const BTC_TESTNET_P2PKH = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';

const chainRegistry = {
    get: (id) => ({
        'bitcoin-mainnet': { id, coin: 'bitcoin', networkKind: 'mainnet' },
        'bitcoin-testnet': { id, coin: 'bitcoin', networkKind: 'testnet' },
        'litecoin-mainnet': { id, coin: 'litecoin', networkKind: 'mainnet' },
    }[id] ?? null),
};

const baseOpts = {
    vault: {},
    walletId: 'w1',
    password: 'pw',
    chainRegistry,
    sdkRegistry: {},
    from: {
        address: BTC_MAINNET_P2PKH,
        publicKey: '02'.padEnd(66, 'a'),
        derivationPath: "m/44'/0'/0'/0/0",
    },
    tick: 'XCHAIN',
    amount: '1',
};

describe('isValidAddressForChain', () => {
    it('accepts a correct address for its own coin + network', () => {
        expect(isValidAddressForChain(BTC_MAINNET_P2PKH, 'bitcoin', 'mainnet')).toBe(true);
        expect(isValidAddressForChain(BTC_MAINNET_BECH32, 'bitcoin', 'mainnet')).toBe(true);
        expect(isValidAddressForChain(LTC_MAINNET_P2PKH, 'litecoin', 'mainnet')).toBe(true);
        expect(isValidAddressForChain(DOGE_MAINNET_P2PKH, 'dogecoin', 'mainnet')).toBe(true);
        expect(isValidAddressForChain(BTC_TESTNET_P2PKH, 'bitcoin', 'testnet')).toBe(true);
    });

    it('rejects the right coin on the wrong network', () => {
        expect(isValidAddressForChain(BTC_MAINNET_P2PKH, 'bitcoin', 'testnet')).toBe(false);
        expect(isValidAddressForChain(BTC_TESTNET_P2PKH, 'bitcoin', 'mainnet')).toBe(false);
        expect(isValidAddressForChain(BTC_MAINNET_BECH32, 'bitcoin', 'regtest')).toBe(false);
    });

    it('rejects another coin', () => {
        expect(isValidAddressForChain(LTC_MAINNET_P2PKH, 'bitcoin', 'mainnet')).toBe(false);
        expect(isValidAddressForChain(DOGE_MAINNET_P2PKH, 'litecoin', 'mainnet')).toBe(false);
        expect(isValidAddressForChain(BTC_MAINNET_BECH32, 'litecoin', 'mainnet')).toBe(false);
    });

    it('rejects a typo that keeps the leading character (checksum catches it)', () => {
        // This is what the old leading-character guess could never catch.
        const typo = `${BTC_MAINNET_P2PKH.slice(0, -1)}3`;
        expect(typo[0]).toBe('1');                 // still "looks like" a BTC address
        expect(isValidAddressForChain(typo, 'bitcoin', 'mainnet')).toBe(false);
    });

    it('rejects junk and empty input', () => {
        expect(isValidAddressForChain('not an address', 'bitcoin', 'mainnet')).toBe(false);
        expect(isValidAddressForChain('', 'bitcoin', 'mainnet')).toBe(false);
        expect(isValidAddressForChain(null, 'bitcoin', 'mainnet')).toBe(false);
    });

    it('rejects an unknown coin or network rather than passing it through', () => {
        expect(isValidAddressForChain(BTC_MAINNET_P2PKH, 'ethereum', 'mainnet')).toBe(false);
        expect(isValidAddressForChain(BTC_MAINNET_P2PKH, 'bitcoin', 'devnet')).toBe(false);
    });
});

describe('sendToken: destination is validated before a PSBT is built', () => {
    it('refuses a wrong-coin destination', async () => {
        await expect(sendToken({
            ...baseOpts,
            chainId: 'bitcoin-mainnet',
            to: LTC_MAINNET_P2PKH,
        })).rejects.toThrow(/not a valid bitcoin mainnet address/);
    });

    it('refuses a wrong-network destination', async () => {
        await expect(sendToken({
            ...baseOpts,
            chainId: 'bitcoin-mainnet',
            to: BTC_TESTNET_P2PKH,
        })).rejects.toThrow(/not a valid bitcoin mainnet address/);
    });

    it('refuses a mistyped destination with a valid-looking leader', async () => {
        await expect(sendToken({
            ...baseOpts,
            chainId: 'bitcoin-mainnet',
            to: `${BTC_MAINNET_P2PKH.slice(0, -1)}3`,
        })).rejects.toThrow(/not a valid bitcoin mainnet address/);
    });

    it('rejects before touching the signing path (fails closed, not at broadcast)', async () => {
        // vault/sdkRegistry are empty stubs: reaching submitAction would throw
        // something else entirely. The specific destination error proves we
        // bailed out first.
        const err = await sendToken({
            ...baseOpts,
            chainId: 'bitcoin-mainnet',
            to: 'obvious garbage',
        }).catch((e) => e);
        expect(err.message).toMatch(/^sendToken: "obvious garbage" is not a valid/);
    });
});

describe('sweepToken: destination is validated before a PSBT is built', () => {
    it('refuses a wrong-coin destination', async () => {
        await expect(sweepToken({
            ...baseOpts,
            chainId: 'bitcoin-mainnet',
            to: DOGE_MAINNET_P2PKH,
        })).rejects.toThrow(/sweepToken: .* is not a valid bitcoin mainnet address/);
    });

    it('refuses a wrong-network destination', async () => {
        await expect(sweepToken({
            ...baseOpts,
            chainId: 'bitcoin-mainnet',
            to: BTC_TESTNET_P2PKH,
        })).rejects.toThrow(/is not a valid bitcoin mainnet address/);
    });
});
