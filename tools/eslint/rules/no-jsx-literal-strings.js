// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// no-jsx-literal-strings. §54 / G172.
//
// Flags raw string literals that render in JSX so translators have a
// single index of user-facing copy in `i18n/locales/<bcp47>/index.js`.
// Wire the wallet's ESLint config to load this rule via the matching
// plugin in `tools/eslint/plugin.js`:
//
//   plugins: ['@xchain'],
//   rules: { '@xchain/no-jsx-literal-strings': 'warn' }
//
// What the rule checks:
//
//   - JSXText nodes:           <span>Hello</span>          → flagged
//   - JSXAttribute "literal"   <input placeholder="x" />   → flagged for
//     attributes whose names are user-visible: aria-label, alt, title,
//     placeholder, label, hint.
//   - JSXExpressionContainer holding a Literal:
//                              <span>{'literal'}</span>    → flagged
//
// What the rule allows:
//
//   - Empty / whitespace-only strings.
//   - Strings shorter than `minLength` (default 2), abbreviations like
//     "&" or ":" are punctuation.
//   - Strings made up entirely of digits / punctuation / one ASCII
//     letter (e.g. "•", "-", "0x", "1d"). Catches version chips,
//     status dots, etc.
//   - Specific allow-listed values via the rule option `allow: [...]`.
//   - Technical attributes that never render to humans: `className`,
//     `style`, `id`, `key`, `role`, `type`, `htmlFor`, `name`, `data-*`,
//     `aria-*` (other than `aria-label`).
//   - Files matching `ignoreFiles` glob list (defaults exclude
//     `*.smoke.js`, `test/**`, `*.test.js`, `*.test.jsx`,
//     `tools/**`, `claude/**`).
//
// To opt out at a specific call site, use the standard ESLint disable
// comment:
//   // eslint-disable-next-line @xchain/no-jsx-literal-strings
//   <span>Inline copy</span>
//
// The rule is designed to ship in the repo without enforcement
// (per project memory "no CI during wallet build phase"). Developers
// can run `eslint --rule …` locally to spot violations.

const USER_FACING_ATTRS = new Set([
    'aria-label',
    'aria-description',
    'aria-roledescription',
    'alt',
    'title',
    'placeholder',
    'label',
    'hint',
    'caption',
    'tooltip',
]);

const TECHNICAL_ATTR_PREFIXES = ['data-', 'on'];
const TECHNICAL_ATTR_NAMES = new Set([
    'className',
    'class',
    'style',
    'id',
    'key',
    'role',
    'type',
    'htmlFor',
    'htmlType',
    'name',
    'href',
    'src',
    'srcSet',
    'rel',
    'target',
    'method',
    'action',
    'form',
    'value',
    'defaultValue',
    'min',
    'max',
    'step',
    'pattern',
    'autoComplete',
    'autoCapitalize',
    'autoCorrect',
    'spellCheck',
    'inputMode',
    'tabIndex',
    'aria-hidden',
    'aria-controls',
    'aria-describedby',
    'aria-labelledby',
    'aria-pressed',
    'aria-expanded',
    'aria-checked',
    'aria-current',
    'aria-haspopup',
    'aria-live',
    'role',
    'as',
    'variant',
    'size',
]);

const DEFAULT_IGNORE_FILES = [
    /\.smoke\.js$/,
    /\.test\.[jt]sx?$/,
    /\/test\//,
    /\/tools\//,
    /\/claude\//,
    /\/dist\//,
    /\/node_modules\//,
];

function isTechnicalAttr(name) {
    if (!name) return true;
    if (TECHNICAL_ATTR_NAMES.has(name)) return true;
    for (const prefix of TECHNICAL_ATTR_PREFIXES) {
        if (name.startsWith(prefix)) return true;
    }
    // aria-* is mostly technical except for aria-label / aria-description /
    // aria-roledescription.
    if (name.startsWith('aria-') && !USER_FACING_ATTRS.has(name)) return true;
    return false;
}

/**
 * Decide whether a string value is "trivial" enough to ignore: pure
 * whitespace, a single character, all digits / punctuation, or in
 * the explicit allowlist.
 */
export function isTrivialString(value, allow = [], minLength = 2) {
    if (typeof value !== 'string') return true;
    const trimmed = value.trim();
    if (trimmed.length === 0) return true;
    if (trimmed.length < minLength) return true;
    if (/^[\s\d\p{P}\p{S}]+$/u.test(trimmed)) return true;
    if (allow.includes(trimmed)) return true;
    return false;
}

