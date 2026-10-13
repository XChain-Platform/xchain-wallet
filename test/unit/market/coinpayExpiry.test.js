// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for coinpay obligation expiry rendering (§41.4). The
// obligation `expiration` is a UNIX timestamp (block time +
// COINPAY_EXPIRATION), NOT a block height; a COINPAY confirming after
// it loses the buyer's native coin, so it must render as a real time.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { coinpayExpiryText } from '../../../packages/core/src/market/coinpayExpiry.js';

afterEach(() => vi.restoreAllMocks());

describe('market/coinpayExpiry coinpayExpiryText', () => {
    it('renders a UNIX-seconds timestamp in the viewer local time zone', () => {
        const locale = vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('Jul 8, 2025, 7:00 AM PDT');
        const out = coinpayExpiryText(1751983200);
        expect(out).toBe('Jul 8, 2025, 7:00 AM PDT');
        expect(locale).toHaveBeenCalledWith(undefined, expect.objectContaining({ timeZoneName: 'short' }));
        // Must NOT be interpreted as (or look like) a bare block height.
        expect(out).not.toMatch(/^\d+$/);
        expect(out).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('accepts a numeric string', () => {
        vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('local deadline');
        expect(coinpayExpiryText('1751983200')).toBe('local deadline');
    });

    it('returns null for missing / non-positive / non-finite values', () => {
        expect(coinpayExpiryText(null)).toBeNull();
        expect(coinpayExpiryText(undefined)).toBeNull();
        expect(coinpayExpiryText('')).toBeNull();
        expect(coinpayExpiryText(0)).toBeNull();
        expect(coinpayExpiryText(-1)).toBeNull();
        expect(coinpayExpiryText('abc')).toBeNull();
    });

    it('rejects an out-of-range value (guards against a ms value or garbage)', () => {
        expect(coinpayExpiryText(1e14)).toBeNull();
    });
});
