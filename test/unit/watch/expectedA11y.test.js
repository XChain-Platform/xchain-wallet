// @vitest-environment node
// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const balances = loadJson('test/fixtures/watch/expected/balances.json');
const strings = loadJson(
    'packages/core/src/watch/contract/strings-balances.json',
);
const stringKeys = Object.keys(strings);
const snapshotNames = readdirSync('test/fixtures/watch')
    .filter((name) => /^snapshot-.*\.json$/u.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();

const spokenValue = (value) => {
    if (value === null) {
        return null;
    }
    return Object.hasOwn(value, 'text') ? value.text : strings[value.key];
};

const spokenLabel = (line) => {
    if (Object.hasOwn(line, 'key')) {
        return strings[line.key];
    }

    let primary = spokenValue(line.primary);
    if (line.primary.key === 'state.hidden') {
        primary = strings['state.amountHidden'];
    }

    return [line.name, primary, spokenValue(line.secondary)]
        .filter((part) => part !== null)
        .join(', ');
};

describe('expected watch balance accessibility labels', () => {
    it('covers every snapshot fixture', () => {
        expect(Object.keys(balances).sort()).toEqual(snapshotNames);
    });

    it.each(snapshotNames)('%s matches every rendered line', (name) => {
        const modes = balances[name];

        expect(Object.keys(modes).sort()).toEqual(['fiat', 'units']);
        for (const [mode, model] of Object.entries(modes)) {
            if (model.lines.length === 0) {
                expect(Object.hasOwn(model, 'a11y'), `${name} ${mode}`).toBe(false);
                continue;
            }

            expect(model.a11y, `${name} ${mode}`).toEqual(
                model.lines.map(spokenLabel),
            );
            expect(model.a11y, `${name} ${mode}`).toHaveLength(model.lines.length);

            for (const label of model.a11y) {
                expect(typeof label, `${name} ${mode}`).toBe('string');
                expect(label.trim(), `${name} ${mode}`).not.toBe('');
                expect(label, `${name} ${mode}`).not.toContain('••••');
                expect(
                    stringKeys.some((key) => label.includes(key)),
                    `${name} ${mode} exposes a string key in ${label}`,
                ).toBe(false);
            }
        }
    });

    it.each([
        [{ key: 'w1.empty' }, 'No balances yet'],
        [{
            name: 'Bitcoin',
            primary: { key: 'state.hidden' },
            secondary: null,
        }, 'Bitcoin, Amount hidden'],
        [{
            name: 'Bitcoin',
            primary: { key: 'state.balanceUnavailable' },
            secondary: null,
        }, 'Bitcoin, Balance unavailable'],
        [{
            name: 'Pepe Cash',
            primary: { text: 'No price yet' },
            secondary: { text: '1,000 PEPECASH' },
        }, 'Pepe Cash, No price yet, 1,000 PEPECASH'],
    ])('speaks %# as %s', (line, label) => {
        expect(spokenLabel(line)).toBe(label);
    });
});
