// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §53.4 - forced-colors (Windows high-contrast) audit.
//
// This is the machine-checkable half of the forced-colors QA walk. The walk
// itself is a browser pass (`test/e2e/tests/a11y/forced-colors.spec.js` drives
// it with Playwright's `forcedColors: 'active'`); this script generalises what
// that pass found so the same class of defect cannot come back on a route
// nobody re-walks.
//
// HOW FORCED-COLORS MODE ACTUALLY BEHAVES, because every rule below follows
// from it: when the user turns on a high-contrast theme, the browser rewrites
// author colours to that theme's palette. A value that IS a system colour
// keyword (`Canvas`, `CanvasText`, `LinkText`, `Highlight`, …) is left alone -
// call it PRESERVED. Anything else - `#FFFFFF`, an `rgba()`, a token that the
// forced-colors block in tokens.css does not map - is replaced with whatever
// the UA picks for that property, call it FORCED. Separately, `box-shadow` is
// not painted at all.
//
// Three defects follow, and they are the three rules:
//
//   FC1 focus-indicator-erased
//       A `:focus` rule that turns the outline off and replaces it with a
//       box-shadow ring, a border-colour swap or a background tint. The ring
//       is not painted; the swap is between two system colours on a 1px edge;
//       the tint collapses because every surface token maps to `Canvas`. The
//       control ends up with no findable focus indicator (WCAG 2.4.7).
//
//   FC2 mixed-forced-pair
//       One element whose background is PRESERVED while its own label is
//       FORCED (or vice versa). The two halves are then chosen by different
//       systems and no contrast relationship survives between them - the
//       wallet's primary button was body-text colour on a link-coloured fill.
//       Also fires when both halves resolve to the SAME system colour, which
//       is invisible text.
//
//   FC0 undefined-token
//       `var(--xc-nope)` with no fallback, where nothing declares that token.
//       Not a forced-colors rule as such - it is here because the walk found
//       one: the InfoTip focus ring was written against a token that has never
//       existed, which makes the declaration invalid at computed-value time,
//       drops the whole shorthand, and had left that control with no ring in
//       ANY mode. The colour rules above cannot see a defect like that,
//       because textually the ring is right there.
//
//   FC3 gradient-surface-unpinned
//       A surface painted with a gradient (a background-IMAGE) plus its own
//       text colour. Engines disagree about whether gradients survive, so the
//       pair has to be pinned explicitly for the mode rather than guessed at.
//
// Each rule is satisfied by an `@media (forced-colors: active)` block in the
// SAME stylesheet that fixes the selector it flags. That is deliberate: the
// fix lives next to the thing it fixes, and the audit reads exactly what a
// reviewer would look for.
//
// Usage:
//   node packages/core/scripts/forced-colors-audit.js
//
// Exits 0 with a "0 violations" summary when clean; non-zero with a per-file
// report otherwise. `test/smoke/audits/forced-colors-audit.smoke.js` consumes
// `runForcedColorsAudit()` directly.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const corePkg = join(here, '..');
const packagesRoot = join(corePkg, '..');
const repoRoot = join(packagesRoot, '..');

const TOKENS_CSS = join(corePkg, 'src', 'ui', 'tokens.css');

// Build output, vendored shells and platform wrappers all contain COPIES of
// the stylesheets below. Auditing them reports the same defect several times
// and, worse, keeps reporting it after the source is fixed but before the next
// build. Source only.
const SKIP_DIRS = new Set([
    'node_modules', 'dist', 'build', 'coverage', 'android', 'ios',
    'test-results', 'release-artifacts', '.vite',
]);

// System colours that read as "page background". A label forced onto one of
// these is still readable, so a preserved-background/forced-label pair is only
// dangerous when the background is one of the INK colours instead.
const CANVAS_LIKE = new Set(['Canvas', 'Window', 'ButtonFace', 'Field']);
const SYSTEM_COLORS = new Set([
    'Canvas', 'CanvasText', 'LinkText', 'VisitedText', 'ActiveText', 'GrayText',
    'Highlight', 'HighlightText', 'Mark', 'MarkText', 'ButtonFace', 'ButtonText',
    'ButtonBorder', 'Field', 'FieldText', 'AccentColor', 'AccentColorText',
    'SelectedItem', 'SelectedItemText', 'Window', 'WindowText',
]);

