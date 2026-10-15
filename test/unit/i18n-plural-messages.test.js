// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from 'vitest';

import { format } from '../../packages/core/src/i18n/index.js';
import { en } from '../../packages/core/src/i18n/locales/en/index.js';

// Counted copy lives in ICU plural messages, never in a hand-rolled
// `n === 1 ? '' : 's'` suffix, so every plural and number message in the
// dictionary has to format cleanly at one and at many.
const ICU_ARGUMENT = /\{\s*([A-Za-z_]\w*)\s*(?:,\s*(plural|number|selectordinal))?/g;

function varsFor(template, count) {
    const vars = {};
    for (const match of template.matchAll(ICU_ARGUMENT)) {
        vars[match[1]] = match[2] ? count : 'x';
    }
    return vars;
}

const pluralEntries = Object.entries(en).filter(([, value]) => /,\s*plural\s*,/.test(value));

describe('ICU plural messages', () => {
    test('the dictionary carries plural messages for counted copy', () => {
        expect(pluralEntries.length).toBeGreaterThan(20);
    });

    test.each(pluralEntries)('%s formats at one and at many', (key, template) => {
        expect(template).toMatch(/other\s*\{/);
        for (const count of [0, 1, 2, 1234]) {
            const out = format(template, varsFor(template, count));
            expect(out, `${key} at ${count}`).not.toMatch(/\{|NaN|undefined/);
        }
    });

    test('counted English copy uses the singular at exactly one', () => {
        expect(format(en['settings.contacts.storedCount'], { count: 1 })).toBe('1 contact stored');
        expect(format(en['settings.contacts.storedCount'], { count: 2 })).toBe('2 contacts stored');
        expect(format(en['locked.countdown.seconds'], { count: 1 })).toBe('1 second');
        expect(format(en['locked.countdown.minutes'], { count: 3 })).toBe('3 minutes');
        expect(format(en['settings.page.donatedOn'], { sats: 1234567 })).toBe('On · 1,234,567 sats donated');
    });
});
