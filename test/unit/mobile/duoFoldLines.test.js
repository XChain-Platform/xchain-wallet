// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    DUO_STATES,
    checkMeasuredWidths,
    foldMeasurement,
    parseFoldLines,
} from '../../../packages/mobile/scripts/duo-fixture.js';

const openBookFold = {
    display: 'inner',
    division: {
        height: 669,
        orientation: 'vertical',
        width: 0,
        x: 475.5,
        y: 0,
    },
    posture: 'open',
    viewport: {
        height: 669,
        width: 951,
    },
};

const printedOpenBookFold = 'fold: {"display":"inner","division":{"height":669,"orientation":"vertical","width":0,"x":475.5,"y":0},"posture":"open","viewport":{"height":669,"width":951}}';

describe('parseFoldLines', () => {
    it('reads the FoldPayload line behind a log prefix and skips unrelated or invalid lines', () => {
        const text = [
            'unrelated simulator output',
            `2026-11-21 10:11:12.123 Demo[123:456] ${printedOpenBookFold}`,
            'fold: {malformed',
            `log prefix fold: ${JSON.stringify({ ...openBookFold, posture: 'unknown' })}`,
        ].join('\n');

        expect(parseFoldLines(text)).toEqual([openBookFold]);
    });

    it.each([
        ['a non-object payload', null],
        ['an unknown display', { ...openBookFold, display: 'both' }],
        ['a missing division', { ...openBookFold, division: undefined }],
        ['an unknown orientation', {
            ...openBookFold,
            division: { ...openBookFold.division, orientation: 'diagonal' },
        }],
        ['a negative division value', {
            ...openBookFold,
            division: { ...openBookFold.division, x: -1 },
        }],
        ['a non-finite division value', {
            ...openBookFold,
            division: { ...openBookFold.division, height: null },
        }],
        ['a missing viewport', { ...openBookFold, viewport: undefined }],
        ['a non-positive viewport value', {
            ...openBookFold,
            viewport: { ...openBookFold.viewport, width: 0 },
        }],
        ['a non-finite viewport value', {
            ...openBookFold,
            viewport: { ...openBookFold.viewport, height: null },
        }],
    ])('skips %s', (_name, payload) => {
        expect(parseFoldLines(`prefix ${printedOpenBookFold}\nfold: ${JSON.stringify(payload)}`))
            .toEqual([openBookFold]);
    });
});

describe('foldMeasurement', () => {
    it('builds exact measured states accepted for every Duo state', () => {
        const fixture = {
            device: 'XC iPhone Duo',
            measuredAt: '2026-11-21T18:22:31.123Z',
            states: Object.fromEntries(DUO_STATES.map((state) => [
                state,
                foldMeasurement(openBookFold),
            ])),
        };

        expect(foldMeasurement(openBookFold)).toEqual({
            width: 951,
            height: 669,
            division: {
                orientation: 'vertical',
                x: 475.5,
                y: 0,
                width: 0,
                height: 669,
            },
        });
        expect(Object.keys(foldMeasurement(openBookFold)).sort())
            .toEqual(['division', 'height', 'width']);
        expect(checkMeasuredWidths(fixture)).toEqual([]);
    });
});
