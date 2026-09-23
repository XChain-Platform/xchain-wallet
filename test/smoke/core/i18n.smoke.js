// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for Batch 5 piece 17 (i18n scaffold).
//
// Covers:
//   1. Dictionary surface: a hand-picked set of keys the extension and
//      web shells will need exists in en.js.
//   2. t() lookup, interpolation, missing-key fallback.
//   3. format() pure substitution.
//   4. setLocale + onLocaleChange + registerLocale round-trip.
//   5. Missing keys in a non-default locale fall back to English.
//   6. Call-site parity, derived from source: every dictionary key a
//      translated source file names exists in en.js, and every t() call
//      supplies each placeholder its message requires.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';

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

// Keys the extension + web shells will need. The shells do not call
// t() yet, but the dictionary must cover the copy those screens render
// so adoption is a drop-in. Keys already reached through t() are pinned
// from source by section 6, not by this list.
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
// check: only flags 2+ keys that are exactly the same sentence).
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
    'Balance unavailable: SDK not wired',
);

// Missing vars render literally so translators can spot them.
assert.equal(
    t('home.balanceUnavailable'),
    'Balance unavailable: {reason}',
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

// --- 6. Call-site parity, derived from source -------------------------
//
// t() never throws: an unknown key renders as the key itself and an
// unsupplied placeholder as a literal `{token}`. So a key dropped from
// the dictionary, or a `{when}` renamed on one side only, ships to the
// screen with nothing else failing. This sweep derives both directions
// from the source, so a new t() call is covered the day it lands.

const KEY_SHAPE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;
const NAMESPACES = new Set(Object.keys(en).map((k) => k.split('.')[0]));
const PAIRS = { '(': ')', '[': ']', '{': '}' };

// Identifier vars cannot be read from source; these files pin theirs by
// rendering every branch (xchain-uri-describe.smoke.js).
const VARS_PINNED_ELSEWHERE = new Set(['packages/core/src/uri/xchainUri.js']);

/** Collect every .js / .jsx file under `dir`, skipping the dictionaries. */
function sourceFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'i18n') continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) sourceFiles(path, out);
        else if (/\.jsx?$/.test(name)) out.push(path);
    }
    return out;
}

/** True when `s` is dotted like a key and opens with a dictionary namespace. */
function isDictionaryKey(s) {
    return KEY_SHAPE.test(s) && NAMESPACES.has(s.split('.')[0]);
}