/**
 * Selectors this audit deliberately does not flag, each with the reason it is
 * safe. Kept tiny on purpose: a carve-out is a claim that the defect is not a
 * defect HERE, and every entry has to survive being read out loud.
 */
export const CARVE_OUTS = [
    {
        file: 'packages/core/src/ui/Screen.module.css',
        selector: '.body:focus',
        rule: 'focus-indicator-erased',
        reason:
            'Not an interactive control. `.body` is the skip-link target and is '
            + 'focused programmatically so the next Tab starts inside the main '
            + 'region; painting a ring around the whole scroll area would mark '
            + 'the page rather than a control. The skip link itself keeps its '
            + 'own visible ring.',
    },
];

/**
 * @typedef {Object} ForcedColorsViolation
 * @property {string} file  repo-relative path
 * @property {number} line
 * @property {string} rule
 * @property {string} message
 * @property {string} snippet
 */

/** Files that can declare a custom property: stylesheets and inline styles. */
function listSources(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return out;
    }
    for (const name of entries) {
        if (SKIP_DIRS.has(name)) continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) listSources(full, out);
        else if (/\.(css|js|jsx)$/.test(name)) out.push(full);
    }
    return out;
}

/** @returns {string[]} */
function listCss(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return out;
    }
    for (const name of entries) {
        if (SKIP_DIRS.has(name)) continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) listCss(full, out);
        else if (name.endsWith('.css')) out.push(full);
    }
    return out;
}

/** Replace every `/* … *\/` comment with the newlines it spanned. */
export function stripComments(css) {
    let out = '';
    let i = 0;
    while (i < css.length) {
        if (css[i] === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2);
            const stop = end === -1 ? css.length : end + 2;
            out += css.slice(i, stop).replace(/[^\n]/g, ' ');
            i = stop;
            continue;
        }
        out += css[i];
        i += 1;
    }
    return out;
}

/**
 * Flatten a stylesheet into declaration blocks, remembering which at-rules
 * each one sits inside. Deliberately not a real CSS parser: these stylesheets
 * are hand-written CSS modules with no nesting, and a dependency-free scanner
 * is the difference between this gate running everywhere and it not running.
 *
 * @param {string} css
 * @returns {{selector: string, body: string, line: number, at: string[]}[]}
 */
export function parseRules(source) {
    // Comments are blanked FIRST rather than skipped during the walk: these
    // stylesheets carry long prose comments between declarations, and one of
    // those sitting inside a block would otherwise be glued onto the
    // declaration that follows it and swallow it. Newlines are kept so the
    // reported line numbers still point at the real source.
    const css = stripComments(source);
    const rules = [];
    const at = [];
    let prelude = '';
    let i = 0;
    let line = 1;
    let preludeLine = 1;
    while (i < css.length) {
        const ch = css[i];
        if (ch === '\n') {
            line += 1;
            if (!prelude.trim()) preludeLine = line;
            i += 1;
            prelude += ch;
            continue;
        }
        if (ch === '{') {
            const head = prelude.trim();
            prelude = '';
            if (head.startsWith('@')) {
                at.push(head);
                i += 1;
                preludeLine = line;
                continue;
            }
            const end = css.indexOf('}', i);
            const stop = end === -1 ? css.length : end;
            const body = css.slice(i + 1, stop);
            rules.push({ selector: head, body, line: preludeLine, at: [...at] });
            line += css.slice(i, stop).split('\n').length - 1;
            i = stop + 1;
            preludeLine = line;
            continue;
        }
        if (ch === '}') {
            at.pop();
            prelude = '';
            preludeLine = line;
            i += 1;
            continue;
        }
        prelude += ch;
        i += 1;
    }
    return rules;
}

/** @returns {Record<string, string>} token name -> system colour, from tokens.css */
export function readForcedColorTokens(tokensCss = readFileSync(TOKENS_CSS, 'utf8')) {
    const map = {};
    for (const rule of parseRules(tokensCss)) {
        if (!rule.at.some(isForcedColorsAtRule)) continue;
        for (const decl of splitDeclarations(rule.body)) {
            if (decl.prop.startsWith('--')) map[decl.prop] = decl.value.trim();
        }
    }
    return map;
}

function isForcedColorsAtRule(prelude) {
    return /^@media\b/.test(prelude) && /forced-colors\s*:\s*active/.test(prelude);
}

