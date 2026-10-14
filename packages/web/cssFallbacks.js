// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Build-time CSS fallbacks for old-but-capable WebViews.
//
// `src/platform/webviewFloor.js` promises that an engine below the soft floor
// is "advice, not a gate": the wallet must stay usable there. The stylesheet
// broke that promise. `color-mix()` needs Chromium 111, and an engine that
// does not know it drops the WHOLE declaration, so a card whose background is
// `linear-gradient(..., color-mix(...))` renders with no background at all.
// Measured on an LG K51's stock WebView 102 (2026-10-12): the balance hero
// was white text on a white card, i.e. the user's balance was invisible.
//
// WHY NOT THE USUAL FALLBACK PAIR. The oldest trick in CSS is a plain
// declaration first and the modern one after it, so an engine that cannot
// parse the second keeps the first. It does not work here, and the first
// version of this file proved it on the device: almost every one of these
// values contains `var()`, and a declaration containing `var()` is not
// validated when it is parsed. It WINS the cascade as an opaque token list
// and is only found invalid later, at computed-value time, by which point the
// plain declaration in front of it has already lost. The property then falls
// to its initial value, which for `background` is transparent.
//
// So the fallback is delivered the only way that survives: a copy of the rule
// behind `@supports not (color: color-mix(...))`, placed straight after the
// rule it mirrors. Engines that understand `color-mix()` never read it, so
// this changes nothing at all for them; engines that do not get a plain
// colour. Writing that by hand at every use (over a hundred) would rot the
// first time someone added one, so this plugin writes it at build time.
//
// The fallback is an APPROXIMATION by design: each `color-mix()` collapses to
// whichever operand carries more weight. The operands are almost always
// `var(--token)`, which no build step can resolve, so there is no exact
// answer to compute; a readable card in roughly the right colour is the goal.

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

/**
 * Replace every `color-mix()` in a value with its dominant operand.
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
            out += pb > pa ? b.color : a.color;
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
 * PostCSS plugin: after each rule that uses `color-mix()`, append
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
                const decls = rule.nodes.filter((node) => node.type === 'decl');
                const fallbacks = fallbackDeclarations(decls);
                if (fallbacks.length > 0) targets.push({ rule, fallbacks });
            });
            for (const { rule, fallbacks } of targets) {
                const copy = new Rule({ selector: rule.selector });
                for (const decl of fallbacks) copy.append(decl);
                const gate = new AtRule({ name: 'supports', params: NO_COLOR_MIX });
                gate.append(copy);
                rule.after(gate);
            }
        },
    };
}
colorMixFallback.postcss = true;
