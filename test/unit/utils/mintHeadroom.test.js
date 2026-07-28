// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : mint headroom is min(MAX_MINT, MAX_SUPPLY - supply). The case
// that made the defect visible is a token exactly at its cap, where the
// answer has to be a hard '0' and not "whatever you happen to hold".

import { describe, it, expect } from 'vitest';
import {
    mintHeadroom,
    exceedsHeadroom,
    subtractDecimal,
    compareDecimal,
} from '../../../packages/core/src/shared/utils/mintHeadroom.js';

describe('mintHeadroom', () => {
    it('is 0 for a token at its supply cap (S18PROBE, 5000 of 5000)', () => {
        expect(mintHeadroom({ maxSupply: '5000', totalSupply: '5000' })).toBe('0');
    });

    it('is the remaining supply when only MAX_SUPPLY binds', () => {
        expect(mintHeadroom({ maxSupply: '5000', totalSupply: '1200' })).toBe('3800');
    });

    it('is MAX_MINT when the per-transaction cap binds first', () => {
        expect(mintHeadroom({ maxSupply: '5000', totalSupply: '1000', mintMax: '100' }))
            .toBe('100');
    });

    it('is the supply headroom when MAX_MINT is the looser of the two', () => {
        expect(mintHeadroom({ maxSupply: '5000', totalSupply: '4990', mintMax: '100' }))
            .toBe('10');
    });

    it('is MAX_MINT alone for an uncapped token that sets a per-tx cap', () => {
        expect(mintHeadroom({ maxSupply: null, totalSupply: '9000', mintMax: '250' }))
            .toBe('250');
    });

    it('is null when nothing bounds the mint (uncapped, no MAX_MINT)', () => {
        expect(mintHeadroom({ maxSupply: null, totalSupply: '9000', mintMax: null }))
            .toBeNull();
    });

    it('is null when the token record has not loaded', () => {
        expect(mintHeadroom({})).toBeNull();
        expect(mintHeadroom()).toBeNull();
    });

    it('never goes negative when supply somehow exceeds the cap', () => {
        expect(mintHeadroom({ maxSupply: '5000', totalSupply: '5001' })).toBe('0');
    });

    it('keeps divisible amounts exact (no float drift at 8 decimals)', () => {
        expect(mintHeadroom({ maxSupply: '21000000', totalSupply: '20999999.99999999' }))
            .toBe('0.00000001');
        expect(mintHeadroom({ maxSupply: '1000.5', totalSupply: '0.3' })).toBe('1000.2');
    });

    it('treats an unparseable supply figure as unknown rather than inventing one', () => {
        expect(mintHeadroom({ maxSupply: '5,000', totalSupply: '1000' })).toBeNull();
        expect(mintHeadroom({ maxSupply: '5000', totalSupply: 'unlimited' })).toBeNull();
    });
});

describe('exceedsHeadroom', () => {
    it('flags any positive mint against a headroom of 0', () => {
        expect(exceedsHeadroom('5000', '0')).toBe(true);
        expect(exceedsHeadroom('0.00000001', '0')).toBe(true);
    });

    it('allows a mint exactly at the headroom', () => {
        expect(exceedsHeadroom('3800', '3800')).toBe(false);
    });

    it('stays quiet when the headroom is unknown, leaving the form ungated', () => {
        expect(exceedsHeadroom('5000', null)).toBe(false);
    });
});

describe('decimal helpers', () => {
    it('subtracts exactly and floors at zero', () => {
        expect(subtractDecimal('1', '0.9')).toBe('0.1');
        expect(subtractDecimal('0.3', '0.1')).toBe('0.2');
        expect(subtractDecimal('1', '5')).toBe('0');
        expect(subtractDecimal('1', 'x')).toBeNull();
    });

    it('compares across differing scales', () => {
        expect(compareDecimal('1.10', '1.1')).toBe(0);
        expect(compareDecimal('1.10', '1.2')).toBe(-1);
        expect(compareDecimal('2', '1.999999')).toBe(1);
        expect(compareDecimal('2', null)).toBeNull();
    });
});
