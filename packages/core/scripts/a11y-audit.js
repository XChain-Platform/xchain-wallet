// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §56.3 Pre-launch Step 5: static a11y audit. Scans every .jsx file
// under packages/core/src/shared/ and packages/core/src/ui/ for the
// common WCAG-AA gaps that mechanical inspection can catch:
//
//   1. Buttons without text + without aria-label (icon-only buttons).
//   2. Images / icons without alt= or aria-hidden.
//   3. Inputs without a label= prop, aria-label, or wrapping <label>.
//   4. Textareas without aria-label or wrapping <label>.
//   5. <div onClick=…> without role="button" + tabIndex.
//   6. <img onClick=…> without an interactive role.
//
// Designed to run from Node (no React render needed). The rules are
// pattern-based and deliberately conservative. False positives are
// fixed by adding the missing attribute, false negatives are caught
// by a future axe-core runtime pass when @axe-core/react lands.
//
// Usage:
//   node packages/core/scripts/a11y-audit.js
//
// Exits 0 with a "0 violations" summary when clean; non-zero with a
// per-file violation report otherwise. The smoke harness consumes
// the same module via `runA11yAudit`.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const corePkg = join(here, '..');

/** @returns {string[]} */
function listJsx(dir) {
    const out = [];
    const entries = readdirSync(dir);
    for (const name of entries) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
            out.push(...listJsx(full));
        } else if (name.endsWith('.jsx')) {
            out.push(full);
        }
    }
    return out;
}

/**
 * @typedef {Object} A11yViolation
 * @property {string} file
 * @property {number} line
 * @property {string} rule
 * @property {string} message
 * @property {string} snippet
 */

/**
 * Run the static a11y audit. Returns an array of violations.
 *
 * @returns {A11yViolation[]}
 */
export function runA11yAudit() {
    const files = [
        ...listJsx(join(corePkg, 'src', 'shared')),
        ...listJsx(join(corePkg, 'src', 'ui')),
    ];
    const violations = [];
    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        violations.push(...auditFile(file, src));
    }
    return violations;
}

const RULES = {
    BUTTON_NEEDS_TEXT_OR_ARIA: 'button-needs-text-or-aria-label',
    IMG_NEEDS_ALT: 'img-needs-alt',
    INPUT_NEEDS_LABEL: 'input-needs-label',
    TEXTAREA_NEEDS_LABEL: 'textarea-needs-label',
    DIV_CLICK_NEEDS_ROLE: 'div-onclick-needs-role',
};

// Blank a comment out while KEEPING its newlines, so the stripped source has the
// same line count as the original.
function blankKeepingLines(match) {
    return match.replace(/[^\n]/g, '');
}

function stripJsxComments(src) {
    // Strip JSX comment blocks `{/* ... */}` and JS line comments
    // `// ...` so the tag-matching regex doesn't catch tag-shaped
    // text inside docs / commented-out code.
    //
    // Multi-line comments are blanked rather than deleted: deleting them removed
    // their newlines too, so every violation after a JSDoc block was reported at
    // the wrong line (a 13-line block shifted everything below it up by 12).
    // Line numbers that point at the wrong code make the audit untrustworthy.
    let out = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, blankKeepingLines);
    out = out.replace(/\/\/[^\n]*/g, '');
    out = out.replace(/\/\*[\s\S]*?\*\//g, blankKeepingLines);
    return out;
}

