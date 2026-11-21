// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it } from 'vitest';

import { duoViewports } from '../../e2e/fixtures/duoViewports.js';

it('returns all four measured states in Duo order', () => {
    const divisions = {
        closedPortrait: { orientation: 'none' },
        closedLandscape: { orientation: 'none' },
        openPortrait: { orientation: 'vertical', x: 400 },
        openLandscape: { orientation: 'horizontal', y: 400 },
    };
    const measured = {
        device: 'iPhone Duo',
        measuredAt: '2026-11-20T00:00:00Z',
        states: {
            'open-landscape': { width: 951, height: 669, division: divisions.openLandscape },
            'closed-landscape': { width: 678, height: 466, division: divisions.closedLandscape },
            'open-portrait': { width: 669, height: 951, division: divisions.openPortrait },
            'closed-portrait': { width: 466, height: 678, division: divisions.closedPortrait },
        },
    };

    expect(duoViewports(measured)).toEqual([
        {
            name: 'Duo closed-portrait',
            state: 'closed-portrait',
            width: 466,
            height: 678,
            division: divisions.closedPortrait,
        },
        {
            name: 'Duo closed-landscape',
            state: 'closed-landscape',
            width: 678,
            height: 466,
            division: divisions.closedLandscape,
        },
        {
            name: 'Duo open-portrait',
            state: 'open-portrait',
            width: 669,
            height: 951,
            division: divisions.openPortrait,
        },
        {
            name: 'Duo open-landscape',
            state: 'open-landscape',
            width: 951,
            height: 669,
            division: divisions.openLandscape,
        },
    ]);
});

it('skips unreachable, malformed, and unrecognized states', () => {
    const extraDivision = { orientation: 'vertical', x: 123 };
    const measured = {
        states: {
            'closed-portrait': { unreachable: true, width: 466, height: 678 },
            'closed-landscape': { width: 0, height: 466, division: null },
            'open-portrait': { width: 669.49, height: 951.51, division: undefined },
            'open-landscape': { width: Number.POSITIVE_INFINITY, height: 669 },
            'partial-portrait': { width: 500, height: 700, division: extraDivision },
        },
    };

    expect(duoViewports(measured)).toEqual([
        {
            name: 'Duo open-portrait',
            state: 'open-portrait',
            width: 669,
            height: 952,
            division: undefined,
        },
    ]);
});

it('returns an empty list for null and malformed containers', () => {
    expect(duoViewports(null)).toEqual([]);
    expect(duoViewports([])).toEqual([]);
    expect(duoViewports({ states: null })).toEqual([]);
});
