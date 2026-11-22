// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import schema from '../../../packages/core/src/watch/contract/request.schema.json';
import validate from '../../../packages/core/src/watch/contract/validate.js';

const loadFixture = (name) => JSON.parse(readFileSync(
    `test/fixtures/watch/${name}.json`,
    'utf8',
));

const fixtures = {
    confirm: loadFixture('request-confirm'),
    paydue: loadFixture('request-paydue'),
    expired: loadFixture('request-expired'),
};
const validatesRequest = new Ajv2020().compile(schema);

describe('watch request fixtures', () => {
    it.each(Object.entries(fixtures))('%s conforms to the request contract', (_, fixture) => {
        expect(validatesRequest(fixture), validatesRequest.errors).toBe(true);
        expect(validate(schema, fixture)).toEqual([]);
    });

    it('uses the specified request kinds and expiry values', () => {
        expect(fixtures.confirm.kind).toBe('request');
        expect(fixtures.confirm).not.toHaveProperty('expiresAt');
        expect(fixtures.paydue.kind).toBe('paydue');
        expect(fixtures.paydue.expiresAt).toBe(4_102_444_800_000);
        expect(fixtures.expired.kind).toBe('paydue');
        expect(fixtures.expired.expiresAt).toBe(946_684_800_000);
    });

    it('uses distinct lowercase hexadecimal IDs and SHA-256 image hashes', () => {
        const values = Object.values(fixtures);
        const ids = values.map(({ id }) => id);

        expect(new Set(ids).size).toBe(values.length);
        for (const fixture of values) {
            expect(fixture.id).toMatch(/^[0-9a-f]{32}$/);
            expect(fixture.iconHash).toMatch(/^[0-9a-f]{64}$/);
        }
    });

    it('keeps generated display text non-empty and free of em dashes', () => {
        for (const { sentence, amountText } of Object.values(fixtures)) {
            expect(sentence.length).toBeGreaterThan(0);
            expect(amountText.length).toBeGreaterThan(0);
            expect(sentence).not.toContain('\u2014');
        }
    });
});
