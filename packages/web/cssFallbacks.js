// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Build-time CSS fallbacks for engines without `color-mix()`.
//
// Each modern declaration gets a plain declaration immediately before it and
// an old-engine-only copy of its rule. The pair preserves the conventional CSS
// fallback contract for static audits and declarations that fail at parse
// time. The guarded copy also covers declarations containing `var()`, whose
// validation can be deferred until computed-value time.
//
// Semantic translucent colours use the palette's precomputed theme tokens.
// Other mixes collapse to their dominant operand, which keeps the fallback
// readable when a build step cannot resolve a runtime colour token.

/**
 * Split on a separator at parenthesis depth zero.
 *
 * @param {string} str
 * @param {(ch: string) => boolean} isSep
 * @returns {string[]}
 */
function splitTopLevel(str, isSep) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of str) {
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        if (depth === 0 && isSep(ch)) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    parts.push(current);
    return parts;
}

/**
 * One `color-mix()` operand: a colour with an optional percentage on either
 * side of it.
 *
 * @param {string} operand
 * @returns {{ color: string, pct: number | null }}
 */
function parseOperand(operand) {
    const tokens = splitTopLevel(operand.trim(), (ch) => /\s/.test(ch)).filter(Boolean);
    let pct = null;
    const rest = [];
    for (const token of tokens) {
        const m = /^(-?[\d.]+)%$/.exec(token);
        if (m && pct === null) pct = Number(m[1]);
        else rest.push(token);
    }
    return { color: rest.join(' '), pct };
}

const TRANSLUCENT_THEME_TOKENS = new Map([
    ['--xc-accent-primary', 'var(--xc-info-bg)'],
    ['--xc-danger', 'var(--xc-danger-bg)'],
    ['--xc-success', 'var(--xc-success-bg)'],
    ['--xc-warning', 'var(--xc-warning-bg)'],
]);

function tokenName(color) {
    return /^var\(\s*(--[\w-]+)/.exec(color)?.[1] ?? null;
}

function fallbackOperand(a, b) {
    if (b.color.toLowerCase() === 'transparent') {
        const themed = TRANSLUCENT_THEME_TOKENS.get(tokenName(a.color));
        if (themed) return themed;
    }
    if (a.color.toLowerCase() === 'transparent') {
        const themed = TRANSLUCENT_THEME_TOKENS.get(tokenName(b.color));
        if (themed) return themed;
    }
    return b.pct > a.pct ? b.color : a.color;
}

/**
 * Replace every `color-mix()` in a value with a compatible token or its
 * dominant operand.
 *
 * Nested mixes collapse inside-out. A mix this cannot read (wrong arity) is
 * left untouched, which makes the caller emit no fallback for it rather than
 * a wrong one.
 *
 * @param {string} value
 * @returns {string}
 */
export function flattenColorMix(value) {
    const marker = 'color-mix(';
    let out = '';
    let i = 0;
    while (i < value.length) {
        const start = value.indexOf(marker, i);
        if (start === -1) {
            out += value.slice(i);
            break;
        }
        out += value.slice(i, start);
        let depth = 1;
        let j = start + marker.length;
        while (j < value.length && depth > 0) {
            if (value[j] === '(') depth += 1;
            else if (value[j] === ')') depth -= 1;
            j += 1;
        }
        const whole = value.slice(start, j);
        const inner = value.slice(start + marker.length, j - 1);
        const args = splitTopLevel(inner, (ch) => ch === ',');
        if (depth !== 0 || args.length !== 3) {
            out += whole;
        } else {
            const a = parseOperand(flattenColorMix(args[1]));
            const b = parseOperand(flattenColorMix(args[2]));
            let pa = a.pct;
            let pb = b.pct;
            if (pa === null && pb === null) { pa = 50; pb = 50; }
            else if (pa === null) pa = 100 - pb;
            else if (pb === null) pb = 100 - pa;
            out += fallbackOperand({ ...a, pct: pa }, { ...b, pct: pb });
        }
        i = j;
    }
    return out;
}

/** The condition old engines match; `color-mix()` landed in Chromium 111. */
export const NO_COLOR_MIX = 'not (color: color-mix(in srgb, red, blue))';

/**
 * The fallback declarations for one rule's declarations.
 *
 * Pure, so it is testable without PostCSS. Custom properties are included:
 * the `@supports` copy overrides them like any other declaration. A value
 * this cannot flatten yields no fallback rather than a wrong one.
 *
 * @param {{ prop: string, value: string, important?: boolean }[]} decls
 * @returns {{ prop: string, value: string, important: boolean }[]}
 */
export function fallbackDeclarations(decls) {
    const out = [];
    for (const decl of decls) {
        if (!decl.value.includes('color-mix(')) continue;
        const value = flattenColorMix(decl.value);
        if (value === decl.value || value.includes('color-mix(')) continue;
        out.push({ prop: decl.prop, value, important: Boolean(decl.important) });
    }
    return out;
}

/**
 * PostCSS plugin: insert each flattened declaration before its modern
 * declaration, then append
 *
 *     @supports not (color: color-mix(in srgb, red, blue)) {
 *         <same selector> { <same properties, mixes flattened> }
 *     }
 *
 * Rules inside `@keyframes` are skipped: `@supports` cannot nest there.
 */
export function colorMixFallback() {
    return {
        postcssPlugin: 'xchain-color-mix-fallback',
        Once(root, { AtRule, Rule }) {
            const targets = [];
            root.walkRules((rule) => {
                const parent = rule.parent;
                if (parent && parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return;
                if (parent && parent.type === 'atrule' && parent.name === 'supports' && parent.params === NO_COLOR_MIX) return;
                // Already mirrored (a second pass over our own output).
                const next = rule.next();
                if (next && next.type === 'atrule' && next.name === 'supports' && next.params === NO_COLOR_MIX) return;
                const entries = rule.nodes
                    .filter((node) => node.type === 'decl')
                    .map((decl) => ({ decl, fallback: fallbackDeclarations([decl])[0] }))
                    .filter(({ fallback }) => fallback);
                if (entries.length > 0) targets.push({ rule, entries });
            });
            for (const { rule, entries } of targets) {
                for (const { decl, fallback } of entries) decl.cloneBefore(fallback);
                const copy = new Rule({ selector: rule.selector });
                for (const { fallback } of entries) copy.append(fallback);
                const gate = new AtRule({ name: 'supports', params: NO_COLOR_MIX });
                gate.append(copy);
                rule.after(gate);
            }
        },
    };
}
colorMixFallback.postcss = true;
