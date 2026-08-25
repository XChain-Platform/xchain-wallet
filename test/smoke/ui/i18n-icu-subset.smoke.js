// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §54 / G173: the i18n/locales directory layout, plus the
// plural / select / mixed templates the `en` dictionary uses today,
// rendered through formatjs. The smoke runs the format helper at
// runtime (unlike most other smokes, which are static-text only)
// because rendering is the load-bearing piece and a regression there
// would slip past a regex.
//
// The interpreter is NOT a hand-rolled ICU subset any more. `format()`
// renders through `IntlMessageFormat` (see the corrected header at
// packages/core/src/i18n/locales/en/index.js:21-28), and the old subset
// survives only as `legacyFormat()`, reached on exactly two routes: a
// coercing arg (plural / number / date) the caller omitted, and a
// template formatjs refuses to parse. Item 9 below pins the first of
// those; nothing above it touches the legacy path at all.

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// ─── Layout ────────────────────────────────────────────────────────

const localesDir = join(root, 'packages/core/src/i18n/locales');
assert.ok(
    existsSync(localesDir) && statSync(localesDir).isDirectory(),
    'i18n/locales directory exists',
);
const enDir = join(localesDir, 'en');
assert.ok(
    existsSync(enDir) && statSync(enDir).isDirectory(),
    'i18n/locales/en directory exists',
);
assert.ok(
    existsSync(join(enDir, 'index.js')),
    'i18n/locales/en/index.js exists',
);

// Back-compat shim still re-exports the dict so existing consumers
// don't have to be touched in one step.
const shimSrc = read('packages/core/src/i18n/en.js');
assert.match(
    shimSrc,
    /export \{ en \} from '\.\/locales\/en\/index\.js'/,
    'i18n/en.js still re-exports from the new path',
);

// ─── ICU interpreter ──────────────────────────────────────────────

const { format, t } = await import(
    join(root, 'packages/core/src/i18n/index.js')
);

// 1. Plain substitution.
assert.strictEqual(format('Hello {name}!', { name: 'world' }), 'Hello world!');

// 2. Plural: singular vs other.
const tmpl = '{count, plural, one {# address} other {# addresses}}';
assert.strictEqual(format(tmpl, { count: 1 }), '1 address');
assert.strictEqual(format(tmpl, { count: 2 }), '2 addresses');
assert.strictEqual(format(tmpl, { count: 0 }), '0 addresses');

// 3. Plural: `=N` exact match wins over the plural category.
const exactTmpl = '{count, plural, =0 {none} one {one} other {many}}';
assert.strictEqual(format(exactTmpl, { count: 0 }), 'none');
assert.strictEqual(format(exactTmpl, { count: 1 }), 'one');
assert.strictEqual(format(exactTmpl, { count: 5 }), 'many');

// 4. Select: exact match with fallback to `other`.
const selTmpl = '{kind, select, mainnet {Live} testnet {Testnet} other {Other}}';
assert.strictEqual(format(selTmpl, { kind: 'mainnet' }), 'Live');
assert.strictEqual(format(selTmpl, { kind: 'testnet' }), 'Testnet');
assert.strictEqual(format(selTmpl, { kind: 'regtest' }), 'Other');

// 5. Mixed: substitution alongside ICU plural in the same string.
const mixed = '{name}: {count, plural, one {# address} other {# addresses}}';
assert.strictEqual(
    format(mixed, { name: 'BTC', count: 3 }),
    'BTC: 3 addresses',
);

// 6. Missing var renders the bare placeholder so translators can spot
//    it. (Same behaviour as the original simple-substitution helper.)
assert.strictEqual(format('Hi {missing}', {}), 'Hi {missing}');

// 7. The dictionary picked up the ICU plural for home.addressCount.
assert.strictEqual(t('home.addressCount', { count: 1 }), '1 address');
assert.strictEqual(t('home.addressCount', { count: 7 }), '7 addresses');

// 8. A dictionary key carrying a simple `{name}` placeholder renders
//    correctly. This runs through formatjs like every other key: the
//    single arg is supplied, so neither legacy route is taken. It was
//    once labelled a legacy-path regression guard, which made a green
//    run read as proof the fallback was healthy while the fallback was
//    untouched on this input.
assert.strictEqual(
    t('home.balanceUnavailable', { reason: 'offline' }),
    'Balance unavailable: offline',
);

// 9. The legacy fallback itself, on the route a real dictionary key can
//    take: `home.addressCount` is an ICU plural, and a plural arg the
//    caller omits cannot be pre-filled with its own token (the token
//    string would coerce to NaN), so format() hands the whole template
//    to legacyFormat, which emits bare tokens for every arg. Supplying
//    `count` instead renders through formatjs, as item 7 shows.
assert.strictEqual(
    t('home.addressCount', {}),
    '{count} addresses',
);

console.log('OK: i18n locales layout + formatjs rendering (plural / select / mixed) + legacy-fallback route smoke');
