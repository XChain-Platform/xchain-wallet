// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke test for Batch 5 piece 17 (i18n scaffold).
//
// Covers:
//   1. Dictionary completeness — every key a live screen references
//      exists in en.js. Catches accidental inline-string drift.
//   2. t() lookup, interpolation, missing-key fallback.
//   3. format() pure substitution.
//   4. setLocale + onLocaleChange + registerLocale round-trip.
//   5. Missing keys in a non-default locale fall back to English.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { en } from '../../../packages/core/src/i18n/en.js';
import {
    availableLocales,
    format,
    getLocale,
    onLocaleChange,
    registerLocale,
    setLocale,
    t,
} from '../../../packages/core/src/i18n/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Dictionary surface -------------------------------------------

assert.ok(
    typeof en['brand.productName'] === 'string',
    'brand.productName defined',
);
assert.ok(typeof en['create.mnemonicTitle'] === 'string');
assert.ok(typeof en['send.memoForbiddenChars'] === 'string');

// Keys referenced by the extension + web shells should exist. The
// shells haven't been migrated to t() yet (that's a follow-up piece),
// but the dictionary must cover the copy those screens render so
// adoption is a drop-in.
const requiredKeys = [
    'common.back',
    'common.password',
    'session.lock',
    'session.unlock',
    'session.incorrectPassword',
    'home.send',
    'home.receive',
    'onboarding.create',
    'onboarding.import',
    'create.mnemonicTitle',
    'create.mnemonicAck',
    'import.wordCount',
    'send.memoForbiddenChars',
    'send.amountPositive',
    'send.failed',
    'extBanner.detected',
];
for (const key of requiredKeys) {
    assert.ok(key in en, `en dictionary has "${key}"`);
    assert.ok(
        typeof en[key] === 'string' && en[key].length > 0,
        `"${key}" is a non-empty string`,
    );
}

// No duplicate values that would hint at copy-paste errors (relaxed
// check — only flags 2+ keys that are exactly the same sentence).
const counts = {};
for (const [key, val] of Object.entries(en)) {
    counts[val] = (counts[val] || []);
    counts[val].push(key);
}
for (const [val, keys] of Object.entries(counts)) {
    if (keys.length > 1 && val.length > 20) {
        // Long phrases are more likely to be accidental duplicates;
        // short ones like "Back" / "Next" share copy legitimately.
        console.warn(
            `  (i18n warn) ${keys.length} keys share "${val.slice(0, 40)}…": ${keys.join(', ')}`,
        );
    }
}

// --- 2. t() lookup + interpolation -----------------------------------

assert.equal(t('brand.productName'), 'XChain Wallet');
assert.equal(
    t('create.passwordMinHint', { min: 8 }),
    'At least 8 characters.',
);
assert.equal(
    t('home.balanceUnavailable', { reason: 'SDK not wired' }),
    'Balance unavailable — SDK not wired',
);

// Missing vars render literally so translators can spot them.
assert.equal(
    t('home.balanceUnavailable'),
    'Balance unavailable — {reason}',
);

// Unknown keys return the key (so devs see missing-string tokens).
assert.equal(t('no.such.key'), 'no.such.key');

// --- 3. format() direct substitution ---------------------------------

assert.equal(format('hi {name}', { name: 'Ada' }), 'hi Ada');
assert.equal(
    format('{a} + {b} = {c}', { a: 1, b: 2, c: 3 }),
    '1 + 2 = 3',
);
// Missing placeholder preserved.
assert.equal(format('{a} {b}', { a: 1 }), '1 {b}');

// --- 4. Locale switching ---------------------------------------------

assert.equal(getLocale(), 'en');
assert.deepEqual(availableLocales(), ['en']);

let changes = 0;
const unsub = onLocaleChange(() => { changes += 1; });

// Register a pretend locale with a single override.
registerLocale('xx', { 'brand.productName': 'XChain Cüzdan' });
assert.deepEqual(availableLocales(), ['en', 'xx']);

setLocale('xx');
assert.equal(t('brand.productName'), 'XChain Cüzdan');
assert.equal(changes, 1, 'onLocaleChange fired once');

// Missing key in xx falls back to en.
assert.equal(t('session.unlock'), 'Unlock');

setLocale('en');
assert.equal(t('brand.productName'), 'XChain Wallet');
assert.equal(changes, 2);

unsub();
setLocale('xx');
setLocale('en');
assert.equal(changes, 2, 'unsubscribed callbacks stop firing');

// Guards
let threw = false;
try { setLocale('not-registered'); } catch (_err) { threw = true; }
assert.ok(threw, 'setLocale on unknown locale throws');

// --- 5. Core namespace export ---------------------------------------

const coreIdx = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'index.js'),
    'utf8',
);
assert.ok(
    /export \* as i18n from '\.\/i18n\/index\.js'/.test(coreIdx),
    "core/src/index.js re-exports the i18n namespace",
);

console.log(
    `OK — i18n smoke (${Object.keys(en).length} en keys, lookup/interpolate/fallback, ${availableLocales().length} locales registered, subscribe round-trip)`,
);