/**
 * Files we never check (tests, tools, claude/, dist/, etc).
 *
 * @param {string} filename
 * @param {Array<RegExp | string>} extra
 */
export function shouldSkipFile(filename, extra = []) {
    if (typeof filename !== 'string') return true;
    const all = [...DEFAULT_IGNORE_FILES, ...extra.map((p) => p instanceof RegExp ? p : new RegExp(p))];
    return all.some((re) => re.test(filename));
}

/**
 * Top-level dispatch: given an AST node + filename, return the list
 * of violations { node, message }. The rule wraps this in an ESLint
 * `create()` and reports each violation through context.report.
 */
export function findViolations(node, options = {}) {
    const { allow = [], minLength = 2 } = options;
    const out = [];

    function visit(n) {
        if (!n || typeof n !== 'object') return;
        if (n.type === 'JSXText') {
            if (!isTrivialString(n.value, allow, minLength)) {
                out.push({
                    node: n,
                    message: `Inline JSX text "${truncate(n.value)}" should be moved to i18n/locales/<lang>/index.js and accessed via t('key').`,
                });
            }
        } else if (n.type === 'JSXAttribute') {
            const attrName = n.name?.name;
            if (USER_FACING_ATTRS.has(attrName)) {
                const v = n.value;
                if (v?.type === 'Literal' && !isTrivialString(v.value, allow, minLength)) {
                    out.push({
                        node: v,
                        message: `Inline ${attrName}="${truncate(v.value)}" should use t('key').`,
                    });
                } else if (v?.type === 'JSXExpressionContainer'
                        && v.expression?.type === 'Literal'
                        && !isTrivialString(v.expression.value, allow, minLength)) {
                    out.push({
                        node: v.expression,
                        message: `Inline ${attrName}={"${truncate(v.expression.value)}"} should use t('key').`,
                    });
                }
            }
            // Recurse inside non-flagged attributes too; JSX expression
            // children may hide further JSX trees.
            visit(n.value);
        } else if (n.type === 'JSXExpressionContainer'
                && n.expression?.type === 'Literal'
                && typeof n.expression.value === 'string'
                && !isTrivialString(n.expression.value, allow, minLength)) {
            // {'inline literal'} inside JSX content; flag.
            out.push({
                node: n.expression,
                message: `Inline JSX expression "${truncate(n.expression.value)}" should use t('key').`,
            });
            // Don't descend further; the literal is terminal.
            return;
        }

        // Generic recursion through the AST.
        for (const key of Object.keys(n)) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue;
            const child = n[key];
            if (Array.isArray(child)) {
                for (const c of child) visit(c);
            } else if (child && typeof child === 'object' && typeof child.type === 'string') {
                visit(child);
            }
        }
    }
    visit(node);
    return out;
}

function truncate(s, max = 40) {
    const t = String(s).replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const meta = {
    type: 'suggestion',
    docs: {
        description: 'Flag user-facing JSX strings that should be moved to the i18n dictionary',
        recommended: false,
    },
    schema: [{
        type: 'object',
        properties: {
            allow: { type: 'array', items: { type: 'string' } },
            minLength: { type: 'integer', minimum: 1 },
            ignoreFiles: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
    }],
    messages: {
        inline: 'Inline JSX text should be moved to the i18n dictionary',
    },
};

function create(context) {
    const options = context.options?.[0] ?? {};
    const allow = options.allow ?? [];
    const minLength = options.minLength ?? 2;
    const filename = context.getFilename ? context.getFilename() : context.filename;
    if (shouldSkipFile(filename, options.ignoreFiles ?? [])) return {};

    return {
        JSXText(node) {
            if (!isTrivialString(node.value, allow, minLength)) {
                context.report({ node, message: 'Inline JSX text should be moved to the i18n dictionary' });
            }
        },
        JSXAttribute(node) {
            const attrName = node.name?.name;
            if (!USER_FACING_ATTRS.has(attrName)) return;
            const v = node.value;
            if (v?.type === 'Literal' && typeof v.value === 'string'
                && !isTrivialString(v.value, allow, minLength)) {
                context.report({ node: v, message: `Inline ${attrName} string should use t('key')` });
            }
            if (v?.type === 'JSXExpressionContainer'
                && v.expression?.type === 'Literal'
                && typeof v.expression.value === 'string'
                && !isTrivialString(v.expression.value, allow, minLength)) {
                context.report({ node: v.expression, message: `Inline ${attrName} string should use t('key')` });
            }
        },
    };
}

export default { meta, create };
export { meta, create, USER_FACING_ATTRS, TECHNICAL_ATTR_NAMES, isTechnicalAttr };
