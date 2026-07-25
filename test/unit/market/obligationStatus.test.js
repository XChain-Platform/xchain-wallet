// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for COINPAY obligation classification (§41.4 / PC-15).
// The expired state is a funds-safety gate: a COINPAY confirming
// after the deadline burns the buyer's coin with no settlement, so
// classification must fail toward "expired" exactly at the boundary,
// and amount rendering must stay exact past 2^53 (large DOGE).

import { describe, it, expect } from 'vitest';
import {
    AT_RISK_SECONDS,
    classifyObligation,
    countdownText,
    baseUnitsToCoinText,
} from '../../../packages/core/src/market/obligationStatus.js';

const NOW = 1753380000; // fixed reference clock, UNIX seconds

describe('market/obligationStatus classifyObligation', () => {
    it('classifies a far-future expiration as open with the exact seconds left', () => {
        const r = classifyObligation(NOW + 7200, NOW);
        expect(r).toEqual({ state: 'open', secondsLeft: 7200 });
    });

    it('classifies inside the 30-minute window as at-risk', () => {
        expect(classifyObligation(NOW + AT_RISK_SECONDS, NOW).state).toBe('at-risk');
        expect(classifyObligation(NOW + 60, NOW).state).toBe('at-risk');
    });

    it('flips open -> at-risk exactly at the threshold boundary', () => {
        expect(classifyObligation(NOW + AT_RISK_SECONDS + 1, NOW).state).toBe('open');
        expect(classifyObligation(NOW + AT_RISK_SECONDS, NOW).state).toBe('at-risk');
    });

    it('classifies the exact deadline second as expired (never payable at T=0)', () => {
        expect(classifyObligation(NOW, NOW).state).toBe('expired');
        expect(classifyObligation(NOW - 1, NOW).state).toBe('expired');
    });

    it('accepts a numeric-string expiration (explorer rows vary)', () => {
        expect(classifyObligation(String(NOW + 7200), NOW).state).toBe('open');
    });

    it('treats missing/garbage expiration as open with no countdown, not expired', () => {
        // Blocking payment on a row that merely lacks a usable timestamp
        // would strand a legitimate obligation; that failure mode is
        // worse than showing no countdown.
        for (const bad of [null, undefined, '', 'soon', NaN, -5, 0, 2e13]) {
            expect(classifyObligation(bad, NOW)).toEqual({ state: 'open', secondsLeft: null });
        }
    });
});

describe('market/obligationStatus countdownText', () => {
    it('renders hours + minutes above one hour', () => {
        expect(countdownText(7200)).toBe('2h 00m');
        expect(countdownText(3661)).toBe('1h 01m');
    });

    it('renders minutes + seconds below one hour', () => {
        expect(countdownText(3599)).toBe('59m 59s');
        expect(countdownText(65)).toBe('1m 05s');
    });

    it('renders bare seconds below one minute', () => {
        expect(countdownText(48)).toBe('48s');
    });

    it('returns null for expired, zero, and missing values', () => {
        expect(countdownText(0)).toBeNull();
        expect(countdownText(-30)).toBeNull();
        expect(countdownText(null)).toBeNull();
        expect(countdownText(undefined)).toBeNull();
    });
});

describe('market/obligationStatus baseUnitsToCoinText', () => {
    it('converts base units to coin scale, stripping trailing zeros', () => {
        expect(baseUnitsToCoinText(150000000)).toBe('1.5');
        expect(baseUnitsToCoinText('100000000')).toBe('1');
        expect(baseUnitsToCoinText(1)).toBe('0.00000001');
        expect(baseUnitsToCoinText(0)).toBe('0');
    });

    it('stays exact past Number.MAX_SAFE_INTEGER (large DOGE, )', () => {
        // 2^53 = 9007199254740992 base units; float math would round.
        expect(baseUnitsToCoinText('9007199254740993')).toBe('90071992.54740993');
        expect(baseUnitsToCoinText('123456789012345678')).toBe('1234567890.12345678');
    });

    it('rejects non-integer and negative shapes as null (caller falls back to raw)', () => {
        for (const bad of ['1.5', 'abc', -1, '', null, undefined, '0x10']) {
            expect(baseUnitsToCoinText(bad)).toBeNull();
        }
    });
});
