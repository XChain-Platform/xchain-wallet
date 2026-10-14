// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    isPlausibleAddress,
    isRecipientForChain,
} from '../../../packages/core/src/airdrop/parseRecipients.js';

const BTC_MAINNET = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const BTC_REGTEST = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

describe('isPlausibleAddress edge cases', () => {
    it.each([undefined, null, 42, {}, []])('rejects non-string input %#', (input) => {
        expect(isPlausibleAddress(input)).toBe(false);
    });

    it('trims input and accepts the inclusive legacy length boundaries', () => {
        expect(isPlausibleAddress(`  ${'A'.repeat(26)}  `)).toBe(true);
        expect(isPlausibleAddress('A'.repeat(35))).toBe(true);
        expect(isPlausibleAddress('A'.repeat(25))).toBe(false);
        expect(isPlausibleAddress('A'.repeat(36))).toBe(false);
    });

    it('accepts the extended bech32 length boundaries when a separator is present', () => {
        expect(isPlausibleAddress(`b1${'a'.repeat(12)}`)).toBe(true);
        expect(isPlausibleAddress(`b1${'a'.repeat(72)}`)).toBe(true);
        expect(isPlausibleAddress(`b1${'a'.repeat(73)}`)).toBe(false);
    });

    it('rejects characters outside both accepted alphabets', () => {
        expect(isPlausibleAddress(`${'A'.repeat(25)}-`)).toBe(false);
    });
});

describe('isRecipientForChain descriptor handling', () => {
    it('uses loose validation until both chain fields are known', () => {
        const plausible = 'A'.repeat(26);
        expect(isRecipientForChain(plausible)).toBe(true);
        expect(isRecipientForChain(plausible, { coin: 'bitcoin' })).toBe(true);
        expect(isRecipientForChain(plausible, { network: 'mainnet' })).toBe(true);
    });

    it('accepts networkKind descriptors and trims strict inputs', () => {
        expect(isRecipientForChain(`  ${BTC_REGTEST}  `, {
            coin: 'bitcoin',
            networkKind: 'regtest',
        })).toBe(true);
    });

    it('rejects non-string input and unsupported strict descriptors', () => {
        expect(isRecipientForChain(null, { coin: 'bitcoin', network: 'mainnet' })).toBe(false);
        expect(isRecipientForChain(BTC_MAINNET, { coin: 'unknown', network: 'mainnet' }))
            .toBe(false);
    });
});
