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
import { detectAddressCoin } from '../../../../packages/core/src/shared/utils/addressValidation.js';
import {
    coinFamilyFor,
    contactEntryChain,
} from '../../../../packages/core/src/shared/utils/contactChain.js';

const MAINNET_ADDRESSES = [
    ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'bitcoin'],
    ['LM2WMpR1Rp6j3Sa59cMXMs1SPzj9eXpGc1', 'litecoin'],
    ['DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L', 'dogecoin'],
];

describe('coinFamilyFor', () => {
    it('returns the family detected for real mainnet addresses', () => {
        for (const [address, family] of MAINNET_ADDRESSES) {
            expect(detectAddressCoin(address)).toBe(family);
            expect(coinFamilyFor(address)).toBe(family);
        }
    });

    it('uses any supported fallback for an unrecognised address', () => {
        for (const family of ['bitcoin', 'litecoin', 'dogecoin']) {
            expect(coinFamilyFor('not-an-address', family)).toBe(family);
        }
    });

    it('ignores unsupported fallbacks and otherwise returns unknown', () => {
        expect(coinFamilyFor('not-an-address', 'ethereum')).toBe('unknown');
        expect(coinFamilyFor('not-an-address')).toBe('unknown');
    });
});

describe('contactEntryChain', () => {
    it('prefers an entry chain that is present and known', () => {
        expect(contactEntryChain({
            chain: 'litecoin',
            address: MAINNET_ADDRESSES[0][0],
        })).toBe('litecoin');
    });

    it('detects the address when the entry chain is unknown or absent', () => {
        expect(contactEntryChain({
            chain: 'unknown',
            address: MAINNET_ADDRESSES[2][0],
        })).toBe('dogecoin');
        expect(contactEntryChain({ address: MAINNET_ADDRESSES[0][0] })).toBe('bitcoin');
    });

    it('tolerates an undefined entry', () => {
        expect(contactEntryChain(undefined)).toBe('unknown');
    });
});
