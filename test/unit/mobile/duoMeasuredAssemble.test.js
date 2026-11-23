// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    DUO_STATES,
    buildMeasuredWidths,
    checkMeasuredWidths,
    parseFoldLines,
} from '../../../packages/mobile/scripts/duo-fixture.js';

const closedPortraitFold = {
    display: 'outer',
    division: {
        height: 0,
        orientation: 'none',
        width: 0,
        x: 0,
        y: 0,
    },
    posture: 'closed',
    viewport: {
        height: 669,
        width: 475,
    },
};

const earlierOpenPortraitFold = {
    display: 'inner',
    division: {
        height: 669,
        orientation: 'vertical',
        width: 12,
        x: 469.5,
        y: 0,
    },
    posture: 'open',
    viewport: {
        height: 669,
        width: 951,
    },
};

const settledOpenPortraitFold = {
    ...earlierOpenPortraitFold,
    division: {
        ...earlierOpenPortraitFold.division,
        width: 0,
        x: 475.5,
    },
};

function parsedFolds(...folds) {
    return parseFoldLines(folds.map((fold) => `Book log fold: ${JSON.stringify(fold)}`).join('\n'));
}

function validInput() {
    return {
        device: 'XC iPhone Duo',
        measuredAt: '2026-11-22T18:22:31.123Z',
        folds: {
            'closed-portrait': parsedFolds(closedPortraitFold),
            'open-portrait': parsedFolds(earlierOpenPortraitFold, settledOpenPortraitFold),
        },
        unreachable: {
            'closed-landscape': ' simulator cannot rotate the outer display ',
            'open-landscape': 'simulator posture is unavailable',
            'partial-vertical': 'simulator posture is unavailable',
            'partial-horizontal': 'simulator posture is unavailable',
        },
    };
}

describe('buildMeasuredWidths', () => {
    it('assembles settled readings and unreachable reasons in Duo state order', () => {
        const input = validInput();
        const before = structuredClone(input);
        const fixture = buildMeasuredWidths(input);

        expect(Object.keys(fixture.states)).toEqual(DUO_STATES);
        expect(fixture).toEqual({
            device: 'XC iPhone Duo',
            measuredAt: '2026-11-22T18:22:31.123Z',
            states: {
                'closed-portrait': {
                    width: 475,
                    height: 669,
                    division: {
                        orientation: 'none',
                        x: 0,
                        y: 0,
                        width: 0,
                        height: 0,
                    },
                },
                'closed-landscape': {
                    unreachable: 'simulator cannot rotate the outer display',
                },
                'open-portrait': {
                    width: 951,
                    height: 669,
                    division: {
                        orientation: 'vertical',
                        x: 475.5,
                        y: 0,
                        width: 0,
                        height: 669,
                    },
                },
                'open-landscape': { unreachable: 'simulator posture is unavailable' },
                'partial-vertical': { unreachable: 'simulator posture is unavailable' },
                'partial-horizontal': { unreachable: 'simulator posture is unavailable' },
            },
        });
        expect(checkMeasuredWidths(fixture)).toEqual([]);
        expect(input).toEqual(before);
    });

    it.each([
        [
            'an unknown folds state',
            () => {
                const input = validInput();
                input.folds['tent-mode'] = [];
                return input;
            },
            'tent-mode',
        ],
        [
            'an unknown unreachable state',
            () => {
                const input = validInput();
                input.unreachable['tent-mode'] = 'not supported';
                return input;
            },
            'tent-mode',
        ],
        [
            'both a reading and a reason',
            () => {
                const input = validInput();
                input.unreachable['open-portrait'] = 'not supported';
                return input;
            },
            'open-portrait',
        ],
        [
            'a blank reason',
            () => {
                const input = validInput();
                input.unreachable['closed-landscape'] = '  ';
                return input;
            },
            'closed-landscape',
        ],
        [
            'neither a reading nor a reason',
            () => {
                const input = validInput();
                delete input.unreachable['partial-horizontal'];
                return input;
            },
            'partial-horizontal',
        ],
    ])('throws a TypeError naming the state for %s', (_name, makeInput, stateName) => {
        expect(() => buildMeasuredWidths(makeInput())).toThrowError(TypeError);
        expect(() => buildMeasuredWidths(makeInput())).toThrowError(stateName);
    });
});