/**
 * Every custom property this codebase declares, from any source a browser
 * would honour: a stylesheet, or an inline style object in JSX (ChainBadge
 * hands `--chain-color` to a component that way, and a token audit that did
 * not know about it would report a false defect on a working control).
 *
 * @param {string[]} roots
 * @returns {Set<string>}
 */
export function readDeclaredTokens(roots) {
    const declared = new Set();
    const addFromCss = (css) => {
        for (const match of stripComments(css).matchAll(/(--[\w-]+)\s*:/g)) declared.add(match[1]);
    };
    const addFromScript = (src) => {
        for (const match of src.matchAll(/['"](--[\w-]+)['"]\s*:/g)) declared.add(match[1]);
    };
    addFromCss(readFileSync(TOKENS_CSS, 'utf8'));
    for (const root of roots) {
        for (const file of listSources(root)) {
            const src = readFileSync(file, 'utf8');
            if (file.endsWith('.css')) addFromCss(src);
            else addFromScript(src);
        }
    }
    return declared;
}

/** @returns {{prop: string, value: string}[]} */
export function splitDeclarations(body) {
    const out = [];
    let depth = 0;
    let current = '';
    for (const ch of body) {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ';' && depth === 0) {
            out.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    out.push(current);
    return out
        .map((decl) => {
            const at = decl.indexOf(':');
            if (at === -1) return null;
            return { prop: decl.slice(0, at).trim(), value: decl.slice(at + 1).trim() };
        })
        .filter((d) => d && d.prop && d.value);
}

/**
 * What happens to one colour value when forced-colors mode turns on.
 *
 * @param {string|undefined} value
 * @param {Record<string,string>} tokens
 * @returns {{kind: 'preserved'|'forced'|'neutral'|'unknown', color?: string}}
 */
export function classifyColor(value, tokens) {
    if (!value) return { kind: 'unknown' };
    const v = value.trim();
    if (!v) return { kind: 'unknown' };
    if (/^(transparent|inherit|initial|unset|currentColor|none|revert)$/i.test(v)) {
        return { kind: 'neutral' };
    }
    if (SYSTEM_COLORS.has(v)) return { kind: 'preserved', color: v };

    const varMatch = v.match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/);
    if (varMatch) {
        const mapped = tokens[varMatch[1]];
        if (mapped) return classifyColor(mapped, tokens);
        // Unmapped token: whatever it resolves to is an author colour, so the
        // fallback (if any) decides nothing - both halves get forced.
        return varMatch[2] ? classifyColor(varMatch[2].trim(), tokens) : { kind: 'forced' };
    }
    if (/^(#|rgba?\(|hsla?\(|color-mix\()/i.test(v)) return { kind: 'forced' };
    if (/^[a-z]+$/i.test(v)) return { kind: 'forced' };   // named CSS colour
    return { kind: 'unknown' };
}

/** The first value of a `background` shorthand, which is where a colour sits. */
function backgroundColorOf(body) {
    let value;
    for (const decl of splitDeclarations(body)) {
        if (decl.prop === 'background-color') value = decl.value;
        else if (decl.prop === 'background') value = decl.value;
    }
    if (!value) return undefined;
    if (/gradient\(/.test(value)) return undefined;   // an image, handled by FC3
    if (/url\(/.test(value)) return undefined;
    // `background: var(--x) center/cover` -> take the colour term only.
    const first = value.match(/^(var\([^)]*\)|color-mix\([^)]*\)|#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[\w-]+)/i);
    return first ? first[0] : undefined;
}

function declValue(body, prop) {
    let value;
    for (const decl of splitDeclarations(body)) if (decl.prop === prop) value = decl.value;
    return value;
}

function normalizeSelector(sel) {
    return sel.replace(/\s+/g, ' ').trim();
}

function selectorParts(sel) {
    return sel.split(',').map(normalizeSelector).filter(Boolean);
}

/**
 * Does `candidate` style `target`, or the thing that visually stands for it?
 *
 * The second half matters: several components deliberately ring an inner pip
 * (`.dot:focus-visible::before`) or a child glyph (`.trigger:focus-visible
 * .glyph`) rather than the padded hit box, and that IS the focus indicator.
 */
function selectorCovers(candidate, target) {
    return candidate === target
        || candidate.startsWith(`${target} `)
        || candidate.startsWith(`${target}::`);
}

function hasVisibleOutline(body) {
    const outline = declValue(body, 'outline');
    if (outline && !/^(none|0)\b/.test(outline)) return true;
    const style = declValue(body, 'outline-style');
    const width = declValue(body, 'outline-width');
    if (style && !/^none$/i.test(style) && width && !/^0/.test(width)) return true;
    return false;
}

function isCarvedOut(fileRel, part, rule) {
    // Suffix match, not equality: the caller may hand us a path from outside
    // this checkout (a test fixture, a linked worktree), and a carve-out that
    // silently stopped applying would look like a new defect in a file nobody
    // touched.
    return CARVE_OUTS.some(
        (c) => (fileRel === c.file || fileRel.endsWith(`/${c.file}`))
            && c.rule === rule
            && selectorParts(c.selector).includes(part),
    );
}

/**
 * Run the audit.
 *
 * @param {{roots?: string[], tokens?: Record<string,string>}} [options]
 * @returns {ForcedColorsViolation[]}
 */
export function runForcedColorsAudit(options = {}) {
    const tokens = options.tokens ?? readForcedColorTokens();
    const roots = options.roots
        ?? readdirSync(packagesRoot)
            .map((pkg) => join(packagesRoot, pkg, 'src'))
            .filter((dir) => {
                try {
                    return statSync(dir).isDirectory();
                } catch {
                    return false;
                }
            });
    const declared = options.declared ?? readDeclaredTokens(roots);

    const violations = [];
    for (const root of roots) {
        for (const file of listCss(root)) {
            violations.push(...auditFile(file, readFileSync(file, 'utf8'), tokens, declared));
        }
    }
    return violations;
}

/**
 * Audit one stylesheet.
 *
 * @param {string} file  absolute path (only used for reporting)
 * @param {string} css
 * @param {Record<string,string>} tokens
 * @returns {ForcedColorsViolation[]}
 */
export function auditFile(file, css, tokens, declared) {
    const fileRel = relative(repoRoot, file).split(sep).join('/');
    const rules = parseRules(css);
    // Called without a token set (a unit test, a one-file check): fall back to
    // what tokens.css and this file declare, so the rule still says something
    // useful instead of silently switching itself off.
    const declaredTokens = declared
        ?? new Set([
            ...Object.keys(tokens),
            ...[...stripComments(css).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
            ...[...stripComments(readFileSync(TOKENS_CSS, 'utf8')).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
        ]);
    const forcedRules = rules.filter((r) => r.at.some(isForcedColorsAtRule));
    const violations = [];

    /** Is there any rule at all (forced-colors or not) restoring an outline here? */
    const outlineRestored = (part) => rules.some(
        (r) => hasVisibleOutline(r.body) && selectorParts(r.selector).some((p) => selectorCovers(p, part)),
    );

    /** Does a forced-colors block pin every one of `props` for this selector? */
    const pinnedInForcedColors = (part, props) => forcedRules.some((r) => {
        if (!selectorParts(r.selector).some((p) => selectorCovers(p, part))) return false;
        return props.every((prop) => (prop === 'background'
            ? declValue(r.body, 'background') !== undefined || declValue(r.body, 'background-color') !== undefined
            : declValue(r.body, prop) !== undefined));
    });

    for (const rule of rules) {
        // FC0 - a token nothing declares, used without a fallback. Checked in
        // EVERY block, forced-colors ones included: the declaration it kills is
        // dead in whichever mode it was written for.
        for (const decl of splitDeclarations(rule.body)) {
            if (decl.prop.startsWith('--')) continue;
            for (const use of decl.value.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
                if (declaredTokens.has(use[1])) continue;
                violations.push({
                    file: fileRel,
                    line: rule.line,
                    rule: 'undefined-token',
                    message:
                        `\`${decl.prop}\` reads \`${use[1]}\`, which nothing declares, and gives `
                        + 'it no fallback. That makes the declaration invalid at '
                        + 'computed-value time, so the browser drops the WHOLE declaration - '
                        + 'an `outline` shorthand written this way leaves the control with no '
                        + 'ring at all. Name a token that exists, or give the var a fallback.',
                    snippet: `${decl.prop}: ${decl.value}`,
                });
            }
        }

        if (rule.at.some(isForcedColorsAtRule)) continue;
        const parts = selectorParts(rule.selector);

        // FC1 - focus indicator erased.
        const outline = declValue(rule.body, 'outline');
        const removesOutline = outline !== undefined && /^(none|0)\b/.test(outline);
        if (removesOutline && parts.some((p) => /:focus(-visible|-within)?\b/.test(p))) {
            for (const part of parts) {
                if (!/:focus(-visible|-within)?\b/.test(part)) continue;
                if (isCarvedOut(fileRel, part, 'focus-indicator-erased')) continue;
                if (outlineRestored(part)) continue;
                violations.push({
                    file: fileRel,
                    line: rule.line,
                    rule: 'focus-indicator-erased',
                    message:
                        `\`${part}\` turns its outline off, and nothing restores one. `
                        + 'A box-shadow ring is not painted in forced-colors mode and a '
                        + 'border/background/colour swap between two system colours is not '
                        + 'a findable focus indicator, so this control has none in Windows '
                        + 'high-contrast mode. Add `@media (forced-colors: active)` with a '
                        + 'real `outline` for this selector.',
                    snippet: part,
                });
            }
        }

        // FC3 - gradient surface with its own text colour, not pinned.
        const background = declValue(rule.body, 'background') ?? declValue(rule.body, 'background-image');
        const color = declValue(rule.body, 'color');
        if (background && /gradient\(/.test(background) && color) {
            const unpinned = parts.filter((p) => !pinnedInForcedColors(p, ['background', 'color']));
            if (unpinned.length > 0) {
                violations.push({
                    file: fileRel,
                    line: rule.line,
                    rule: 'gradient-surface-unpinned',
                    message:
                        `\`${unpinned[0]}\` paints itself with a gradient and sets its own `
                        + 'text colour. A gradient is a background-IMAGE, so forced-colors '
                        + 'mode may drop it and leave the label on bare Canvas. Pin both '
                        + 'halves in `@media (forced-colors: active)` instead of relying on '
                        + 'which way the engine goes.',
                    snippet: unpinned[0],
                });
            }
            continue;
        }

        // FC2 - mixed pair.
        const bgValue = backgroundColorOf(rule.body);
        if (!bgValue || !color) continue;
        const bg = classifyColor(bgValue, tokens);
        const fg = classifyColor(color, tokens);
        if (bg.kind === 'neutral' || fg.kind === 'neutral') continue;
        if (bg.kind === 'unknown' || fg.kind === 'unknown') continue;

        const bgIsInk = bg.kind === 'preserved' && !CANVAS_LIKE.has(bg.color);
        let problem = null;
        if (bgIsInk && fg.kind === 'forced') {
            problem =
                `resolves to a preserved \`${bg.color}\` fill with a label the browser `
                + 'forces to its own colour. The two are then picked by different systems '
                + 'and nothing guarantees they contrast';
        } else if (bg.kind === 'preserved' && fg.kind === 'preserved' && bg.color === fg.color) {
            problem = `paints \`${bg.color}\` text on a \`${bg.color}\` background, which is invisible`;
        }
        if (!problem) continue;
        const unpinned = parts.filter((p) => !pinnedInForcedColors(p, ['background', 'color']));
        if (unpinned.length === 0) continue;
        violations.push({
            file: fileRel,
            line: rule.line,
            rule: 'mixed-forced-pair',
            message:
                `\`${unpinned[0]}\` ${problem}. Pair the halves: use a token that the `
                + 'forced-colors block in tokens.css maps (`--xc-on-accent` / '
                + '`--xc-on-danger` exist for exactly this), or pin both in a '
                + '`@media (forced-colors: active)` block.',
            snippet: `${bgValue} / ${color}`,
        });
    }

    return violations;
}

const invokedDirectly = process.argv[1]
    && realpathish(process.argv[1]) === realpathish(fileURLToPath(import.meta.url));

function realpathish(p) {
    return p.replace(/\\/g, '/');
}

if (invokedDirectly) {
    const violations = runForcedColorsAudit();
    if (violations.length === 0) {
        console.log('forced-colors audit: 0 violations');
        process.exit(0);
    }
    const byFile = new Map();
    for (const v of violations) {
        if (!byFile.has(v.file)) byFile.set(v.file, []);
        byFile.get(v.file).push(v);
    }
    for (const [file, list] of byFile) {
        console.log(`\n${file}`);
        for (const v of list) console.log(`  ${v.line}: [${v.rule}] ${v.message}`);
    }
    console.log(`\nforced-colors audit: ${violations.length} violation(s)`);
    process.exit(1);
}
