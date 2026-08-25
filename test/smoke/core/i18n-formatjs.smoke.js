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
//   4. Every ICU-bearing key in the English dictionary renders fully
//      against args derived from its own parsed AST, leaving no
//      residual `{token}`, NaN or Invalid Date.
//   5. A locale code Intl refuses does not silently disable formatjs.

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

// ─── 4. Every ICU-bearing en key renders with its OWN args ────────

const { en } = await import(
    join(root, 'packages/core/src/i18n/locales/en/index.js')
);
const { IntlMessageFormat } = await import('intl-messageformat');

// Handing every key one hand-written `sampleVars` object and asserting
// only `doesNotThrow` cannot fail: format() deliberately substitutes a
// bare `{name}` token for any arg the caller omits, so a key whose args
// are absent from that object renders as pure placeholder text and still
// passes - which is exactly the shape of the drift the sweep exists to
// catch. Derive each key's args from its own parsed AST instead, then
// assert nothing placeholder-shaped survives the render.

// formatjs element types, mirroring COERCING_ARG_TYPES in
// packages/core/src/i18n/index.js: 2 number, 3 date, 4 time and 6
// plural / selectordinal coerce their arg to a number or a date, so a
// string sample there renders "NaN" / "Invalid Date". The pin below is
// what keeps this copy of the table from drifting away from the
// production one silently.
assert.match(
    src,
    /const COERCING_ARG_TYPES = new Set\(\[2, 3, 4, 6\]\);/,
    'the coercing-arg-type table this sweep mirrors is unchanged',
);
const NUMERIC_ARG_TYPES = new Set([2, 6]);
const DATE_ARG_TYPES = new Set([3, 4]);
const SAMPLE_DATE = Date.UTC(2024, 3, 5);

/**
 * Walk a parsed ICU AST collecting arg name -> sample kind. Mirrors
 * collectArgNames: type 0 is a literal and 7 is `#` (neither names an
 * arg), type 8 is a tag whose `value` is the tag name, and options /
 * children hold nested patterns. A numeric or date use of a name wins
 * over a plain string use, the same way the production walk makes the
 * coercing flag sticky.
 */
function collectArgKinds(ast, out) {
    for (const el of ast) {
        if (el.type === 0 || el.type === 7) continue;
        if (el.type !== 8 && typeof el.value === 'string') {
            const kind = NUMERIC_ARG_TYPES.has(el.type) ? 'number'
                : DATE_ARG_TYPES.has(el.type) ? 'date' : 'string';
            const prior = out.get(el.value);
            if (prior === undefined || (prior === 'string' && kind !== 'string')) {
                out.set(el.value, kind);
            }
        }
        if (el.options) {
            for (const selector in el.options) {
                collectArgKinds(el.options[selector].value, out);
            }
        }
        if (el.children) collectArgKinds(el.children, out);
    }
    return out;
}

let icuKeys = 0;
for (const [key, value] of Object.entries(en)) {
    if (typeof value !== 'string' || !value.includes('{')) continue;
    icuKeys += 1;
    const kinds = collectArgKinds(
        new IntlMessageFormat(value, 'en').getAst(), new Map(),
    );
    const vars = {};
    for (const [name, kind] of kinds) {
        vars[name] = kind === 'number' ? 3 : kind === 'date' ? SAMPLE_DATE : 'x';
    }
    const rendered = format(value, vars, 'en');
    assert.strictEqual(
        typeof rendered, 'string',
        `key "${key}" renders a string`,
    );
    // The en dictionary carries no ICU-escaped literal braces today. If
    // a future key legitimately needs one, exempt that key by name here
    // rather than weakening the check for every other key.
    assert.ok(
        !/[{}]/.test(rendered),
        `key "${key}" leaves no residual placeholder: ${JSON.stringify(rendered)}`,
    );
    assert.ok(
        !/NaN|Invalid Date/.test(rendered),
        `key "${key}" leaks no NaN / Invalid Date: ${JSON.stringify(rendered)}`,
    );
}
// A sweep over an empty collection passes exactly like a real one.
assert.ok(icuKeys > 0, 'the sweep actually found ICU-bearing keys to render');

// ─── 5. An unusable locale tag must not disable formatjs ──────────
//
// Intl rejects a structurally invalid BCP-47 tag with a RangeError, and
// every Intl call on the render path sits inside a catch that degrades
// to legacyFormat - whose renderArg implements only plural and select.
// `pseudo-rtl` (the developer mirror locale) is exactly that shape, so
// before resolveFormatLocale every message under it rendered through
// the legacy path: `{n, number}` came out "1234", not "1,234", and the
// mirror locale could not catch the ICU regressions it exists to catch.

const warned = [];
const realWarn = console.warn;
console.warn = (...args) => { warned.push(args.join(' ')); };
try {
    for (const badTag of ['pseudo-rtl', 'not a locale!!']) {
        assert.strictEqual(
            format('{n, number}', { n: 1234 }, badTag), '1,234',
            `"${badTag}" still reaches formatjs number formatting`,
        );
        assert.strictEqual(
            format('{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
                { n: 2 }, badTag),
            '2nd',
            `"${badTag}" still reaches formatjs ordinals`,
        );
        assert.ok(
            /\d/.test(format('{d, date, medium}', { d: SAMPLE_DATE }, badTag)),
            `"${badTag}" still reaches formatjs date formatting`,
        );
    }
} finally {
    console.warn = realWarn;
}
// The degrade is loud, not silent: that is the half the old behaviour
// was missing, and an unwarned fallback would leave this array empty.
assert.ok(
    warned.some((line) => line.includes('pseudo-rtl')),
    'an unusable locale tag warns once rather than silently falling back',
);
// A valid tag is passed through untouched, so no real locale warns.
warned.length = 0;
console.warn = (...args) => { warned.push(args.join(' ')); };
try {
    assert.strictEqual(format('{n, number}', { n: 1234 }, 'en'), '1,234');
} finally {
    console.warn = realWarn;
}
assert.deepStrictEqual(warned, [], 'a valid locale tag never warns');

console.log(
    `OK: i18n formatjs smoke (number/currency/date/ordinal/nested + missing-arg + malformed fallback + unusable-locale-tag fallback; ${icuKeys} ICU keys rendered with AST-derived args)`,
);
