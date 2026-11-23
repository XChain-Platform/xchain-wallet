// @vitest-environment node
// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
    redactAddresses,
    watchInboxKind,
} from '../../../packages/core/src/watch/buildWatchInbox.js';
import schema from '../../../packages/core/src/watch/contract/inbox.schema.json';
import kinds from '../../../packages/core/src/watch/contract/kinds.json';
import validate from '../../../packages/core/src/watch/contract/validate.js';

const fixture = JSON.parse(readFileSync(
    'test/fixtures/watch/inbox-alerts.json',
    'utf8',
));
const validatesInbox = new Ajv2020().compile(schema);
const snapshotBuiltAt = 1_700_000_000_000;
const minute = 60 * 1000;
const hour = 60 * minute;

describe('watch inbox alert fixture', () => {
    it('conforms to the inbox contract at its item limit', () => {
        expect(validatesInbox(fixture), validatesInbox.errors).toBe(true);
        expect(validate(schema, fixture)).toEqual([]);
        expect(fixture).toHaveLength(schema.maxItems);
    });

    it('uses distinct classified IDs and covers every alert kind', () => {
        const ids = fixture.map(({ id }) => id);
        const expectedKinds = Object.values(kinds).flatMap(({ kinds: values }) => values);

        expect(new Set(ids).size).toBe(fixture.length);
        for (const entry of fixture) {
            expect(entry.id).toMatch(/^notification:[^:]+:.+$/);
            expect(watchInboxKind(entry.id, kinds)).toEqual({
                kind: entry.kind,
                family: entry.family,
            });
        }
        expect(new Set(fixture.map(({ kind }) => kind))).toEqual(new Set(expectedKinds));
    });

    it('is newest first across each required age range', () => {
        const ages = fixture.map(({ at }) => snapshotBuiltAt - at);

        expect(fixture.every(({ at }) => at <= snapshotBuiltAt)).toBe(true);
        expect(fixture.every(({ at }, index) => (
            index === 0 || at < fixture[index - 1].at
        ))).toBe(true);
        expect(ages.some((age) => age >= 0 && age < minute)).toBe(true);
        expect(ages.some((age) => age >= minute && age < hour)).toBe(true);
        expect(ages.some((age) => age >= hour && age < 24 * hour)).toBe(true);
        expect(ages.some((age) => age >= 24 * hour)).toBe(true);
    });

    it('starts unread and includes both read states', () => {
        expect(fixture[0].read).toBe(false);
        expect(new Set(fixture.map(({ read }) => read))).toEqual(new Set([false, true]));
    });

    it('uses printable address-free display text at the boundary lengths', () => {
        const isPrintableAscii = (text) => [...text].every((character) => {
            const point = character.codePointAt(0);
            return point >= 0x20 && point <= 0x7e;
        });

        for (const { title, body } of fixture) {
            expect(title.length).toBeGreaterThan(0);
            expect(isPrintableAscii(title)).toBe(true);
            expect(isPrintableAscii(body)).toBe(true);
            expect(redactAddresses(title, 'an address')).toBe(title);
            expect(redactAddresses(body, 'an address')).toBe(body);
        }
        expect(fixture.filter(({ body }) => body === '')).toHaveLength(1);
        expect(fixture.filter(({ title }) => title.length === 60)).toHaveLength(1);
        expect(fixture.filter(({ body }) => body.length === 160)).toHaveLength(1);
    });
});
