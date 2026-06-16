// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Boundary: BIP39 mnemonic word counts. Wallet accepts the 5 standard
// counts (12/15/18/21/24) and rejects everything else. Counterwallet-
// legacy is exactly 12 — it's allowed but goes through a separate code
// path (not exercised here).

import { describe, it, expect } from 'vitest';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

const KNOWN_GOOD_12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('boundary/mnemonic/word-counts', () => {
    it('accepts a known-good 12-word mnemonic', () => {
        expect(validateMnemonic(KNOWN_GOOD_12, wordlist)).toBe(true);
    });

    it('rejects an empty string', () => {
        expect(validateMnemonic('', wordlist)).toBe(false);
    });

    it('rejects an 11-word mnemonic (one word truncated)', () => {
        const truncated = KNOWN_GOOD_12.split(' ').slice(0, 11).join(' ');
        expect(validateMnemonic(truncated, wordlist)).toBe(false);
    });

    it('rejects a 13-word mnemonic (one word too many)', () => {
        expect(validateMnemonic(`${KNOWN_GOOD_12} about`, wordlist)).toBe(false);
    });

    it('rejects a 12-word mnemonic with a misspelt word', () => {
        const bad = KNOWN_GOOD_12.replace('about', 'aboutt');
        expect(validateMnemonic(bad, wordlist)).toBe(false);
    });

    it('rejects whitespace-only input', () => {
        expect(validateMnemonic('   \n\t  ', wordlist)).toBe(false);
    });
});
