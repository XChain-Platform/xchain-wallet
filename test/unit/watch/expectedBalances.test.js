// @vitest-environment node
// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';

const fixtureRoot = 'test/fixtures/watch';
const expected = JSON.parse(readFileSync(
    `${fixtureRoot}/expected/balances.json`,
    'utf8',
));
const strings = JSON.parse(readFileSync(
    'packages/core/src/watch/contract/strings-balances.json',
    'utf8',
));
const snapshotNames = readdirSync(fixtureRoot)
    .filter((name) => /^snapshot-.*\.json$/u.test(name))
    .map((name) => basename(name, '.json'))
    .sort();

const loadFixture = (name) => JSON.parse(readFileSync(
    `${fixtureRoot}/${name}.json`,
    'utf8',
));

const valuesForProperty = (value, property) => {
    if (Array.isArray(value)) {
        return value.flatMap((entry) => valuesForProperty(entry, property));
    }
    if (!value || typeof value !== 'object') {
        return [];
    }

    return [
        ...(Object.hasOwn(value, property) ? [value[property]] : []),
        ...Object.values(value).flatMap((entry) => valuesForProperty(entry, property)),
    ];
};

const stringValues = (value) => {
    if (typeof value === 'string') {
        return [value];
    }
    if (Array.isArray(value)) {
        return value.flatMap(stringValues);
    }
    if (!value || typeof value !== 'object') {
        return [];
    }
    return Object.values(value).flatMap(stringValues);
};

const modesFor = (name) => Object.entries(expected[name]);

describe('expected watch balance models', () => {
    it('has one entry for every snapshot fixture', () => {
        expect(Object.keys(expected).sort()).toEqual(snapshotNames);
    });

    it.each(snapshotNames)('%s has complete fiat and units models', (name) => {
        const fixture = loadFixture(name);
        const fixtureCopy = new Set(stringValues(fixture));

        expect(Object.keys(expected[name]).sort()).toEqual(['fiat', 'units']);
        for (const [, model] of modesFor(name)) {
            expect(Object.keys(model)).toEqual(expect.arrayContaining([
                'header',
                'lines',
                'banners',
                'ageLine',
            ]));

            for (const key of [
                ...valuesForProperty(model, 'key'),
                ...model.banners,
                ...(model.ageLine === null ? [] : [model.ageLine]),
            ]) {
                expect(strings, `${name} references ${key}`).toHaveProperty(key);
            }
            for (const copy of [
                ...valuesForProperty(model, 'text'),
                ...valuesForProperty(model, 'name'),
            ]) {
                expect(fixtureCopy.has(copy), `${name} copies ${copy}`).toBe(true);
            }
        }
    });

    it.each(snapshotNames)('%s keeps the fixture row-line count', (name) => {
        const fixture = loadFixture(name);
        const rowCount = fixture.settings.enabled ? Math.min(fixture.rows.length, 50) : 0;
        const totalLineCount = fixture.settings.enabled
            ? rowCount + (fixture.rows.length === 0 || fixture.capped ? 1 : 0)
            : 0;

        for (const [, model] of modesFor(name)) {
            expect(model.lines.filter((line) => Object.hasOwn(line, 'name'))).toHaveLength(rowCount);
            expect(model.lines).toHaveLength(totalLineCount);
        }
    });

    it('uses amber age and the 24 hour banner at their boundaries', () => {
        for (const [, model] of modesFor('snapshot-stale')) {
            expect(model.ageLine).toBe('state.ageAmber');
            expect(model.banners).not.toContain('state.stale24h');
        }
        for (const [, model] of modesFor('snapshot-stale24')) {
            expect(model.ageLine).toBe('state.ageAmber');
            expect(model.banners).toContain('state.stale24h');
        }
    });

    it('keeps locked rows behind the locked banner', () => {
        const fixture = loadFixture('snapshot-locked');
        for (const [, model] of modesFor('snapshot-locked')) {
            expect(model.banners).toContain('state.locked');
            expect(model.lines.filter((line) => line.name)).toHaveLength(fixture.rows.length);
        }
    });

    it('puts unpriced units beneath the fiat cell', () => {
        const fixture = loadFixture('snapshot-unpriced');
        const line = expected['snapshot-unpriced'].fiat.lines[0];

        expect(line.primary).toEqual({ text: fixture.rows[0].fiatText });
        expect(line.secondary).toEqual({ text: fixture.rows[0].amountText });
    });

    it('redacts every hidden amount without retaining amount text', () => {
        const hidden = expected['snapshot-hidden'];

        expect(hidden.fiat.header).toEqual({ key: 'state.hidden' });
        for (const [, model] of Object.entries(hidden)) {
            expect(valuesForProperty(model, 'text')).toEqual([]);
            for (const line of model.lines.filter((entry) => entry.name)) {
                expect(line.primary).toEqual({ key: 'state.hidden' });
                expect(line.secondary).toBeNull();
            }
        }
    });

    it('uses the units model for both test-network modes', () => {
        const testnet = expected['snapshot-testnet'];

        expect(testnet.fiat).toEqual(testnet.units);
    });

    it('pins empty, capped, and disabled terminal lines', () => {
        expect(expected['snapshot-empty'].fiat.lines).toEqual([{ key: 'w1.empty' }]);
        expect(expected['snapshot-capped'].fiat.lines.at(-1)).toEqual({
            key: 'state.moreOnPhone',
        });
        const disabled = {
            header: null,
            lines: [],
            banners: ['state.watchDisabled'],
            ageLine: null,
        };
        expect(expected['snapshot-disabled']).toEqual({
            fiat: disabled,
            units: disabled,
        });
    });
});
