// @vitest-environment node

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as fs from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

import {
    DUO_MEASURED_PATH,
    loadDuoViewports,
} from '../../e2e/fixtures/duoMeasured.js';
import { duoViewports } from '../../e2e/fixtures/duoViewports.js';

const TMP_ROOT = fileURLToPath(new URL('../../../tmp/', import.meta.url));
let directory;

function measuredFixture() {
    return {
        device: 'XC iPhone Duo',
        measuredAt: '2026-11-20T18:22:31.123Z',
        states: {
            'closed-portrait': {
                width: 466,
                height: 678,
                division: { orientation: 'none', x: 0, y: 0, width: 0, height: 0 },
            },
            'closed-landscape': {
                width: 678,
                height: 466,
                division: { orientation: 'none', x: 0, y: 0, width: 0, height: 0 },
            },
            'open-portrait': {
                width: 951,
                height: 669,
                division: { orientation: 'vertical', x: 475.5, y: 0, width: 0, height: 669 },
            },
            'open-landscape': {
                width: 669,
                height: 951,
                division: { orientation: 'horizontal', x: 0, y: 475.5, width: 669, height: 0 },
            },
            'partial-vertical': { unreachable: 'not exposed by simulator' },
            'partial-horizontal': { unreachable: 'not exposed by simulator' },
        },
    };
}

function writeFixture(name, value) {
    const path = `${directory}/${name}`;
    fs.writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
    return path;
}

function thrownBy(path) {
    try {
        loadDuoViewports(path);
    } catch (error) {
        return error;
    }
    throw new Error(`Expected ${path} to fail`);
}

function expectPathFirstError(path) {
    const error = thrownBy(path);
    expect(error).toBeInstanceOf(Error);
    expect(error.message.startsWith(`${path}:`)).toBe(true);
    return error;
}

beforeEach(() => {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    directory = fs.mkdtempSync(`${TMP_ROOT}duo-measured-`);
});

afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
});

it('loads the four measured states in Duo order', () => {
    const measured = measuredFixture();
    const path = writeFixture('measured-widths.json', measured);

    const viewports = loadDuoViewports(path);

    expect(viewports).toEqual(duoViewports(measured));
    expect(viewports.map(({ name }) => name)).toEqual([
        'Duo closed-portrait',
        'Duo closed-landscape',
        'Duo open-portrait',
        'Duo open-landscape',
    ]);
});

it('includes the missing path when the fixture cannot be read', () => {
    const path = `${directory}/missing.json`;

    expectPathFirstError(path);
});

it('includes the path when the fixture is not JSON', () => {
    const path = writeFixture('invalid.json', 'not json');

    expectPathFirstError(path);
});

it('reports a missing measuredAt with the path', () => {
    const measured = measuredFixture();
    delete measured.measuredAt;
    const path = writeFixture('invalid-shape.json', measured);

    expect(expectPathFirstError(path)).toMatchObject({
        message: `${path}: measuredAt must be an ISO 8601 timestamp`,
    });
});

it('joins every validation problem', () => {
    const measured = measuredFixture();
    measured.device = '';
    measured.measuredAt = 'not a timestamp';
    const path = writeFixture('multiple-problems.json', measured);

    expect(expectPathFirstError(path)).toMatchObject({
        message: `${path}: device must be a non-empty string; measuredAt must be an ISO 8601 timestamp`,
    });
});

it('rejects a valid fixture with no reachable main state', () => {
    const measured = measuredFixture();
    for (const state of [
        'closed-portrait',
        'closed-landscape',
        'open-portrait',
        'open-landscape',
    ]) {
        measured.states[state] = { unreachable: 'not exposed by simulator' };
    }
    const path = writeFixture('unreachable.json', measured);

    expectPathFirstError(path);
});

it('exports the absolute measured widths fixture path', () => {
    expect(isAbsolute(DUO_MEASURED_PATH)).toBe(true);
    expect(DUO_MEASURED_PATH).toMatch(/test\/fixtures\/duo\/measured-widths\.json$/);
});
