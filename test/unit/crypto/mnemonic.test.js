// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: BIP39 mnemonic generation, validation, seed derivation, and
// entropy round-trip. Pins the wallet's BIP39 wrapper layer (which is
// thin glue around @scure/bip39, but the wrapper boundary is what
// every wallet flow imports).

import { describe, it, expect } from 'vitest';
import {
    BIP39_DEFAULT_STRENGTH_BITS,
    generateBip39Mnemonic,
    isValidBip39Mnemonic,
    bip39MnemonicToSeed,
    bip39MnemonicToSeedSync,
    entropyToBip39Mnemonic,
    bip39MnemonicToEntropy,
} from '../../../packages/core/src/crypto/mnemonic.js';

const KNOWN_GOOD_12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const KNOWN_GOOD_24 = 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title';

describe('crypto/mnemonic', () => {
    describe('generateBip39Mnemonic', () => {
        it('default strength produces a 12-word mnemonic', () => {
            const m = generateBip39Mnemonic();
            expect(m.split(' ')).toHaveLength(12);
        });

        it('128-bit entropy → 12 words', () => {
            expect(generateBip39Mnemonic(128).split(' ')).toHaveLength(12);
        });
        it('160-bit entropy → 15 words', () => {
            expect(generateBip39Mnemonic(160).split(' ')).toHaveLength(15);
        });
        it('192-bit entropy → 18 words', () => {
            expect(generateBip39Mnemonic(192).split(' ')).toHaveLength(18);
        });
        it('224-bit entropy → 21 words', () => {
            expect(generateBip39Mnemonic(224).split(' ')).toHaveLength(21);
        });
        it('256-bit entropy → 24 words', () => {
            expect(generateBip39Mnemonic(256).split(' ')).toHaveLength(24);
        });

        it('produces a different mnemonic on each call (random)', () => {
            const a = generateBip39Mnemonic();
            const b = generateBip39Mnemonic();
            expect(a).not.toBe(b);
        });

        it('output passes its own validator', () => {
            const m = generateBip39Mnemonic();
            expect(isValidBip39Mnemonic(m)).toBe(true);
        });

        it('default strength constant matches what most onboarding flows pass', () => {
            expect(BIP39_DEFAULT_STRENGTH_BITS).toBe(128);
        });
    });

    describe('isValidBip39Mnemonic', () => {
        it('accepts the canonical 12-word docs vector', () => {
            expect(isValidBip39Mnemonic(KNOWN_GOOD_12)).toBe(true);
        });

        it('accepts the canonical 24-word docs vector', () => {
            expect(isValidBip39Mnemonic(KNOWN_GOOD_24)).toBe(true);
        });

        it('rejects empty string', () => {
            expect(isValidBip39Mnemonic('')).toBe(false);
        });

        it('rejects whitespace-only input', () => {
            expect(isValidBip39Mnemonic('   ')).toBe(false);
        });

        it('rejects 13-word mnemonic (one extra)', () => {
            expect(isValidBip39Mnemonic(`${KNOWN_GOOD_12} about`)).toBe(false);
        });

        it('rejects mis-spelt word', () => {
            expect(isValidBip39Mnemonic(KNOWN_GOOD_12.replace('about', 'aboutt'))).toBe(false);
        });

        it('rejects bad checksum (replacing valid word with another valid word)', () => {
            const tampered = KNOWN_GOOD_12.replace(/about$/, 'ability');
            expect(isValidBip39Mnemonic(tampered)).toBe(false);
        });
    });

    describe('bip39MnemonicToSeed', () => {
        it('returns a 64-byte seed', async () => {
            const seed = await bip39MnemonicToSeed(KNOWN_GOOD_12);
            expect(seed.length).toBe(64);
        });

        it('passphrase changes the seed', async () => {
            const a = await bip39MnemonicToSeed(KNOWN_GOOD_12);
            const b = await bip39MnemonicToSeed(KNOWN_GOOD_12, 'extra');
            expect(Buffer.from(a).toString('hex'))
                .not.toBe(Buffer.from(b).toString('hex'));
        });

        it('refuses an invalid mnemonic (throws sync before returning)', () => {
            expect(() => bip39MnemonicToSeed('not a mnemonic')).toThrow(/invalid/);
        });
    });

    describe('bip39MnemonicToSeedSync', () => {
        it('matches async output for the same input', async () => {
            const a = bip39MnemonicToSeedSync(KNOWN_GOOD_12);
            const b = await bip39MnemonicToSeed(KNOWN_GOOD_12);
            expect(Buffer.from(a).toString('hex'))
                .toBe(Buffer.from(b).toString('hex'));
        });
    });

    describe('entropy ↔ mnemonic round-trip', () => {
        it('128-bit entropy round-trips', () => {
            const entropy = new Uint8Array(16).fill(0xaa);
            const m = entropyToBip39Mnemonic(entropy);
            const back = bip39MnemonicToEntropy(m);
            expect(Buffer.from(back).toString('hex'))
                .toBe(Buffer.from(entropy).toString('hex'));
        });

        it('256-bit entropy round-trips', () => {
            const entropy = new Uint8Array(32);
            for (let i = 0; i < 32; i += 1) entropy[i] = i;
            const m = entropyToBip39Mnemonic(entropy);
            const back = bip39MnemonicToEntropy(m);
            expect(Buffer.from(back).toString('hex'))
                .toBe(Buffer.from(entropy).toString('hex'));
        });
    });
});
