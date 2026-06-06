// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §54 / G172 no-jsx-literal-strings ESLint rule. Runs the
// rule's helper functions against synthesized AST fragments — no
// eslint dependency, just static analysis of the rule's own logic.

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// ─── Files exist ───────────────────────────────────────────────────

assert.ok(existsSync(join(root, 'tools/eslint/rules/no-jsx-literal-strings.js')),
    'rule file exists at the documented path');
assert.ok(existsSync(join(root, 'tools/eslint/plugin.js')),
    'plugin file exists at the documented path');

// ─── Helper behaviour ──────────────────────────────────────────────

const rule = await import(
    join(root, 'tools/eslint/rules/no-jsx-literal-strings.js')
);
const plugin = (await import(join(root, 'tools/eslint/plugin.js'))).default;

const { isTrivialString, findViolations, USER_FACING_ATTRS } = rule;

// Trivial-string heuristic.
assert.ok(isTrivialString(''),       'empty is trivial');
assert.ok(isTrivialString('  '),     'whitespace is trivial');
assert.ok(isTrivialString('•'),      'single punctuation is trivial');
assert.ok(isTrivialString('—'),      'em-dash is trivial');
assert.ok(isTrivialString('123'),    'all-digits is trivial');
assert.ok(isTrivialString('—', ['—']), 'allowlisted is trivial (redundant but safe)');
assert.ok(!isTrivialString('Hello'), 'word is non-trivial');
assert.ok(!isTrivialString('Sign in to continue'), 'sentence is non-trivial');
assert.ok(isTrivialString('Hello', ['Hello']), 'allow-listed sentence is trivial');

// USER_FACING_ATTRS set covers the documented attribute list.
for (const attr of ['aria-label', 'alt', 'title', 'placeholder', 'label', 'hint', 'caption', 'tooltip']) {
    assert.ok(USER_FACING_ATTRS.has(attr), `${attr} is in USER_FACING_ATTRS`);
}

// AST fragments — synthesized to exercise findViolations without
// depending on a real parser.
const jsxText = (value) => ({ type: 'JSXText', value });
const literal = (value) => ({ type: 'Literal', value });
const jsxAttr = (name, value) => ({
    type: 'JSXAttribute',
    name: { name },
    value,
});
const jsxExpr = (expression) => ({ type: 'JSXExpressionContainer', expression });
const jsxElement = (children = []) => ({ type: 'JSXElement', children });

// 1. Plain text content is flagged.
let v = findViolations(jsxElement([jsxText('Sign in to continue')]));
assert.strictEqual(v.length, 1, 'flags plain JSX text');
assert.match(v[0].message, /Sign in to continue/);

// 2. Whitespace-only text is not flagged.
v = findViolations(jsxElement([jsxText('  \n  ')]));
assert.strictEqual(v.length, 0, 'allows whitespace-only text');

// 3. aria-label literal is flagged.
v = findViolations(jsxAttr('aria-label', literal('Open menu')));
assert.strictEqual(v.length, 1, 'flags inline aria-label literal');
assert.match(v[0].message, /aria-label/);

// 4. className literal is NOT flagged (technical).
v = findViolations(jsxAttr('className', literal('btn btn--primary')));
assert.strictEqual(v.length, 0, 'allows className literal');

// 5. data-* literal is NOT flagged (technical).
v = findViolations(jsxAttr('data-testid', literal('login-button')));
assert.strictEqual(v.length, 0, 'allows data-* literal');

// 6. Allowlist suppresses a specific value.
v = findViolations(
    jsxElement([jsxText('XChain Wallet')]),
    { allow: ['XChain Wallet'] },
);
assert.strictEqual(v.length, 0, 'allowlist suppresses brand-name string');

// 7. JSX expression literal {'foo'} is flagged.
v = findViolations(jsxElement([jsxExpr(literal('Hello world'))]));
assert.strictEqual(v.length, 1, 'flags {literal} expression in JSX content');

// 8. minLength option respected.
v = findViolations(jsxElement([jsxText('OK')]), { minLength: 3 });
assert.strictEqual(v.length, 0, 'minLength=3 suppresses 2-char strings');

// ─── Plugin export shape ──────────────────────────────────────────

assert.ok(plugin && typeof plugin === 'object', 'plugin default export is an object');
assert.ok(plugin.rules && plugin.rules['no-jsx-literal-strings'],
    'plugin exposes no-jsx-literal-strings under rules');
const pluginRule = plugin.rules['no-jsx-literal-strings'];
assert.ok(pluginRule.meta && pluginRule.create, 'plugin rule has meta + create');
assert.strictEqual(pluginRule.meta.type, 'suggestion',
    'rule meta.type is suggestion (not error / problem)');

// ─── Fake ESLint context exercises create() ──────────────────────

const reports = [];
const fakeContext = {
    options: [{ allow: [] }],
    getFilename() { return 'REDACTED-LOCAL-PATH'; },
    report(r) { reports.push(r); },
};
const visitors = pluginRule.create(fakeContext);
visitors.JSXText({ type: 'JSXText', value: 'Hello translator' });
assert.strictEqual(reports.length, 1, 'create() returns visitors that wire context.report');

// File filtering — smoke-file path is auto-skipped.
const smokeContext = {
    options: [],
    getFilename() { return join(root, 'test/smoke/ui/some.smoke.js'); },
    report() { throw new Error('should not have been called'); },
};
const skipVisitors = pluginRule.create(smokeContext);
assert.strictEqual(Object.keys(skipVisitors).length, 0,
    'create() returns empty visitors for ignored files (test paths)');

// ─── Documentation header pin ─────────────────────────────────────

const ruleSrc = read('tools/eslint/rules/no-jsx-literal-strings.js');
assert.match(ruleSrc, /§54.*G172/, 'rule header references §54 / G172');
assert.match(ruleSrc, /eslint-disable-next-line @xchain\/no-jsx-literal-strings/,
    'rule documents the per-line disable comment');

console.log('OK — no-jsx-literal-strings rule + plugin + filename filter smoke');
