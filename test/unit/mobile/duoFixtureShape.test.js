// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    DUO_STATES,
    checkMeasuredWidths,
} from '../../../packages/mobile/scripts/duo-fixture.js';

const division = {
    orientation: 'vertical',
    x: 474,
    y: 0,
    width: 3,
    height: 669,
};

function validFixture() {
    return {
        device: 'XC iPhone Duo',
        measuredAt: '2026-11-20T18:22:31.123Z',
        states: Object.fromEntries(DUO_STATES.map((name, index) => [
            name,
            index < 4
                ? {
                    width: 951,
                    height: 669,
                    division: {
                        ...division,
                        orientation: ['vertical', 'horizontal', 'none', 'vertical'][index],
                    },
                }
                : { unreachable: `simctl does not expose ${name}` },
        ])),
    };
}

function changeFixture(change) {
    const fixture = validFixture();
    change(fixture);
    return fixture;
}

describe('checkMeasuredWidths', () => {
    it('accepts every named state measured or marked unreachable', () => {
        const fixture = validFixture();
        const before = structuredClone(fixture);
        expect(DUO_STATES).toEqual([
            'closed-portrait',
            'closed-landscape',
            'open-portrait',
            'open-landscape',
            'partial-vertical',
            'partial-horizontal',
        ]);
        expect(Object.isFrozen(DUO_STATES)).toBe(true);
        expect(checkMeasuredWidths(fixture)).toEqual([]);
        expect(fixture).toEqual(before);
    });

    it.each([
        ['a non-object fixture', null, 'fixture must be an object'],
        [
            'an empty device',
            changeFixture((fixture) => { fixture.device = '  '; }),
            'device must be a non-empty string',
        ],
        [
            'an invalid timestamp',
            changeFixture((fixture) => { fixture.measuredAt = '2026-02-30T10:00:00Z'; }),
            'measuredAt must be an ISO 8601 timestamp',
        ],
        [
            'non-object states',
            changeFixture((fixture) => { fixture.states = []; }),
            'states must be an object',
        ],
        [
            'a missing state',
            changeFixture((fixture) => { delete fixture.states['closed-portrait']; }),
            `states must contain exactly: ${DUO_STATES.join(', ')}`,
        ],
        [
            'an extra state',
            changeFixture((fixture) => { fixture.states.extra = { unreachable: 'not supported' }; }),
            `states must contain exactly: ${DUO_STATES.join(', ')}`,
        ],
        [
            'a non-object state',
            changeFixture((fixture) => { fixture.states['closed-portrait'] = null; }),
            'states.closed-portrait must be an object',
        ],
        [
            'an empty unreachable reason',
            changeFixture((fixture) => {
                fixture.states['closed-portrait'] = { unreachable: ' ' };
            }),
            'states.closed-portrait.unreachable must be a non-empty string',
        ],
        [
            'fields beside unreachable',
            changeFixture((fixture) => {
                fixture.states['closed-portrait'] = { unreachable: 'not supported', width: 951 };
            }),
            'states.closed-portrait must contain only unreachable',
        ],
        [
            'an incomplete measurement',
            changeFixture((fixture) => { delete fixture.states['closed-portrait'].division; }),
            'states.closed-portrait must contain exactly width, height, division',
        ],
        [
            'a non-positive width',
            changeFixture((fixture) => { fixture.states['closed-portrait'].width = 0; }),
            'states.closed-portrait.width must be a finite positive number',
        ],
        [
            'a non-finite height',
            changeFixture((fixture) => { fixture.states['closed-portrait'].height = Infinity; }),
            'states.closed-portrait.height must be a finite positive number',
        ],
        [
            'a non-object division',
            changeFixture((fixture) => { fixture.states['closed-portrait'].division = null; }),
            'states.closed-portrait.division must be an object',
        ],
        [
            'an incomplete division',
            changeFixture((fixture) => {
                delete fixture.states['closed-portrait'].division.height;
            }),
            'states.closed-portrait.division must contain exactly orientation, x, y, width, height',
        ],
        [
            'an invalid division orientation',
            changeFixture((fixture) => {
                fixture.states['closed-portrait'].division.orientation = 'diagonal';
            }),
            'states.closed-portrait.division.orientation must be vertical, horizontal or none',
        ],
        ...['x', 'y', 'width', 'height'].map((name) => [
            `an invalid division ${name}`,
            changeFixture((fixture) => {
                fixture.states['closed-portrait'].division[name] = name === 'x' ? NaN : -1;
            }),
            `states.closed-portrait.division.${name} must be a finite non-negative number`,
        ]),
    ])('reports %s', (_name, fixture, problem) => {
        expect(checkMeasuredWidths(fixture)).toEqual([problem]);
    });
});
