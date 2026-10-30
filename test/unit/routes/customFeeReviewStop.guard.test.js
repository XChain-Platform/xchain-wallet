// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every compose form that offers the Custom fee stop is noValidate, so the fee
// field's own validity never stops its submit. Each one runs the shared
// customFeeReviewStop at Review, so an out-of-range rate never prices a
// carrier and an unpriceable one never composes at the encoder's default fee
// while the field shows the typed rate. Forms do not judge the custom rate
// themselves; the bounds check lives in the fee module and the fee control.

import { describe, expect, it } from 'vitest';

import { customFeeReviewStop } from '../../../packages/core/src/flows/feeEstimate.js';

const sources = import.meta.glob(
    [
        '../../../packages/*/src/**/*.jsx',
        '!../../../packages/core/src/ui/FeeSelector.jsx',
        '!../../../packages/web/src/style-guide/**',
    ],
    { query: '?raw', import: 'default', eager: true },
);

function rel(path) {
    return path.replace(/^(\.\.\/)+/, '');
}

// A form offers Custom unless every fee control it renders passes allowCustom={false}.
function offersCustomFee(source) {
    const tags = source.match(/<FeeSelector\b[\s\S]*?\/>/g) || [];
    return tags.some((tag) => !/allowCustom=\{false\}/.test(tag));
}

const feeForms = Object.entries(sources)
    .filter(([, source]) => offersCustomFee(source))
    .map(([path, source]) => [rel(path), source]);

describe('custom fee Review stop guard', () => {
    it('finds the compose forms that offer a custom fee', () => {
        expect(feeForms.length).toBeGreaterThanOrEqual(40);
    });

    it('runs the shared custom fee Review stop in every form that offers a custom fee', () => {
        const missing = feeForms
            .filter(([, source]) => !/\bcustomFeeReviewStop\(/.test(source))
            .map(([path]) => path);
        expect(missing).toEqual([]);
    });

    it('leaves custom rate judgement to the fee module', () => {
        const inline = feeForms
            .filter(([, source]) => /\b(customFeeRateBoundsError|publishFeeValidationError)\(/.test(source))
            .map(([path]) => path);
        expect(inline).toEqual([]);
    });
});

describe('customFeeReviewStop', () => {
    const tiers = { unit: 'sat/vB', minimumRate: 1, maximumRate: 1000 };
    const priced = { rateValue: 25 };

    it('lets a preset tier through', () => {
        expect(customFeeReviewStop({ feePick: { mode: 'fast' }, tiers, estimate: null })).toBeNull();
    });

    it('lets an in-range custom rate the form can price through', () => {
        expect(customFeeReviewStop({ feePick: { mode: 'custom', customRate: 25 }, tiers, estimate: priced })).toBeNull();
    });

    it.each([
        ['empty', 0],
        ['negative', -5],
        ['above the ceiling', 50_000],
        ['below the floor', 0.5],
        ['more than 8 decimals', 5.123456789],
        ['an exponent past 8 decimals', '1.5e-9'],
    ])('stops a %s rate and leaves the message to the fee field', (_label, customRate) => {
        expect(customFeeReviewStop({ feePick: { mode: 'custom', customRate }, tiers, estimate: priced }))
            .toEqual({ formError: null });
    });

    it('names the rate in the form status when no fee field is on screen', () => {
        expect(customFeeReviewStop({ feePick: { mode: 'custom', customRate: 0 }, tiers: null, estimate: null }))
            .toEqual({ formError: 'Enter a custom fee rate greater than zero.' });
    });

    it('stops an in-range rate the form cannot price and says so in the form status', () => {
        expect(customFeeReviewStop({ feePick: { mode: 'custom', customRate: 25 }, tiers, estimate: null }))
            .toEqual({ formError: 'Custom fee rate is outside the supported range.' });
    });
});
