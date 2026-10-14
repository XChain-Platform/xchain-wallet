// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { classifyRecipients } from '../../../packages/core/src/airdrop/parseRecipients.js';

const BTC_MAINNET = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const BTC_LEGACY = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const BTC_REGTEST = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const CHAIN = { coin: 'bitcoin', network: 'mainnet' };

describe('classifyRecipients edge cases', () => {
    it('ignores empty values, trims candidates, and preserves first-seen order', () => {
        expect(classifyRecipients([
            null,
            undefined,
            '   ',
            ` ${BTC_LEGACY} `,
            BTC_MAINNET,
        ], CHAIN)).toEqual({
            valid: [BTC_LEGACY, BTC_MAINNET],
            invalid: [],
            duplicates: 0,
            wrongNetwork: [],
        });
    });

    it('deduplicates valid bech32 addresses without changing the retained spelling', () => {
        const upper = BTC_MAINNET.toUpperCase();
        const out = classifyRecipients([upper, BTC_MAINNET, upper], CHAIN);

        expect(out.valid).toEqual([upper]);
        expect(out.duplicates).toBe(2);
    });

    it('deduplicates an invalid uniform-case bech32 candidate before classification', () => {
        const malformed = `bc1${'q'.repeat(39)}`;
        const out = classifyRecipients([malformed, malformed.toUpperCase()], CHAIN);

        expect(out.invalid).toEqual([malformed]);
        expect(out.duplicates).toBe(1);
        expect(out.wrongNetwork).toEqual([]);
    });

    it('keeps base58 duplicate matching case-sensitive', () => {
        const changedCase = `${BTC_LEGACY.slice(0, 2)}w${BTC_LEGACY.slice(3)}`;
        const out = classifyRecipients([BTC_LEGACY, changedCase], CHAIN);

        expect(out.valid).toEqual([BTC_LEGACY]);
        expect(out.invalid).toEqual([changedCase]);
        expect(out.duplicates).toBe(0);
    });

    it('reports valid addresses for another network separately from malformed input', () => {
        const out = classifyRecipients([BTC_REGTEST, 'not-an-address'], CHAIN);

        expect(out.invalid).toEqual([BTC_REGTEST, 'not-an-address']);
        expect(out.wrongNetwork).toEqual([BTC_REGTEST]);
    });
});
