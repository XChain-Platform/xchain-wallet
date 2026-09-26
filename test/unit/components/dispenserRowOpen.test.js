// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// isDispenserRowOpen(): the explorer returns frozen action validity beside
// current lifecycle and escrow fields. The badge counts only live stock.

import { describe, it, expect } from 'vitest';
import { isDispenserRowOpen } from '../../../packages/core/src/shared/components/DispenserBadge.jsx';

describe('isDispenserRowOpen()', () => {
    it('treats the explorer\'s "valid" status label as open', () => {
        expect(isDispenserRowOpen({ status: 'valid' })).toBe(true);
    });
    it('treats an explicit "open" status label as open', () => {
        expect(isDispenserRowOpen({ status: 'open' })).toBe(true);
    });
    it('lets current lifecycle overrule valid creation status', () => {
        expect(isDispenserRowOpen({ status: 'valid', current_status: 'cancelled', escrow_remaining: '5' })).toBe(false);
    });
    it('drops an open row after its current escrow reaches zero', () => {
        expect(isDispenserRowOpen({ status: 'valid', current_status: 'open', escrow_remaining: '0' })).toBe(false);
    });
    it('keeps an open row with positive current escrow', () => {
        expect(isDispenserRowOpen({ status: 'valid', current_status: 'open', escrow_remaining: '0.5' })).toBe(true);
    });
    it('treats a reverted dispenser as not open', () => {
        expect(isDispenserRowOpen({ status: 'reverted' })).toBe(false);
    });
    it('treats an invalid-lock-style status label as not open', () => {
        expect(isDispenserRowOpen({ status: 'invalid: LOCK_MINT (locked)' })).toBe(false);
    });
    it('assumes active when the explorer omits status entirely', () => {
        expect(isDispenserRowOpen({})).toBe(true);
    });
    it('rejects null/non-object rows', () => {
        expect(isDispenserRowOpen(null)).toBe(false);
        expect(isDispenserRowOpen(undefined)).toBe(false);
    });
    it('regression: a numeric-style comparison would have wrongly dropped every valid row', () => {
        // The bug this guards: Number('valid') is NaN, and NaN !== 0 is
        // true, so a `Number(status) !== 0` filter always rejected this row.
        const row = { status: 'valid' };
        expect(Number(row.status)).toBeNaN();
        expect(isDispenserRowOpen(row)).toBe(true);
    });
});
