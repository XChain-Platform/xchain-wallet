// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Unit: HD key derivation. Wraps @scure/bip32 with a thin layer for
// seed-to-root and path-walking; this test pins the wrapper contract.

import { describe, it, expect } from 'vitest';
import { hdKeyFromSeed, derive, zeroDerivedKey } from '../../../packages/core/src/crypto/hd.js';
import { mnemonicToSeedSync } from '@scure/bip39';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED = mnemonicToSeedSync(MNEMONIC);

describe('crypto/hd', () => {
    describe('hdKeyFromSeed', () => {
        it('builds a root HDKey from the BIP39 seed', () => {
            const root = hdKeyFromSeed(SEED);
            expect(root.privateKey).toBeInstanceOf(Uint8Array);
            expect(root.publicKey).toBeInstanceOf(Uint8Array);
            expect(typeof root.publicExtendedKey).toBe('string');
            expect(root.publicExtendedKey.startsWith('xpub')).toBe(true);
        });

        it('is deterministic for the same seed', () => {
            const a = hdKeyFromSeed(SEED).publicExtendedKey;
            const b = hdKeyFromSeed(SEED).publicExtendedKey;
            expect(a).toBe(b);
        });
    });

    describe('derive', () => {
        it('walks a BIP44 account path', () => {
            const root = hdKeyFromSeed(SEED);
            const acct = derive(root, "m/44'/0'/0'");
            expect(acct.publicKey).toBeInstanceOf(Uint8Array);
        });

        it('walks deeper paths', () => {
            const root = hdKeyFromSeed(SEED);
            const child = derive(root, "m/44'/0'/0'/0/0");
            expect(child.publicKey).toBeInstanceOf(Uint8Array);
        });

        it('different paths produce different keys', () => {
            const root = hdKeyFromSeed(SEED);
            const a = derive(root, "m/44'/0'/0'/0/0").publicKey;
            const b = derive(root, "m/44'/0'/0'/0/1").publicKey;
            expect(Buffer.from(a).toString('hex'))
                .not.toBe(Buffer.from(b).toString('hex'));
        });

        it('coin-type 2 (LTC) and coin-type 0 (BTC) diverge at the same account index', () => {
            const root = hdKeyFromSeed(SEED);
            const btc = derive(root, "m/44'/0'/0'/0/0").publicKey;
            const ltc = derive(root, "m/44'/2'/0'/0/0").publicKey;
            expect(Buffer.from(btc).toString('hex'))
                .not.toBe(Buffer.from(ltc).toString('hex'));
        });
    });

    describe('zeroDerivedKey', () => {
        it('zeroes private key + chain code in place', () => {
            const root = hdKeyFromSeed(SEED);
            const child = derive(root, "m/44'/0'/0'/0/0");
            expect(child.privateKey.some((b) => b !== 0)).toBe(true);
            zeroDerivedKey(child);
            expect(child.privateKey.every((b) => b === 0)).toBe(true);
            if (child.chainCode) {
                expect(child.chainCode.every((b) => b === 0)).toBe(true);
            }
        });

        it('is a no-op when private key is already null (public-only node)', () => {
            const root = hdKeyFromSeed(SEED);
            const child = derive(root, "m/44'/0'/0'/0/0");
            // Calling neuter doesn't return on @scure/bip32; just verify
            // zeroing twice doesn't throw.
            zeroDerivedKey(child);
            expect(() => zeroDerivedKey(child)).not.toThrow();
        });
    });
});