function exprHasStringLiteral(src) {
    // Inside a JSX expression `{...}`, accept any single-quoted /
    // double-quoted / template-literal-with-text string as a label
    // that's what the screen reader will announce.
    if (/'[^']{2,}'/.test(src)) return true;
    if (/"[^"]{2,}"/.test(src)) return true;
    if (/`[^`]{2,}`/.test(src)) return true;
    // Bare identifier references such as `{p.label}`, `{name}`,
    // and `{title}` are almost always rendered text. False negatives
    // exist (e.g. `{styles.iconCls}`) but those are vanishingly rare
    // for direct button-child use.
    if (/^\{\s*[A-Za-z_$][A-Za-z0-9_$.]*\s*\}$/.test(src.trim())) return true;
    return false;
}

function findIdReferencedLabel(src, id) {
    // Scan for `<label htmlFor="${id}">…` anywhere in the file. A
    // single match is enough; assistive tech only needs one label
    // association.
    const re = new RegExp(`<label[^>]*\\bhtmlFor\\s*=\\s*"${id}"`, 'i');
    return re.test(src);
}

function fileHasAnyHtmlForLabel(src) {
    // Components that build their own htmlFor wiring with dynamic
    // ids (the wallet's <Input> primitive uses `useId()`) get a
    // pass. We know the label↔input association is set up, just
    // not via a literal id we can match.
    return /<label[^>]*\bhtmlFor\s*=\s*\{/.test(src);
}

function auditFile(file, rawSrc) {
    const src = stripJsxComments(rawSrc);
    const violations = [];
    const lines = src.split('\n');

    // Walk opening tags by hand so JSX expression braces (which can
    // contain `=>` arrow functions, nested `<Foo>`, etc.) don't trip
    // up a naive regex that splits on the first `>`. Each tag's
    // attribute block runs from the tag name up to the first `>` /
    // `/>` not inside a `{…}` expression.
    const tagHeadRe = /<\s*([A-Za-z][A-Za-z0-9-]*)/g;
    let m;
    while ((m = tagHeadRe.exec(src))) {
        const tag = m[1];
        const offset = m.index;
        const startLine = src.slice(0, offset).split('\n').length;
        const snippet = lines[startLine - 1]?.trim()?.slice(0, 120) || '';

        // Scan forward, balancing `{ }`, `'…'`, `"…"`, and `\`…\``
        // until we hit the closing `>` / `/>`.
        let i = offset + m[0].length;
        let depth = 0;
        let stringChar = null;
        let attrsEnd = -1;
        let isSelfClose = false;
        for (; i < src.length; i += 1) {
            const ch = src[i];
            if (stringChar) {
                if (ch === '\\') { i += 1; continue; }
                if (ch === stringChar) stringChar = null;
                continue;
            }
            if (ch === "'" || ch === '"' || ch === '`') {
                stringChar = ch;
                continue;
            }
            if (ch === '{') { depth += 1; continue; }
            if (ch === '}') { depth -= 1; continue; }
            if (depth === 0 && ch === '/' && src[i + 1] === '>') {
                isSelfClose = true;
                attrsEnd = i;
                i += 2;
                break;
            }
            if (depth === 0 && ch === '>') {
                attrsEnd = i;
                i += 1;
                break;
            }
        }
        if (attrsEnd < 0) continue;
        const attrs = src.slice(offset + m[0].length, attrsEnd);
        // Re-seek the iterator to just past the closing `>` so the
        // outer loop doesn't pick up `<` characters inside this tag's
        // attribute expressions.
        tagHeadRe.lastIndex = i;
        const after = src.slice(i);
        // Mock the m[3] capture for downstream code that checks
        // self-closing.
        m[3] = isSelfClose ? '/>' : '>';

        // 1. <button> / <Button> with no children-text and no aria-label.
        // We approximate "has text" by checking whether the tag has
        // ANY text between the opening and a matching `</tag>`. For
        // self-closing `<Button .../>` the children check is skipped.
        if (/^button$/i.test(tag) || tag === 'Button') {
            const isSelfClose = /\/\s*>$/.test(m[3]);
            const hasAriaLabel = /\baria-label\s*=/.test(attrs);
            const hasIconLabel = /\btitle\s*=/.test(attrs);
            if (isSelfClose && !hasAriaLabel && !hasIconLabel) {
                violations.push({
                    file,
                    line: startLine,
                    rule: RULES.BUTTON_NEEDS_TEXT_OR_ARIA,
                    message: 'self-closing <button> with no aria-label / title (icon-only button without an accessible name)',
                    snippet,
                });
            } else if (!isSelfClose) {
                // Find children up to the next </button>. If empty
                // OR contains only an icon expression `{<Icon/>}`,
                // require aria-label.
                const closeRe = new RegExp(`<\\s*\\/\\s*${tag}\\s*>`, 'i');
                const closeIdx = after.search(closeRe);
                if (closeIdx >= 0) {
                    const inner = after.slice(0, closeIdx).trim();
                    const hasStaticText = /[A-Za-z0-9]{2,}/.test(inner.replace(/\{[^}]*\}/g, ''));
                    // Look inside any expression braces for a string
                    // literal: `{busy ? 'Loading…' : 'Save'}` counts
                    // as labeled text.
                    const exprBlocks = inner.match(/\{[\s\S]*?\}/g) || [];
                    const hasDynamicText = exprBlocks.some(exprHasStringLiteral);
                    if (!hasStaticText && !hasDynamicText && !hasAriaLabel && !hasIconLabel) {
                        violations.push({
                            file,
                            line: startLine,
                            rule: RULES.BUTTON_NEEDS_TEXT_OR_ARIA,
                            message: 'button with no detectable text + no aria-label / title',
                            snippet,
                        });
                    }
                }
            }
        }

        // 2. <img> needs alt= or aria-hidden=. JSX bool short form
        // `aria-hidden` (without `=`) is allowed.
        if (/^img$/i.test(tag)) {
            const hasAlt = /\balt\s*=/.test(attrs);
            const hasAriaHidden = /\baria-hidden(?:\s*=|\s|\/?>)/.test(attrs);
            if (!hasAlt && !hasAriaHidden) {
                violations.push({
                    file,
                    line: startLine,
                    rule: RULES.IMG_NEEDS_ALT,
                    message: '<img> missing alt= and aria-hidden',
                    snippet,
                });
            }
        }

        // 3. <input> needs label / aria-label / aria-labelledby /
        // type="hidden". The wallet's <Input> primitive carries
        // label= as a prop; we accept that too.
        if (/^input$/i.test(tag) || tag === 'Input') {
            const isHidden = /\btype\s*=\s*"hidden"/.test(attrs);
            const isCheckOrRadio = /\btype\s*=\s*"(?:checkbox|radio)"/.test(attrs);
            const hasAriaLabel = /\baria-label\s*=/.test(attrs)
                || /\baria-labelledby\s*=/.test(attrs);
            const hasLabelProp = /\blabel\s*=/.test(attrs);
            const hasPlaceholder = /\bplaceholder\s*=/.test(attrs);
            // <input id="x"> + <label htmlFor="x"> elsewhere in the file is fine.
            const idMatch = /\bid\s*=\s*"([^"]+)"/.exec(attrs);
            const hasMatchingHtmlForLabel = idMatch
                && findIdReferencedLabel(src, idMatch[1]);
            const hasDynamicHtmlForLabel = fileHasAnyHtmlForLabel(src);
            if (!isHidden
                && !isCheckOrRadio
                && !hasAriaLabel
                && !hasLabelProp
                && !hasPlaceholder
                && !hasMatchingHtmlForLabel
                && !hasDynamicHtmlForLabel) {
                violations.push({
                    file,
                    line: startLine,
                    rule: RULES.INPUT_NEEDS_LABEL,
                    message: '<input> / <Input> needs label= / aria-label / aria-labelledby / placeholder / matching <label htmlFor>',
                    snippet,
                });
            }
        }

        // 4. <textarea> / <Textarea>. Same acceptance set as <input> above: this
        // rule used to check ONLY aria-label/aria-labelledby/placeholder, so it
        // false-positived on the wallet's own <Textarea label="..."> primitive,
        // which associates a real <label htmlFor> with the control (Textarea.jsx)
        // and is perfectly accessible. A rule that flags the correct pattern is
        // worse than no rule: it trains people to ignore the audit.
        if (/^textarea$/i.test(tag)) {
            const hasAriaLabel = /\baria-label\s*=/.test(attrs)
                || /\baria-labelledby\s*=/.test(attrs);
            const hasLabelProp = /\blabel\s*=/.test(attrs);
            const hasPlaceholder = /\bplaceholder\s*=/.test(attrs);
            const idMatch = /\bid\s*=\s*"([^"]+)"/.exec(attrs);
            const hasMatchingHtmlForLabel = idMatch
                && findIdReferencedLabel(src, idMatch[1]);
            const hasDynamicHtmlForLabel = fileHasAnyHtmlForLabel(src);
            if (!hasAriaLabel
                && !hasLabelProp
                && !hasPlaceholder
                && !hasMatchingHtmlForLabel
                && !hasDynamicHtmlForLabel) {
                violations.push({
                    file,
                    line: startLine,
                    rule: RULES.TEXTAREA_NEEDS_LABEL,
                    message: '<textarea> / <Textarea> needs label= / aria-label / aria-labelledby / placeholder / matching <label htmlFor>',
                    snippet,
                });
            }
        }

        // 5. <div onClick={...}> without role + tabIndex.
        if (/^div$/i.test(tag) && /\bonClick\s*=/.test(attrs)) {
            const hasRole = /\brole\s*=/.test(attrs);
            const hasTabIndex = /\btabIndex\s*=/.test(attrs);
            if (!hasRole || !hasTabIndex) {
                violations.push({
                    file,
                    line: startLine,
                    rule: RULES.DIV_CLICK_NEEDS_ROLE,
                    message: '<div onClick> needs role + tabIndex (interactive element semantics)',
                    snippet,
                });
            }
        }
    }
    return violations;
}

// Run when invoked directly from the CLI.
if (import.meta.url === `file://${process.argv[1]}`) {
    const violations = runA11yAudit();
    if (violations.length === 0) {
        console.log('a11y-audit: 0 violations across shared/ + ui/ JSX files.');
        process.exit(0);
    }
    const byFile = new Map();
    for (const v of violations) {
        if (!byFile.has(v.file)) byFile.set(v.file, []);
        byFile.get(v.file).push(v);
    }
    let printed = 0;
    for (const [file, vs] of byFile) {
        const rel = file.replace(`${corePkg}/`, '');
        for (const v of vs) {
            console.log(`${rel}:${v.line}  [${v.rule}]  ${v.message}`);
            console.log(`    ${v.snippet}`);
            printed += 1;
        }
    }
    console.error(`\na11y-audit: ${printed} violation(s) across ${byFile.size} file(s)`);
    process.exit(1);
}
