// @vitest-environment node
// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fixtureRoot = 'test/fixtures/watch';
const contractRoot = 'packages/core/src/watch/contract';
const loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const balances = loadJson(`${fixtureRoot}/expected/balances.json`);
const requests = loadJson(`${fixtureRoot}/expected/request.json`);
const fixtureNames = (prefix) => readdirSync(fixtureRoot)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
const stringKeys = new Set(readdirSync(contractRoot)
    .filter((name) => /^strings-.*\.json$/u.test(name))
    .flatMap((name) => Object.keys(loadJson(`${contractRoot}/${name}`))));

const referencedStringKeys = (value, field = '') => {
    if (Array.isArray(value)) {
        if (field === 'banners') {
            return value;
        }
        return value.flatMap((entry) => referencedStringKeys(entry));
    }
    if (!value || typeof value !== 'object') {
        return field === 'key' || field === 'ageLine' ? [value] : [];
    }

    return Object.entries(value).flatMap(([name, entry]) => (
        referencedStringKeys(entry, name)
    ));
};

const missingStringKeys = (model) => referencedStringKeys(model)
    .filter((key) => typeof key === 'string' && !stringKeys.has(key));

describe('shared watch expected models', () => {
    it('has one balance model for every snapshot fixture', () => {
        expect(Object.keys(balances).sort()).toEqual(fixtureNames('snapshot'));
    });

    it('has one request model for every request fixture', () => {
        expect(Object.keys(requests).filter((name) => name !== 'now').sort())
            .toEqual(fixtureNames('request'));
    });

    it.each([
        ['balances', balances],
        ['requests', requests],
    ])('%s references only keys from the watch string files', (name, model) => {
        expect(missingStringKeys(model), name).toEqual([]);
    });

    it('detects a display key absent from the watch string files', () => {
        expect(missingStringKeys({ key: 'missing.display.key' }))
            .toEqual(['missing.display.key']);
    });
});
