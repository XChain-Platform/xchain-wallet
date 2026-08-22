// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §54 FOLLOWUP 1: the ICU interpreter is now formatjs
// (`intl-messageformat`) rather than the hand-rolled subset. Covers:
//   1. The dependency is declared on the core package.
//   2. The capabilities the subset lacked now work (number / currency /
//      date / ordinal / nested patterns).
//   3. The two behaviours callers depend on survive the swap: a missing
//      arg renders its bare `{name}` token, and a malformed template
//      degrades instead of throwing.
//   4. Every ICU-bearing key in the English dictionary formats without
//      throwing for representative inputs.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// ─── 1. Dependency wired ──────────────────────────────────────────
const corePkg = JSON.parse(read('packages/core/package.json'));
assert.ok(
    corePkg.dependencies && corePkg.dependencies['intl-messageformat'],
    'core package declares intl-messageformat as a dependency',
);

const src = read('packages/core/src/i18n/index.js');
assert.match(
    src,
    /import \{ IntlMessageFormat \} from 'intl-messageformat'/,
    'i18n/index.js imports IntlMessageFormat',
);

const { format, t } = await import(
    join(root, 'packages/core/src/i18n/index.js')
);

// ─── 2. New capabilities the hand-rolled subset lacked ────────────

// Number formatting (locale grouping).
assert.strictEqual(
    format('{n, number}', { n: 1234567 }, 'en'),
    '1,234,567',
    'number formatting groups thousands',
);

// Currency skeleton.
assert.ok(
    format('{p, number, ::currency/USD}', { p: 5 }, 'en').includes('$5'),
    'currency skeleton renders a $ amount',
);

// Ordinal plural (selectordinal): the subset had no ordinals.
const ord = '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';
assert.strictEqual(format(ord, { n: 1 }, 'en'), '1st');
assert.strictEqual(format(ord, { n: 2 }, 'en'), '2nd');
assert.strictEqual(format(ord, { n: 3 }, 'en'), '3rd');
assert.strictEqual(format(ord, { n: 11 }, 'en'), '11th');

// Nested pattern: an arg referenced inside a plural case.
const nested =
    '{count, plural, one {# item for {who}} other {# items for {who}}}';
assert.strictEqual(
    format(nested, { count: 1, who: 'Ada' }, 'en'),
    '1 item for Ada',
);
assert.strictEqual(
    format(nested, { count: 3, who: 'Ada' }, 'en'),
    '3 items for Ada',
);

// ─── 3. Behaviours preserved from the pre-formatjs helper ─────────

// A referenced-but-missing arg renders its bare token (formatjs alone
// would throw here).
assert.strictEqual(format('Hi {who}', {}, 'en'), 'Hi {who}');
assert.strictEqual(format('{a} {b}', { a: 1 }, 'en'), '1 {b}');
// Missing arg nested inside a plural case also renders its token.
assert.strictEqual(
    format(nested, { count: 1 }, 'en'),
    '1 item for {who}',
);
// A missing arg of a coercing type (plural, selectordinal, number,
// date) renders its bare token too. Pre-filling those with the token
// string once made formatjs coerce it to NaN, shipping "NaN addresses"
// and "$NaN" to the user instead of the translator-visible placeholder.
for (const [tpl, expected] of [
    ['{count, plural, one {# address} other {# addresses}}', '{count} addresses'],
    ['{n, selectordinal, one {#st} other {#th}}', '{n}'],
    ['{n, number}', '{n}'],
    ['{n, number, ::currency/USD}', '{n}'],
    ['{d, date, medium}', '{d}'],
]) {
    const out = format(tpl, {}, 'en');
    assert.strictEqual(out, expected, `missing coercing arg renders its token: ${tpl}`);
    assert.ok(!/NaN|Invalid Date/.test(out), `no NaN leaks from ${tpl}`);
}
// The outer plural arg missing while an inner arg is supplied.
assert.strictEqual(format(nested, { who: 'Ada' }, 'en'), '{count} items for Ada');
// Supplied args in the same template keep formatjs formatting when only
// a simple arg is missing.
assert.strictEqual(format('{n, number} for {who}', { n: 1234 }, 'en'), '1,234 for {who}');

// A malformed template never throws at render; it degrades.
let threw = false;
let degraded;
try {
    degraded = format('unbalanced {oops', { oops: 'x' }, 'en');
} catch (_err) {
    threw = true;
}
assert.ok(!threw, 'malformed template does not throw');
assert.strictEqual(typeof degraded, 'string', 'malformed template returns a string');

// Non-string template coerced, no throw.
assert.strictEqual(format(42, {}, 'en'), '42');

// Existing subset behaviour still holds via formatjs.
assert.strictEqual(
    format('{c, plural, one {# address} other {# addresses}}', { c: 1 }, 'en'),
    '1 address',
);
assert.strictEqual(
    format('{k, select, mainnet {Live} other {Other}}', { k: 'mainnet' }, 'en'),
    'Live',
);
assert.strictEqual(t('home.addressCount', { count: 7 }), '7 addresses');

// ─── 4. Every ICU-bearing en key formats without throwing ─────────

const { en } = await import(
    join(root, 'packages/core/src/i18n/locales/en/index.js')
);

// Representative values for the arg names the dictionary uses.
const sampleVars = {
    count: 3, n: 2, total: 4, min: 8, reason: 'offline', type: 'unknown',
    kind: 'mainnet', name: 'BTC', who: 'Ada', p: 1, d: Date.now(),
};

let icuKeys = 0;
for (const [key, value] of Object.entries(en)) {
    if (typeof value !== 'string' || !value.includes('{')) continue;
    icuKeys += 1;
    let rendered;
    assert.doesNotThrow(() => {
        rendered = format(value, sampleVars, 'en');
    }, `key "${key}" formats without throwing`);
    assert.strictEqual(
        typeof rendered, 'string',
        `key "${key}" renders a string`,
    );
}

console.log(
    `OK: i18n formatjs smoke (number/currency/date/ordinal/nested + missing-arg + malformed fallback; ${icuKeys} ICU keys rendered)`,
);
