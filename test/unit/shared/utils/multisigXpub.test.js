// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import {
    isCompressedPublicKey,
    validateCosignerXpub,
    xpubForNetwork,
} from '../../../../packages/core/src/shared/utils/multisigXpub.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED = mnemonicToSeedSync(MNEMONIC);
const ACCOUNT_PATH = "m/84'/0'/0'";
const FULL_PATH = `${ACCOUNT_PATH}/0/7`;
const ROOT = HDKey.fromMasterSeed(SEED);
const ACCOUNT = ROOT.derive(ACCOUNT_PATH);
const XPUB = ACCOUNT.publicExtendedKey;
const XPRV = ACCOUNT.privateExtendedKey;
const PUBKEY = Buffer.from(ROOT.derive(FULL_PATH).publicKey).toString('hex');

describe('isCompressedPublicKey', () => {
    it('accepts valid compressed secp256k1 keys in either hex case', () => {
        expect(isCompressedPublicKey(PUBKEY)).toBe(true);
        expect(isCompressedPublicKey(PUBKEY.toUpperCase())).toBe(true);
    });

    it.each([
        null,
        '',
        `04${PUBKEY.slice(2)}`,
        `${PUBKEY}00`,
        `02${'gg'.repeat(32)}`,
        `02${'ff'.repeat(32)}`,
    ])('rejects malformed or off-curve input %#', (value) => {
        expect(isCompressedPublicKey(value)).toBe(false);
    });
});

describe('validateCosignerXpub', () => {
    it('accepts an account xpub that derives the supplied key', () => {
        expect(validateCosignerXpub(XPUB, 'mainnet', FULL_PATH, PUBKEY)).toBeNull();
        expect(validateCosignerXpub(XPUB, 'mainnet', FULL_PATH, PUBKEY.toUpperCase())).toBeNull();
    });

    it('accepts testnet serialization for testnet and regtest', () => {
        const tpub = xpubForNetwork(XPUB, 'testnet');
        expect(tpub).toMatch(/^tpub/);
        expect(validateCosignerXpub(tpub, 'testnet', FULL_PATH, PUBKEY)).toBeNull();
        expect(validateCosignerXpub(tpub, 'regtest', FULL_PATH, PUBKEY)).toBeNull();
    });

    it('rejects malformed and private extended keys', () => {
        expect(validateCosignerXpub('not-an-xpub', 'mainnet', FULL_PATH, PUBKEY))
            .toBe('xpub is not a valid extended public key.');
        expect(validateCosignerXpub(XPRV, 'mainnet', FULL_PATH, PUBKEY))
            .toBe('Use an extended public key, not a private key.');
    });

    it('rejects extended keys serialized for the wrong network', () => {
        const tpub = xpubForNetwork(XPUB, 'testnet');
        expect(validateCosignerXpub(tpub, 'mainnet', FULL_PATH, PUBKEY))
            .toBe('xpub is for a test network, not Bitcoin mainnet.');
        expect(validateCosignerXpub(XPUB, 'testnet', FULL_PATH, PUBKEY))
            .toBe('xpub is for Bitcoin mainnet, not this test network.');
    });

    it('rejects paths that conflict with the xpub depth or child index', () => {
        expect(validateCosignerXpub(XPUB, 'mainnet', "m/84'/0'", PUBKEY))
            .toBe('Derivation path does not match the xpub depth.');
        expect(validateCosignerXpub(XPUB, 'mainnet', "m/84'/0'/1'/0/7", PUBKEY))
            .toBe('Derivation path does not match the xpub child index.');
        expect(validateCosignerXpub(XPUB, 'mainnet', 'not-a-path', PUBKEY))
            .toBe('Derivation path does not match the xpub depth.');
    });

    it('rejects hardened descendants and keys from another descendant', () => {
        expect(validateCosignerXpub(XPUB, 'mainnet', `${ACCOUNT_PATH}/0'/7`, PUBKEY))
            .toBe('Derivation path asks this public xpub to derive a hardened child.');
        const otherPubkey = Buffer.from(ROOT.derive(`${ACCOUNT_PATH}/0/8`).publicKey).toString('hex');
        expect(validateCosignerXpub(XPUB, 'mainnet', FULL_PATH, otherPubkey))
            .toBe('Public key does not match the xpub and derivation path.');
    });

    it('reports a public derivation index outside the BIP32 range', () => {
        expect(validateCosignerXpub(
            XPUB,
            'mainnet',
            `${ACCOUNT_PATH}/2147483648`,
            PUBKEY,
        )).toBe('Derivation path cannot be derived from this xpub.');
    });
});

describe('xpubForNetwork', () => {
    it('re-serializes the same public node for testnet and back to mainnet', () => {
        const tpub = xpubForNetwork(XPUB, 'testnet');
        expect(tpub).toMatch(/^tpub/);
        expect(xpubForNetwork(tpub, 'regtest')).toBe(tpub);
        expect(xpubForNetwork(tpub, 'mainnet')).toBe(XPUB);
    });

    it('keeps same-network, unknown, and absent values unchanged', () => {
        expect(xpubForNetwork(XPUB, 'mainnet')).toBe(XPUB);
        expect(xpubForNetwork(XPUB, undefined)).toBe(XPUB);
        expect(xpubForNetwork('host-error', 'testnet')).toBe('host-error');
        expect(xpubForNetwork('')).toBe('');
        expect(xpubForNetwork(null, 'mainnet')).toBeNull();
        expect(xpubForNetwork(undefined, 'mainnet')).toBeUndefined();
    });

    it('never converts or returns private extended key material', () => {
        expect(xpubForNetwork(XPRV, 'mainnet')).toBeNull();
        expect(xpubForNetwork(XPRV, 'testnet')).toBeNull();
    });
});