/** Return every quoted dictionary-key literal in `text`. */
function keyLiterals(text) {
    return [...text.matchAll(/(['"])([^'"\n]+)\1/g)]
        .map((m) => m[2])
        .filter(isDictionaryKey);
}

/** Return the index just past the string or template opening at `i`. */
function skipString(src, i) {
    const quote = src[i];
    for (let j = i + 1; j < src.length; j++) {
        if (src[j] === '\\') { j++; continue; }
        if (quote === '`' && src[j] === '$' && src[j + 1] === '{') {
            j = balanced(src, j + 1).end;
            continue;
        }
        if (src[j] === quote) return j + 1;
    }
    return src.length;
}

/** Find the bracket closing `src[open]` and the depth-one comma positions. */
function balanced(src, open) {
    const stack = [PAIRS[src[open]]];
    const commas = [];
    let i = open + 1;
    while (i < src.length) {
        const c = src[i];
        if (c === "'" || c === '"' || c === '`') { i = skipString(src, i); continue; }
        if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
            const close = src.indexOf(src[i + 1] === '/' ? '\n' : '*/', i + 2);
            i = close < 0 ? src.length : close + (src[i + 1] === '/' ? 1 : 2);
            continue;
        }
        if (PAIRS[c]) stack.push(PAIRS[c]);
        else if (c === stack[stack.length - 1]) {
            stack.pop();
            if (stack.length === 0) return { end: i, commas };
        } else if (c === ',' && stack.length === 1) commas.push(i);
        i++;
    }
    return { end: src.length, commas };
}

/** Split the bracketed list opening at `open` into its top-level item texts. */
function items(src, open) {
    const { end, commas } = balanced(src, open);
    const bounds = [open, ...commas, end];
    return bounds.slice(1).map((b, k) => src.slice(bounds[k] + 1, b).trim()).filter(Boolean);
}

/** Property names of an object-literal vars argument, or null when unreadable. */
function suppliedVars(text) {
    if (text === undefined) return new Set();
    if (!text.startsWith('{')) return null;
    const names = new Set();
    for (const entry of items(text, 0)) {
        const m = /^(?:([A-Za-z_$][\w$]*)|'([^']*)'|"([^"]*)")\s*(?::|$)/.exec(entry);
        if (!m) return null;
        names.add(m[1] ?? m[2] ?? m[3]);
    }
    return names;
}

/** Placeholder names a dictionary message requires, read from its ICU AST. */
function requiredVars(message) {
    const names = new Set();
    const walk = (els) => {
        for (const el of els) {
            if (el.type >= 1 && el.type <= 6) names.add(el.value);
            for (const opt of Object.values(el.options ?? {})) walk(opt.value);
            if (el.children) walk(el.children);
        }
    };
    walk(new IntlMessageFormat(message, 'en').getAst());
    return names;
}

/** Map each UPPER_CASE const object table in `src` to its body text. */
function constTables(src) {
    const tables = new Map();
    for (const m of src.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*\{/g)) {
        const open = m.index + m[0].length - 1;
        tables.set(m[1], src.slice(open, balanced(src, open).end + 1));
    }
    return tables;
}

/** Yield { keys, vars } per t() call: keys reached, var names or null. */
function* tCalls(src) {
    const tables = constTables(src);
    for (const m of src.matchAll(/(?<![\w$.])t\(/g)) {
        const [keyArg, varsArg] = items(src, m.index + 1);
        if (keyArg === undefined) continue;
        const keys = keyLiterals(keyArg);
        for (const [name, body] of tables) {
            if (new RegExp(`\\b${name}\\b`).test(keyArg)) keys.push(...keyLiterals(body));
        }
        yield { keys, vars: suppliedVars(varsArg) };
    }
}

const packagesDir = join(wsRoot, 'packages');
const translated = readdirSync(packagesDir)
    .map((pkg) => join(packagesDir, pkg, 'src'))
    .filter((dir) => { try { return statSync(dir).isDirectory(); } catch { return false; } })
    .flatMap((dir) => sourceFiles(dir))
    .map((f) => ({ rel: relative(wsRoot, f).split('\\').join('/'), src: readFileSync(f, 'utf8') }))
    .filter(({ src }) => [...src.matchAll(/(?<![\w$.])t\(\s*['"]([^'"]+)['"]/g)].some((m) => isDictionaryKey(m[1])));

const seenKeys = new Set();
for (const { rel, src } of translated) {
    for (const key of keyLiterals(src)) {
        seenKeys.add(key);
        assert.ok(typeof en[key] === 'string' && en[key].length > 0,
            `${rel} names "${key}", which en.js does not define`);
    }
}

const placeholderChecked = new Set();
let unresolvedCalls = 0;
for (const { rel, src } of translated) {
    for (const { keys, vars } of tCalls(src)) {
        if (keys.length === 0) { unresolvedCalls += 1; continue; }
        if (vars === null) {
            assert.ok(VARS_PINNED_ELSEWHERE.has(rel),
                `${rel} passes t('${keys[0]}') vars this sweep cannot read; pass an object literal`);
            continue;
        }
        for (const key of keys) {
            const missing = [...requiredVars(en[key])].filter((name) => !vars.has(name));
            assert.deepEqual(missing, [],
                `${rel}: t('${key}') does not supply {${missing.join('}, {')}}`);
            placeholderChecked.add(key);
        }
    }
}

// A sweep over an empty selection passes exactly like a real one.
for (const f of ['shared/routes/History.jsx', 'shared/routes/Send.jsx', 'shared/routes/ScanRoute.jsx', 'uri/xchainUri.js']) {
    assert.ok(translated.some(({ rel }) => rel === `packages/core/src/${f}`), `sweep reads ${f}`);
}
for (const key of ['pending.row.seen', 'pending.detail.memo', 'send.success.viewInHistory', 'scan.title', 'uri.intent.sendTo']) {
    assert.ok(seenKeys.has(key), `existence sweep reaches "${key}"`);
}
for (const key of ['pending.detail.firstSeen', 'pending.detail.sendOutput', 'pending.amount.sending', 'scan.error.xcwChunk']) {
    assert.ok(placeholderChecked.has(key), `placeholder sweep reaches "${key}"`);
}

console.log(
    `OK: i18n smoke (${Object.keys(en).length} en keys, lookup/interpolate/fallback, ${availableLocales().length} locales registered, subscribe round-trip, `
    + `${seenKeys.size} source keys in ${translated.length} files, ${placeholderChecked.size} placeholder-checked, ${unresolvedCalls} dynamic-key calls)`,
);
