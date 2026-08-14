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
//     attributes whose names are user-visible: aria-label,
//     aria-description, aria-roledescription, aria-valuetext, alt,
//     title, placeholder, label, hint, caption, tooltip, heading,
//     emptyText, actionLabel, backLabel
//     (the USER_FACING_ATTRS set below is the authority; keep this list
//     in step with it). The last four are component props rather than
//     DOM attributes: shipping components render copy through them, so
//     a DOM-only set left that copy out of the translator index.
//   - JSXAttribute template   <img alt={`QR for ${addr}`} />  → flagged
//     for those same attribute names when any static chunk of the
//     template is non-trivial. A `Literal`-only test read the static
//     English in an interpolated aria-label as invisible, so that copy
//     never reached the translator index. Pure-interpolation templates
//     like {`${a}/${b}`} stay silent: every static chunk is trivial.
//   - JSXExpressionContainer holding a Literal, in JSX content:
//                              <span>{'literal'}</span>    → flagged.
//     An attribute's container is covered by the JSXAttribute case, so
//     the content visitor skips it rather than reporting twice.
//
// What the rule allows:
//
//   - Empty / whitespace-only strings.
//   - Strings shorter than `minLength` (default 2), abbreviations like
//     "&" or ":" are punctuation.
//   - Strings made up entirely of whitespace / digits / punctuation /
//     symbols (e.g. "•", "-", "123"). Catches separator glyphs and
//     status dots. The filter has NO letter allowance, so a technical
//     token carrying one ("0x", "1d", "v2") is non-trivial and IS
//     flagged; the smoke test pins those three.
//   - Specific allow-listed values via the rule option `allow: [...]`.
//   - Technical attributes that never render to humans: `className`,
//     `style`, `id`, `key`, `role`, `type`, `htmlFor`, `name`, `data-*`,
//     `on*`, and every `aria-*` outside USER_FACING_ATTRS (so
//     `aria-label`, `aria-description`, `aria-roledescription` and
//     `aria-valuetext` stay checked while `aria-labelledby`,
//     `aria-hidden` and the rest do not).
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
    // Assistive text a screen reader speaks in place of a slider's raw
    // value. The generic aria-* sweep read it as technical plumbing.
    'aria-valuetext',
    'alt',
    'title',
    'placeholder',
    'label',
    'hint',
    'caption',
    'tooltip',
    // Component props, not DOM attributes. Shipping components render copy
    // through these (SideEditor heading, ChainGroup emptyText, the settings
    // and empty-state rows' actionLabel, PageHeader backLabel), and a
    // DOM-only set let it escape. Only props whose value reaches a user
    // verbatim belong here; a prop that merely names a key does not.
    'heading',
    'emptyText',
    'actionLabel',
    'backLabel',
]);

// There is deliberately no technical-attribute deny-list here. Both
// `create()` and `findViolations` decide by USER_FACING_ATTRS membership,
// so a second list of names to exclude was unreachable code that could
// only drift out of step with the set that actually decides.

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
    // aria-* is mostly technical except for the USER_FACING_ATTRS members
    // (aria-label, aria-description, aria-roledescription, aria-valuetext).
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
 * Return the first non-trivial static chunk of a TemplateLiteral, or null.
 *
 * A template's static English lives in `quasis[].value.cooked`, so testing
 * only `Literal` nodes let interpolated copy through. Judging each chunk
 * with the same triviality filter keeps a pure-interpolation template such
 * as `${a}/${b}` silent for free: its chunks are "", "/" and "".
 *
 * @param {object} node
 * @param {string[]} allow
 * @param {number} minLength
 * @returns {string | null}
 */
export function templateCopy(node, allow = [], minLength = 2) {
    if (node?.type !== 'TemplateLiteral') return null;
    for (const quasi of node.quasis ?? []) {
        const text = quasi?.value?.cooked ?? quasi?.value?.raw ?? '';
        if (!isTrivialString(text, allow, minLength)) return text;
    }
    return null;
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
                } else if (v?.type === 'JSXExpressionContainer'
                        && v.expression?.type === 'TemplateLiteral') {
                    const copy = templateCopy(v.expression, allow, minLength);
                    if (copy !== null) {
                        out.push({
                            node: v.expression,
                            message: `Inline ${attrName}={\`${truncate(copy)}\`} should use t('key') with placeholders.`,
                        });
                    }
                }
            }
            // Descend once, and enter an expression container at its
            // *expression* rather than at the container itself. The
            // container belongs to this attribute and the branch above
            // has already judged it; re-entering it let the JSX-content
            // branch below report the same title={'…'} a second time and
            // the generic recursion a third, and made the helper flag
            // technical values such as className={'btn'} that the
            // shipping create() correctly ignores. Returning here keeps
            // the generic recursion from walking `value` again, while
            // stepping through the expression still finds JSX trees
            // hidden in render props.
            const value = n.value;
            visit(value?.type === 'JSXExpressionContainer' ? value.expression : value);
            return;
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
            // Static English inside an interpolated value, e.g.
            // aria-label={`Allow ${name}`}. Mirrors the findViolations
            // branch; the two attribute paths must stay in step.
            if (v?.type === 'JSXExpressionContainer'
                && v.expression?.type === 'TemplateLiteral'
                && templateCopy(v.expression, allow, minLength) !== null) {
                context.report({ node: v.expression, message: `Inline ${attrName} template copy should use t('key') with placeholders` });
            }
        },
        JSXExpressionContainer(node) {
            // Only JSX *content* containers: an attribute's container is
            // already handled by JSXAttribute above, so an unguarded
            // handler would double-report user-facing attrs and would
            // newly flag technical ones like className={'btn'}.
            const parentType = node.parent?.type;
            if (parentType !== 'JSXElement' && parentType !== 'JSXFragment') return;
            const expr = node.expression;
            if (expr?.type === 'Literal' && typeof expr.value === 'string'
                && !isTrivialString(expr.value, allow, minLength)) {
                context.report({ node: expr, message: 'Inline JSX expression string should be moved to the i18n dictionary' });
            }
        },
    };
}

export default { meta, create };
export { meta, create, USER_FACING_ATTRS };
