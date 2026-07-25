// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-01: block-height -> estimated wall-clock date, used to caption the
// Mint settings panel's MINT_START_BLOCK / MINT_STOP_BLOCK inputs.

import { describe, it, expect } from 'vitest';
import {
    TARGET_BLOCK_SECONDS_BY_COIN,
    targetBlockSecondsForCoin,
    estimateBlockDate,
    blockDateEstimateText,
} from '../../../../packages/core/src/shared/utils/blockDateEstimate.js';

describe('targetBlockSecondsForCoin', () => {
    it('returns the target spacing for each supported coin', () => {
        expect(targetBlockSecondsForCoin('bitcoin')).toBe(600);
        expect(targetBlockSecondsForCoin('litecoin')).toBe(150);
        expect(targetBlockSecondsForCoin('dogecoin')).toBe(60);
    });

    it('returns null for an unrecognized or missing coin', () => {
        expect(targetBlockSecondsForCoin('nonexistent')).toBeNull();
        expect(targetBlockSecondsForCoin(null)).toBeNull();
        expect(targetBlockSecondsForCoin(undefined)).toBeNull();
    });

    it('exports the raw constant map for direct consumers', () => {
        expect(TARGET_BLOCK_SECONDS_BY_COIN.bitcoin).toBe(600);
    });
});

describe('estimateBlockDate', () => {
    it('projects a future block forward at the coin target spacing', () => {
        const now = Date.now();
        const date = estimateBlockDate({ coin: 'bitcoin', currentHeight: 900000, targetBlock: 900100 });
        expect(date).toBeInstanceOf(Date);
        // 100 blocks * 600s = 60000s = 1000 minutes.
        const expectedMs = now + 100 * 600 * 1000;
        expect(Math.abs(date.getTime() - expectedMs)).toBeLessThan(2000);
    });

    it('projects a past block backward (negative delta)', () => {
        const now = Date.now();
        const date = estimateBlockDate({ coin: 'dogecoin', currentHeight: 6000100, targetBlock: 6000000 });
        const expectedMs = now - 100 * 60 * 1000;
        expect(Math.abs(date.getTime() - expectedMs)).toBeLessThan(2000);
    });

    it('returns null for an unrecognized coin', () => {
        expect(estimateBlockDate({ coin: 'unknown', currentHeight: 100, targetBlock: 200 })).toBeNull();
    });

    it('returns null when currentHeight or targetBlock is missing/non-finite', () => {
        expect(estimateBlockDate({ coin: 'bitcoin', currentHeight: null, targetBlock: 200 })).toBeNull();
        expect(estimateBlockDate({ coin: 'bitcoin', currentHeight: 100, targetBlock: null })).toBeNull();
        expect(estimateBlockDate({ coin: 'bitcoin', currentHeight: 100, targetBlock: 'abc' })).toBeNull();
    });

    it('returns null for a non-positive target block', () => {
        expect(estimateBlockDate({ coin: 'bitcoin', currentHeight: 100, targetBlock: 0 })).toBeNull();
        expect(estimateBlockDate({ coin: 'bitcoin', currentHeight: 100, targetBlock: -5 })).toBeNull();
    });

    it('accepts numeric strings for currentHeight / targetBlock', () => {
        const date = estimateBlockDate({ coin: 'litecoin', currentHeight: '3000000', targetBlock: '3000010' });
        expect(date).toBeInstanceOf(Date);
    });
});

describe('blockDateEstimateText', () => {
    it('renders a "~<date> (in about N days)" label for a future block', () => {
        const secondsAhead = 10 * 24 * 60 * 60; // 10 days
        const blocksAhead = secondsAhead / 600;
        const text = blockDateEstimateText({ coin: 'bitcoin', currentHeight: 900000, targetBlock: 900000 + blocksAhead });
        expect(text).toMatch(/^~/);
        expect(text).toMatch(/in about 10 days?\)$/);
    });

    it('renders a "about N days ago" label for a past block', () => {
        const secondsBehind = 5 * 24 * 60 * 60; // 5 days
        const blocksBehind = secondsBehind / 60;
        const text = blockDateEstimateText({ coin: 'dogecoin', currentHeight: 6000000, targetBlock: 6000000 - blocksBehind });
        expect(text).toMatch(/about 5 days ago\)$/);
    });

    it('returns null when the underlying estimate cannot be computed', () => {
        expect(blockDateEstimateText({ coin: 'unknown', currentHeight: 100, targetBlock: 200 })).toBeNull();
        expect(blockDateEstimateText({ coin: 'bitcoin', currentHeight: null, targetBlock: 200 })).toBeNull();
    });
});
