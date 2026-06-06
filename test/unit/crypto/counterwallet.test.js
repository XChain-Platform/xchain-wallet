// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Unit: Counterwallet legacy 12-word mnemonic shim. Used by the
// FreeWallet import path so users can bring their wallets across
// without re-deriving addresses.

import { describe, it, expect } from 'vitest';
import {
    COUNTERWALLET_WORD_COUNT,
    COUNTERWALLET_WORDLIST_SIZE,
    validateCounterwalletMnemonic,
    isValidCounterwalletMnemonic,
    counterwalletMnemonicToSeedBytes,
    counterwalletMnemonicToSeedHex,
} from '../../../packages/core/src/crypto/counterwallet.js';
import { COUNTERWALLET_WORDLIST } from '../../../packages/core/src/crypto/counterwallet-wordlist.js';

describe('crypto/counterwallet', () => {
    it('wordlist size matches the constant', () => {
        expect(COUNTERWALLET_WORDLIST.length).toBe(COUNTERWALLET_WORDLIST_SIZE);
    });

    it('canonical word count is 12', () => {
        expect(COUNTERWALLET_WORD_COUNT).toBe(12);
    });

    describe('validate', () => {
        it('returns ok=false for empty input', () => {
            const r = validateCounterwalletMnemonic('');
            expect(r.ok).toBe(false);
        });

        it('returns ok=false for fewer than 12 words', () => {
            const r = validateCounterwalletMnemonic('like just love');
            expect(r.ok).toBe(false);
        });

        it('returns ok=false for an out-of-wordlist word', () => {
            const m = `${COUNTERWALLET_WORDLIST.slice(0, 11).join(' ')} unicornsparkle`;
            const r = validateCounterwalletMnemonic(m);
            expect(r.ok).toBe(false);
        });

        it('returns ok=true for any 12 in-list words', () => {
            const m = COUNTERWALLET_WORDLIST.slice(0, 12).join(' ');
            const r = validateCounterwalletMnemonic(m);
            expect(r.ok).toBe(true);
        });

        it('isValidCounterwalletMnemonic mirrors validate.ok', () => {
            const m = COUNTERWALLET_WORDLIST.slice(0, 12).join(' ');
            expect(isValidCounterwalletMnemonic(m)).toBe(true);
        });
    });

    describe('seed derivation', () => {
        it('returns a non-empty Uint8Array', () => {
            const m = COUNTERWALLET_WORDLIST.slice(0, 12).join(' ');
            const seed = counterwalletMnemonicToSeedBytes(m);
            expect(seed).toBeInstanceOf(Uint8Array);
            expect(seed.length).toBeGreaterThan(0);
        });

        it('hex matches bytes', () => {
            const m = COUNTERWALLET_WORDLIST.slice(0, 12).join(' ');
            const bytes = counterwalletMnemonicToSeedBytes(m);
            const hex = counterwalletMnemonicToSeedHex(m);
            expect(hex).toBe(Buffer.from(bytes).toString('hex'));
        });

        it('deterministic for the same mnemonic', () => {
            const m = COUNTERWALLET_WORDLIST.slice(0, 12).join(' ');
            expect(counterwalletMnemonicToSeedHex(m))
                .toBe(counterwalletMnemonicToSeedHex(m));
        });

        it('different mnemonics → different seeds', () => {
            const a = COUNTERWALLET_WORDLIST.slice(0, 12).join(' ');
            const b = COUNTERWALLET_WORDLIST.slice(1, 13).join(' ');
            expect(counterwalletMnemonicToSeedHex(a))
                .not.toBe(counterwalletMnemonicToSeedHex(b));
        });
    });
});
