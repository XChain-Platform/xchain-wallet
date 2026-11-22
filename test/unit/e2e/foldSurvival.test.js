// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it } from 'vitest';

import { foldSurvivalFailures } from '../../e2e/fixtures/foldSurvival.js';

const capture = (overrides = {}) => ({
    fields: { amount: '12', recipient: 'xc1recipient' },
    scrollTop: 24,
    confirmOpen: false,
    detailKey: 'transaction-1',
    ...overrides,
});

it('returns no failures for identical captures', () => {
    const before = capture();

    expect(foldSurvivalFailures(before, capture())).toEqual([]);
});

it('reports changed and dropped fields in name order', () => {
    const before = capture({ fields: { recipient: 'xc1recipient', amount: '12', memo: 'rent' } });
    const after = capture({ fields: { recipient: 'xc1changed' } });

    expect(foldSurvivalFailures(before, after)).toEqual(['field:amount', 'field:memo', 'field:recipient']);
});

it('does not report a field that is present only after the resize', () => {
    const before = capture({ fields: { amount: '12' } });
    const after = capture({ fields: { amount: '12', memo: 'rent' } });

    expect(foldSurvivalFailures(before, after)).toEqual([]);
});

it('allows scroll movement at the tolerance and reports movement one pixel past it', () => {
    const before = capture({ scrollTop: 24 });

    expect(foldSurvivalFailures(before, capture({ scrollTop: 22 }))).toEqual([]);
    expect(foldSurvivalFailures(before, capture({ scrollTop: 27 }))).toEqual(['scroll']);
});

it('uses a caller-provided scroll tolerance', () => {
    const before = capture({ scrollTop: 24 });

    expect(foldSurvivalFailures(before, capture({ scrollTop: 29 }), { scrollTolerancePx: 5 })).toEqual([]);
    expect(foldSurvivalFailures(before, capture({ scrollTop: 30 }), { scrollTolerancePx: 5 })).toEqual(['scroll']);
});

it('does not report a confirm that opened only after the resize', () => {
    expect(foldSurvivalFailures(capture(), capture({ confirmOpen: true }))).toEqual([]);
});

it('reports a confirm that was closed by the resize', () => {
    const before = capture({ confirmOpen: true });

    expect(foldSurvivalFailures(before, capture({ confirmOpen: false }))).toEqual(['confirm']);
});

it('reports a changed and a cleared detail selection', () => {
    const before = capture({ detailKey: 'transaction-1' });

    expect(foldSurvivalFailures(before, capture({ detailKey: 'transaction-2' }))).toEqual(['detail']);
    expect(foldSurvivalFailures(before, capture({ detailKey: null }))).toEqual(['detail']);
});

it('returns field, scroll, confirm, and detail failures in fixed order', () => {
    const before = capture({
        fields: { zeta: 'last', alpha: 'first' },
        scrollTop: 24,
        confirmOpen: true,
        detailKey: 'transaction-1',
    });
    const after = capture({
        fields: { zeta: 'changed' },
        scrollTop: 27,
        confirmOpen: false,
        detailKey: null,
    });

    expect(foldSurvivalFailures(before, after)).toEqual([
        'field:alpha',
        'field:zeta',
        'scroll',
        'confirm',
        'detail',
    ]);
});
