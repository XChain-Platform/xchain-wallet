// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
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
// The filter admits no letters at all. The header used to advertise a
// one-ASCII-letter allowance naming these exact tokens, so pin them.
assert.ok(!isTrivialString('0x'),    '"0x" carries a letter, so it is non-trivial');
assert.ok(!isTrivialString('1d'),    '"1d" carries a letter, so it is non-trivial');
assert.ok(!isTrivialString('v2'),    '"v2" carries a letter, so it is non-trivial');
assert.ok(isTrivialString('—', ['—']), 'allowlisted is trivial (redundant but safe)');
assert.ok(!isTrivialString('Hello'), 'word is non-trivial');
assert.ok(!isTrivialString('Sign in to continue'), 'sentence is non-trivial');
assert.ok(isTrivialString('Hello', ['Hello']), 'allow-listed sentence is trivial');

// USER_FACING_ATTRS set covers the documented attribute list.
// The last four are component props: copy shipped through them escaped
// the translator index while the set held DOM attribute names only.
// Every documented name is listed here, and the size assertion below
// closes the other direction: this loop once pinned 11 of 13 members, so
// dropping aria-description or aria-roledescription from the rule left
// the smoke green and the header's claim of coverage silently false.
const DOCUMENTED_USER_FACING_ATTRS = [
    'aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext',
    'alt', 'title', 'placeholder', 'label', 'hint', 'caption', 'tooltip',
    'heading', 'emptyText', 'actionLabel', 'backLabel',
];
for (const attr of DOCUMENTED_USER_FACING_ATTRS) {
    assert.ok(USER_FACING_ATTRS.has(attr), `${attr} is in USER_FACING_ATTRS`);
}
assert.strictEqual(USER_FACING_ATTRS.size, DOCUMENTED_USER_FACING_ATTRS.length,
    'USER_FACING_ATTRS holds exactly the documented attributes (an undocumented addition fails here)');

// aria-* names outside the set stay technical; the set is what decides.
assert.ok(!USER_FACING_ATTRS.has('aria-labelledby'), 'aria-labelledby is not user-facing');
assert.ok(!USER_FACING_ATTRS.has('aria-hidden'), 'aria-hidden is not user-facing');

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
// A TemplateLiteral's static text lives in quasis[].value.cooked; chunks
// are the literal spans between interpolations.
const template = (...chunks) => ({
    type: 'TemplateLiteral',
    quasis: chunks.map((cooked) => ({ type: 'TemplateElement', value: { cooked, raw: cooked } })),
    expressions: [],
});

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

// 9. Template-literal copy in a supported attribute is flagged. A
// Literal-only test read aria-label={`Allow ${name}`} as invisible, so
// the interpolated copy never reached the translator index.
v = findViolations(jsxAttr('aria-label', jsxExpr(template('Allow ', ' '))));
assert.strictEqual(v.length, 1, 'flags static copy inside a template-literal aria-label');
assert.match(v[0].message, /Allow/);
assert.strictEqual(v[0].node.type, 'TemplateLiteral', 'reports the template node itself');

// 10. Trailing-chunk copy counts too: {`${n} unread`}.
v = findViolations(jsxAttr('aria-label', jsxExpr(template('', ' unread'))));
assert.strictEqual(v.length, 1, 'flags copy in a trailing template chunk');

// 11. Pure interpolation stays silent: every static chunk is trivial.
v = findViolations(jsxAttr('aria-label', jsxExpr(template('', '/', ''))));
assert.strictEqual(v.length, 0, 'allows a pure-interpolation template');

// 12. A technical attribute's template is still ignored.
v = findViolations(jsxAttr('className', jsxExpr(template('btn btn--', ''))));
assert.strictEqual(v.length, 0, 'allows a template on a technical attribute');

// 13. The two props this rule gained because components forward them
// verbatim to a user: backLabel reaches aria-label through PageHeader,
// aria-valuetext is spoken in place of a slider's raw value.
v = findViolations(jsxAttr('backLabel', literal('Back to history')));
assert.strictEqual(v.length, 1, 'flags a backLabel literal');
assert.match(v[0].message, /backLabel/);
v = findViolations(jsxAttr('aria-valuetext', literal('Fast: 3 min')));
assert.strictEqual(v.length, 1, 'flags an aria-valuetext literal');

// 14. Template copy is reported ONCE, not doubled by the generic
// content branch that also walks JSXExpressionContainer nodes.
v = findViolations(jsxElement([jsxAttr('title', jsxExpr(template('Send to ', '')))]));
assert.strictEqual(v.length, 1, 'attribute template reported once, not twice');

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
    getFilename() { return '/repo/xchain-wallet/packages/core/src/Demo.jsx'; },
    report(r) { reports.push(r); },
};
const visitors = pluginRule.create(fakeContext);
visitors.JSXText({ type: 'JSXText', value: 'Hello translator' });
assert.strictEqual(reports.length, 1, 'create() returns visitors that wire context.report');

// The shipping visitor, not just findViolations (test 7), must flag a
// JSX-content {'literal'}; create() carried no such visitor once, so the
// documented case escaped real ESLint while the helper smoke read green.
visitors.JSXExpressionContainer({
    ...jsxExpr(literal('Real user copy')),
    parent: { type: 'JSXElement' },
});
assert.strictEqual(reports.length, 2, 'create() flags {literal} in JSX content');

// An attribute's container is the JSXAttribute visitor's job; reporting
// it here too would double-count placeholder={'x'} and newly flag
// technical attrs like className={'btn'}.
visitors.JSXExpressionContainer({
    ...jsxExpr(literal('Real user copy')),
    parent: { type: 'JSXAttribute' },
});
assert.strictEqual(reports.length, 2,
    'create() leaves attribute containers to the JSXAttribute visitor');

// The shipping JSXAttribute visitor is a second implementation of the
// same rule as findViolations (tests 9-13); the two drift silently, so
// pin the template branch on this side too.
visitors.JSXAttribute(jsxAttr('aria-label', jsxExpr(template('Allow ', ' '))));
assert.strictEqual(reports.length, 3, 'create() flags template copy in a supported attribute');
visitors.JSXAttribute(jsxAttr('aria-label', jsxExpr(template('', '/', ''))));
assert.strictEqual(reports.length, 3, 'create() ignores a pure-interpolation template');
visitors.JSXAttribute(jsxAttr('backLabel', literal('Back to history')));
assert.strictEqual(reports.length, 4, 'create() flags a backLabel literal');
visitors.JSXAttribute(jsxAttr('aria-labelledby', literal('heading-id')));
assert.strictEqual(reports.length, 4, 'create() ignores a non-user-facing aria-* attribute');

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
