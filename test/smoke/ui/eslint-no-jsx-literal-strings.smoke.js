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
// The last twenty-one are component props: copy shipped through them
// escaped the translator index while the set held DOM attribute names
// only.
// Every documented name is listed here, and the size assertion below
// closes the other direction: this loop once pinned 11 of 13 members, so
// dropping aria-description or aria-roledescription from the rule left
// the smoke green and the header's claim of coverage silently false.
const DOCUMENTED_USER_FACING_ATTRS = [
    'aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext',
    'alt', 'title', 'placeholder', 'label', 'hint', 'caption', 'tooltip',
    'heading', 'emptyText', 'actionLabel', 'backLabel',
    'text', 'body', 'ariaLabel', 'iconLabel', 'aria',
    'headline', 'statusLabel', 'allLabel', 'summaryNoun',
    'menuHeader', 'emptyTitle', 'emptyBody', 'confirmLabel', 'cancelLabel',
    'copyLabel', 'balanceText', 'submitLabel',
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
// Toggle copy: `open ? 'Hide filters' : 'Show filters'` and `custom || 'Pin'`.
const identifier = (name) => ({ type: 'Identifier', name });
const conditional = (consequent, alternate) => ({
    type: 'ConditionalExpression', test: identifier('flag'), consequent, alternate,
});
const logical = (left, right) => ({ type: 'LogicalExpression', operator: '||', left, right });

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

// 15. A *literal* attribute container is the case that actually tripled:
// the JSXAttribute branch reported it, re-entering the container let the
// JSX-content branch report it again, and the generic recursion made a
// third. One user-visible string is one violation.
v = findViolations(jsxElement([jsxAttr('title', jsxExpr(literal('Send to Alice')))]));
assert.strictEqual(v.length, 1, 'attribute literal container reported once, not three times');
assert.match(v[0].message, /title/, 'the surviving report is the attribute-shaped one');

// 16. Same shape on a technical attribute stays silent. Re-entering the
// container used to route className={'btn'} through the JSX-content
// branch, which never consults the attribute name, so the helper flagged
// copy the shipping create() correctly ignores.
v = findViolations(jsxElement([jsxAttr('className', jsxExpr(literal('btn btn--primary')))]));
assert.strictEqual(v.length, 0, 'technical attribute container is not flagged');

// 17. Skipping the container level must not blind the walk to JSX nested
// inside an attribute value, e.g. a render prop.
v = findViolations(jsxElement([
    jsxAttr('renderFooter', jsxExpr(jsxElement([jsxText('Nested copy')]))),
]));
assert.strictEqual(v.length, 1, 'still descends into JSX inside an attribute expression');
assert.match(v[0].message, /Nested copy/);

// 18. Component props that render copy verbatim: Status `text`,
// EmptyStateNudge / Placeholder `body`, and the three camelCase props
// forwarded straight into aria-label (CopyButton `ariaLabel`,
// AddressField `iconLabel`, InfoTip `aria`). Each once escaped the set
// while the surrounding JSXText was caught.
for (const [attr, copy] of [
    ['text', 'Settings unavailable.'],
    ['body', 'Generate a receive address to populate this list.'],
    ['ariaLabel', 'Copy tx hash'],
    ['iconLabel', 'Choose source address'],
    ['aria', 'Fee priority help'],
]) {
    v = findViolations(jsxAttr(attr, literal(copy)));
    assert.strictEqual(v.length, 1, `flags a ${attr} literal`);
    assert.match(v[0].message, new RegExp(attr));
}
v = findViolations(jsxAttr('text', jsxExpr(template('Settings unavailable: ', ''))));
assert.strictEqual(v.length, 1, 'flags template copy in a text prop');
v = findViolations(jsxAttr('aria-labelledby', literal('some-id')));
assert.strictEqual(v.length, 0, 'aria-labelledby stays technical');

// 18b. The three props admitted alongside emptyTitle: BalanceList /
// CollectiblesView forward `emptyBody` verbatim to EmptyState's body, and
// ConfirmModal / NoticeModal render `confirmLabel` / `cancelLabel` as button
// text. The English is written one hop earlier under these names, so the
// already-covered sink props (`title`, `body`) never saw it.
for (const [attr, copy] of [
    ['emptyBody', 'Receive Bitcoin, Litecoin, or Dogecoin to populate this list.'],
    ['confirmLabel', 'Delete'],
    ['cancelLabel', 'Keep it'],
]) {
    v = findViolations(jsxAttr(attr, literal(copy)));
    assert.strictEqual(v.length, 1, `flags an ${attr} literal`);
    assert.match(v[0].message, new RegExp(attr));
}
// 18d. The same one-hop-earlier shape on three more props. PsbtSignForm's
// ArtifactBlock forwards `copyLabel` to CopyButton, which renders it as the
// button text AND as the accessible name, so the sink prop `label` never
// sees the English. AmountField renders `balanceText` verbatim into the
// amount footer, and its shipping call sites write the copy as a template
// ("… available"). TokenWizard ships `submitLabel` as a prop default that
// renders as button text (item 19b). None of the three names is used for a
// technical payload anywhere in packages/*/src.
v = findViolations(jsxAttr('copyLabel', literal('Copy signed PSBT')));
assert.strictEqual(v.length, 1, 'flags a copyLabel literal');
assert.match(v[0].message, /copyLabel/);
v = findViolations(jsxAttr('balanceText', jsxExpr(template('', ' BTC available'))));
assert.strictEqual(v.length, 1, 'flags template copy in a balanceText prop');
assert.match(v[0].message, /balanceText/);

// 18c. Toggle copy in a ternary attribute value. Both attribute paths
// enumerated three value shapes (Literal, container Literal, container
// TemplateLiteral); a ConditionalExpression matched none, and the generic
// recursion reports no bare Literal, so the copy was walked and discarded.
v = findViolations(jsxAttr('aria-label', jsxExpr(conditional(literal('Hide filters'), literal('Show filters')))));
assert.strictEqual(v.length, 1, 'flags copy in a ternary aria-label, once');
assert.match(v[0].message, /Hide filters/);
assert.strictEqual(v[0].node.type, 'ConditionalExpression', 'reports the whole ternary node');

// Only the first non-trivial branch is reported, the way templateCopy
// reports only the first non-trivial chunk: one attribute, one violation.
v = findViolations(jsxElement([
    jsxAttr('title', jsxExpr(conditional(literal('Unpin'), literal('Pin to top')))),
]));
assert.strictEqual(v.length, 1, 'a two-branch ternary is one violation, not two');

// The nested three-state form, and a `||` fallback, are the same shape.
v = findViolations(jsxAttr('label', jsxExpr(
    conditional(literal('a'), conditional(literal('Confirm password'), literal('b'))),
)));
assert.strictEqual(v.length, 1, 'flags copy in a nested ternary branch');
assert.match(v[0].message, /Confirm password/);
v = findViolations(jsxAttr('title', jsxExpr(logical(identifier('custom'), literal('Pin to top')))));
assert.strictEqual(v.length, 1, 'flags copy in a `||` fallback');

// Templates inside a branch count, and a technical attribute stays silent.
v = findViolations(jsxAttr('aria-label', jsxExpr(conditional(template('Hide ', ' filters'), identifier('other')))));
assert.strictEqual(v.length, 1, 'flags template copy inside a ternary branch');
v = findViolations(jsxAttr('className', jsxExpr(conditional(literal('btn btn--primary'), literal('btn btn--ghost')))));
assert.strictEqual(v.length, 0, 'a technical attribute ternary stays silent');
v = findViolations(jsxAttr('aria-label', jsxExpr(conditional(identifier('a'), identifier('b')))));
assert.strictEqual(v.length, 0, 'a ternary with no static copy stays silent');
v = findViolations(jsxAttr('aria-label', jsxExpr(conditional(literal('Hide filters'), literal('Show filters')))),
    { allow: ['Hide filters', 'Show filters'] });
assert.strictEqual(v.length, 0, 'allowlist suppresses ternary branch copy');

// 19. Copy shipped as a destructured prop default never reaches a JSX
// node, so `function C({ label = 'Copy' })` was invisible to the rule.
// The key decides, not the local binding, and the set keeps technical
// defaults quiet.
const literalKey = (name) => ({ type: 'Identifier', name });
const defaulted = (name, right, local = name) => ({
    type: 'Property',
    key: literalKey(name),
    value: { type: 'AssignmentPattern', left: literalKey(local), right },
});
const plainProp = (name) => ({ type: 'Property', key: literalKey(name), value: literalKey(name) });
const objectPattern = (...properties) => ({ type: 'ObjectPattern', properties });
const fn = (params) => ({ type: 'FunctionDeclaration', params, body: { type: 'BlockStatement', body: [] } });

v = findViolations(fn([objectPattern(plainProp('value'), defaulted('label', literal('Copy')))]));
assert.strictEqual(v.length, 1, 'flags a label = "Copy" prop default');
assert.match(v[0].message, /label/);
assert.strictEqual(v[0].node.type, 'Literal', 'reports the default value node');

// 19b. TokenWizard's `submitLabel = 'Preview'` is the same shape: the copy
// is a prop default that renders as the wizard's submit-button text, so no
// JSX visitor could ever see the English.
v = findViolations(fn([objectPattern(defaulted('submitLabel', literal('Preview')))]));
assert.strictEqual(v.length, 1, 'flags a submitLabel = "Preview" prop default');
assert.match(v[0].message, /submitLabel/);
assert.strictEqual(v[0].node.type, 'Literal', 'reports the submitLabel default value node');
v = findViolations(fn([objectPattern(defaulted('label', literal('Copy'), 'lbl'))]));
assert.strictEqual(v.length, 1, 'judges the property key, not the local binding');
v = findViolations(fn([objectPattern(defaulted('title', template('Copy ', ' items')))]));
assert.strictEqual(v.length, 1, 'flags template copy in a prop default');
v = findViolations(fn([objectPattern(
    defaulted('size', literal('md')),
    defaulted('variant', literal('action')),
    defaulted('fiatCurrency', literal('USD')),
    defaulted('feedbackMs', { type: 'Literal', value: 1500 }),
    defaulted('placeholder', literal('0.00')),
)]));
assert.strictEqual(v.length, 0, 'technical and trivial defaults are not flagged');
v = findViolations(fn([objectPattern(defaulted('label', literal('Copy')))]), { allow: ['Copy'] });
assert.strictEqual(v.length, 0, 'allowlist suppresses a prop default');

// 19b. The prop defaults the three newly admitted names ship: ConfirmModal
// `confirmLabel = 'Confirm', cancelLabel = 'Cancel'`, NoticeModal
// `confirmLabel = 'OK'`, BalanceList `emptyTitle = 'No balances yet'`. This is
// the shape the prop-default branch exists for, and the set is what gates it.
for (const [name, copy] of [
    ['confirmLabel', 'Confirm'],
    ['cancelLabel', 'Cancel'],
    ['emptyTitle', 'No balances yet'],
    ['emptyBody', 'Receive Bitcoin to populate this list.'],
]) {
    v = findViolations(fn([objectPattern(defaulted(name, literal(copy)))]));
    assert.strictEqual(v.length, 1, `flags a ${name} = "${copy}" prop default`);
    assert.match(v[0].message, new RegExp(name));
}

// ─── Export surface ───────────────────────────────────────────────
//
// The rule once exported isTechnicalAttr plus a TECHNICAL_ATTR_NAMES
// deny-list that nothing called: both sides of the rule decide by
// USER_FACING_ATTRS membership, so the second list could only drift.
// Pin the surface so a dead export has to be justified here first.
const EXPECTED_EXPORTS = [
    'USER_FACING_ATTRS', 'create', 'default', 'findViolations',
    'isTrivialString', 'meta', 'propDefaultViolations', 'shouldSkipFile',
    'templateCopy',
];
assert.deepStrictEqual(Object.keys(rule).sort(), [...EXPECTED_EXPORTS].sort(),
    'rule exports exactly the symbols that have callers');

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
visitors.JSXAttribute(jsxAttr('text', literal('Loading settings')));
visitors.JSXAttribute(jsxAttr('body', literal('Adjust or clear the filters to see more history.')));
visitors.JSXAttribute(jsxAttr('ariaLabel', literal('Copy tx hash')));
visitors.JSXAttribute(jsxAttr('iconLabel', literal('Choose source address')));
visitors.JSXAttribute(jsxAttr('aria', literal('Fee priority help')));
assert.strictEqual(reports.length, 9, 'create() flags the verbatim-rendered component props');
// The ternary branch, pinned on the shipping side too: the two attribute
// paths are two implementations of one rule and drift silently.
visitors.JSXAttribute(jsxAttr('aria-label', jsxExpr(conditional(literal('Hide filters'), literal('Show filters')))));
assert.strictEqual(reports.length, 10, 'create() flags ternary branch copy in a supported attribute');
visitors.JSXAttribute(jsxAttr('title', jsxExpr(logical(identifier('custom'), literal('Pin to top')))));
assert.strictEqual(reports.length, 11, 'create() flags `||` fallback copy');
visitors.JSXAttribute(jsxAttr('className', jsxExpr(conditional(literal('btn btn--primary'), literal('btn btn--ghost')))));
assert.strictEqual(reports.length, 11, 'create() ignores a technical attribute ternary');
visitors.JSXAttribute(jsxAttr('aria-label', jsxExpr(conditional(identifier('a'), identifier('b')))));
assert.strictEqual(reports.length, 11, 'create() ignores a ternary with no static copy');
visitors.JSXAttribute(jsxAttr('emptyBody', literal('Receive Bitcoin to populate this list.')));
visitors.JSXAttribute(jsxAttr('confirmLabel', literal('Delete')));
visitors.JSXAttribute(jsxAttr('cancelLabel', literal('Keep it')));
assert.strictEqual(reports.length, 14, 'create() flags the three newly admitted copy props');
// The shipping ObjectPattern visitor carries the prop-default branch too.
assert.ok(typeof visitors.ObjectPattern === 'function', 'create() returns an ObjectPattern visitor');
visitors.ObjectPattern(objectPattern(plainProp('value'), defaulted('label', literal('Copy'))));
assert.strictEqual(reports.length, 15, 'create() flags a label = "Copy" prop default');
visitors.ObjectPattern(objectPattern(defaulted('size', literal('md'))));
assert.strictEqual(reports.length, 15, 'create() ignores a technical prop default');

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

// The wiring recipe has to be the flat-config one, and this is the only
// thing standing between the prose and a fourth drift back. Both headers
// once documented an eslintrc `plugins: ['@xchain']`, which was measured
// to fail with "ESLint couldn't find the plugin \"@xchain/eslint-plugin\"":
// that shortname names an INSTALLED npm package, never a repo-relative
// file, and an eslintrc could not require() this ESM plugin anyway. The
// `eslint --rule` fallback failed the same way ("Definition for rule …
// was not found"). Only a config that imports the module and registers it
// as an object loads the rule.
const pluginSrc = read('tools/eslint/plugin.js');
for (const [name, src] of [['plugin.js', pluginSrc], ['no-jsx-literal-strings.js', ruleSrc]]) {
    assert.match(src, /import xchain from '\.\/tools\/eslint\/plugin\.js'/,
        `${name} documents importing the plugin module`);
    assert.match(src, /plugins: \{ '@xchain': xchain \}/,
        `${name} documents registering the plugin object, not the eslintrc shortname`);
    // Only the RECIPE line is forbidden: both headers still name the
    // eslintrc form in prose, to say why it does not work.
    assert.doesNotMatch(src, /^\/\/\s+plugins: \['@xchain'\]/m,
        `${name} no longer offers the unresolvable eslintrc shortname as a recipe line`);
}
// `ecmaFeatures.jsx` is load-bearing in the runnable example: without it
// every .jsx file dies on "Parsing error: Unexpected token <" before the
// rule is ever consulted, so a recipe that omits it is still unrunnable.
assert.match(pluginSrc, /ecmaFeatures: \{ jsx: true \}/,
    'plugin.js documents the jsx parser option its example needs to parse .jsx at all');
assert.doesNotMatch(pluginSrc, /^\/\/\s+(npx )?eslint --rule/m,
    'plugin.js no longer offers the --rule CLI fallback as a runnable line; it cannot resolve the namespace');

console.log('OK — no-jsx-literal-strings rule + plugin + filename filter smoke');
