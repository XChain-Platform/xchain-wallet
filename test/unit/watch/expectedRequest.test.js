// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fixtureRoot = 'test/fixtures/watch';
const loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const expected = loadJson(`${fixtureRoot}/expected/request.json`);
const balanceStrings = loadJson('packages/core/src/watch/contract/strings-balances.json');
const alertStrings = loadJson('packages/core/src/watch/contract/strings-alerts.json');
const requestNames = readdirSync(fixtureRoot)
    .filter((name) => /^request-.*\.json$/u.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
const expectedNames = Object.keys(expected).filter((name) => name !== 'now').sort();

describe('watch expected request model', () => {
    it('has one expected entry for every request fixture', () => {
        expect(expected.now).toBe(1_700_000_000_000);
        expect(expectedNames).toEqual(requestNames);
    });

    it.each(requestNames)('%s uses contract strings and its own display values', (name) => {
        const fixture = loadJson(`${fixtureRoot}/${name}.json`);
        const entry = expected[name];

        expect(Object.hasOwn(balanceStrings, entry.pinned.key)).toBe(true);
        for (const line of entry.lines) {
            for (const key of [line.label?.key, line.value?.key].filter(Boolean)) {
                expect(Object.hasOwn(alertStrings, key), key).toBe(true);
            }
        }

        expect(entry.lines[0]).toEqual({
            label: { key: 'w4.requestSentence' },
            value: { text: fixture.sentence },
        });
        expect(entry.lines[1]).toEqual({
            label: { key: 'w4.requestAmount' },
            value: { text: fixture.amountText },
        });
        expect(entry.lines).toHaveLength(fixture.kind === 'paydue' ? 3 : 2);
    });

    it('keeps the expired request sentence and replaces only its expiry line', () => {
        const fixture = loadJson(`${fixtureRoot}/request-expired.json`);
        const entry = expected['request-expired'];

        expect(fixture.expiresAt).toBeLessThanOrEqual(expected.now);
        expect(entry.lines[0].value.text).toBe(fixture.sentence);
        expect(entry.lines.at(-1)).toEqual({
            label: null,
            value: { key: 'w4.requestExpired' },
        });
    });

    it('keeps the future paydue expiry as an epoch value', () => {
        const fixture = loadJson(`${fixtureRoot}/request-paydue.json`);
        const entry = expected['request-paydue'];

        expect(fixture.expiresAt).toBeGreaterThan(expected.now);
        expect(entry.lines.at(-1)).toEqual({
            label: { key: 'w4.requestExpiry' },
            value: { at: fixture.expiresAt },
        });
    });
});
