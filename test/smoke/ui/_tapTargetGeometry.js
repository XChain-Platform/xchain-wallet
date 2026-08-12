// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The arithmetic behind the 24px pointer-target floor, done on
// the stylesheet instead of on a rendered page.
//
// The defect this exists to end: a control whose height is never stated,
// only arrived at. `.segBtn` and `.kindSegment` both declared 4px of
// vertical padding around a 13px font and nothing else, so their height
// was whatever line box the platform font produced - 24px on macOS with
// `-apple-system`, 23px on the CI runner's fallback font. They cleared
// WCAG 2.2 AA 2.5.8 on one operating system and missed it by a pixel on
// another, and the responsive e2e walk could only surface them ONE ROUTE
// AT A TIME, because each fix let the walk reach one more route.
//
// So the question this module answers is deliberately not "how tall does
// it render". It is "what is the SMALLEST height this rule can produce",
// which is a property of the declaration block and can be computed
// without a browser. A rule passes only if that guaranteed floor reaches
// 24px; a height that merely happens to reach it on the machine you are
// sitting at is exactly the failure mode.

import { readFileSync } from 'node:fs';

// WCAG 2.2 AA 2.5.8 (Target Size (Minimum)), mirrored by `--xc-tap-min`.
export const FLOOR_PX = 24;

// When a rule states no `font-size`, its text inherits. The app root sets
// `font-size: var(--xc-text-md)` (14px) in tokens.css, so that is the
// assumed inherited size. It is an assumption, which is why it is only
// ever used as a LOWER bound for the line box, never as a measurement.
export const INHERITED_FONT_PX = 14;

// A line box is at least as tall as its font size for every font the
// wallet ships, but `line-height: normal` puts the exact value in the
// font's own metrics, so anything above `font-size` is not guaranteed.
// Using font-size as the floor is what makes a 4px + 13px control read
// as 21px here instead of the 23-or-24px it renders at.
const lineBoxFloor = (fontPx, lineHeightPx) =>
    (lineHeightPx !== null ? lineHeightPx : fontPx);

/** Strip comments so they cannot be mistaken for selectors or values. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Collect `--xc-*` custom properties from tokens.css. First definition
 * wins: the later ones are theme overrides (dark, high-contrast), and
 * none of them redefine a length.
 */
export function loadTokens(tokensCssPath) {
    const src = stripComments(readFileSync(tokensCssPath, 'utf8'));
    const tokens = {};
    for (const m of src.matchAll(/(--xc-[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
        if (!(m[1] in tokens)) tokens[m[1]] = m[2].trim();
    }
    return tokens;
}

/**
 * Resolve a CSS value to a pixel number, following `var()` chains through
 * the token table (including `var(--x, fallback)`). Returns null for
 * anything that is not a plain px length: percentages, calc(), keywords,
 * and unresolved tokens are all "not a stated pixel height".
 */
export function toPx(raw, tokens) {
    if (raw === undefined || raw === null) return null;
    let v = String(raw).trim();
    for (let i = 0; i < 6 && v.includes('var('); i += 1) {
        const next = v.replace(
            /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]*))?\)/gi,
            (_, name, fallback) => (tokens[name] ?? fallback ?? '').trim(),
        );
        if (next === v) break;
        v = next;
    }
    v = v.trim();
    if (/^0$/.test(v)) return 0;
    const m = /^(-?[\d.]+)px$/.exec(v);
    return m ? parseFloat(m[1]) : null;
}

/**
 * Parse a stylesheet into flat rules, carrying any enclosing at-rules
 * (`@media`, `@supports`) as context rather than dropping them: a width
 * breakpoint that shrinks a control back under the floor is the same
 * defect as declaring it small in the first place.
 */
export function parseRules(css) {
    const src = stripComments(css);
    const rules = [];
    const atStack = [];
    let head = '';
    for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        if (ch === '{') {
            const sel = head.trim().replace(/\s+/g, ' ');
            head = '';
            if (sel.startsWith('@')) {
                atStack.push(sel);
                continue;
            }
            let depth = 1;
            let j = i + 1;
            for (; j < src.length; j += 1) {
                if (src[j] === '{') depth += 1;
                else if (src[j] === '}') {
                    depth -= 1;
                    if (depth === 0) break;
                }
            }
            rules.push({ at: [...atStack], sel, body: src.slice(i + 1, j) });
            i = j;
        } else if (ch === '}') {
            head = '';
            atStack.pop();
        } else {
            head += ch;
        }
    }
    return rules;
}

/** Declaration block as a { property: value } map, last declaration wins. */
export function declarations(body) {
    const decls = {};
    let depth = 0;
    let buf = '';
    const parts = [];
    for (const ch of body) {
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        if (ch === ';' && depth === 0) { parts.push(buf); buf = ''; continue; }
        buf += ch;
    }
    parts.push(buf);
    for (const part of parts) {
        const i = part.indexOf(':');
        if (i < 0) continue;
        const prop = part.slice(0, i).trim().toLowerCase();
        if (!prop || prop.startsWith('--')) continue;
        decls[prop] = part.slice(i + 1).trim();
    }
    return decls;
}

/** Split a shorthand on top-level whitespace, keeping `calc(a b)` intact. */
const shorthandParts = (value) => {
    const out = [];
    let depth = 0;
    let buf = '';
    for (const ch of value) {
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        if (/\s/.test(ch) && depth === 0) { if (buf) out.push(buf); buf = ''; continue; }
        buf += ch;
    }
    if (buf) out.push(buf);
    return out;
};

/** Block-axis (top + bottom) contribution of a padding/border shorthand set. */
function blockAxis(decls, prop, tokens) {
    let top = null;
    let bottom = null;
    const short = decls[prop];
    if (short !== undefined) {
        const p = shorthandParts(short).map((x) => toPx(x, tokens));
        if (p.length === 1) { [top] = p; [bottom] = p; }
        else if (p.length === 2) { top = p[0]; bottom = p[0]; }
        else if (p.length === 3) { top = p[0]; bottom = p[2]; }
        else if (p.length >= 4) { top = p[0]; bottom = p[2]; }
    }
    const block = decls[`${prop}-block`];
    if (block !== undefined) {
        const p = shorthandParts(block).map((x) => toPx(x, tokens));
        top = p[0];
        bottom = p.length > 1 ? p[1] : p[0];
    }
    if (decls[`${prop}-top`] !== undefined) top = toPx(decls[`${prop}-top`], tokens);
    if (decls[`${prop}-bottom`] !== undefined) bottom = toPx(decls[`${prop}-bottom`], tokens);
    if (decls[`${prop}-block-start`] !== undefined) top = toPx(decls[`${prop}-block-start`], tokens);
    if (decls[`${prop}-block-end`] !== undefined) bottom = toPx(decls[`${prop}-block-end`], tokens);
    return (top ?? 0) + (bottom ?? 0);
}

/** Block-axis border width, from either `border-width` or `border`. */
function borderBlock(decls, tokens) {
    const fromWidth = blockAxis(decls, 'border-width', tokens);
    if (fromWidth > 0) return fromWidth;
    if (decls['border-block'] !== undefined || decls['border-top'] !== undefined) {
        const t = toPx(shorthandParts(decls['border-top'] ?? decls['border-block'])[0], tokens) ?? 0;
        return t * 2;
    }
    if (decls.border !== undefined) {
        const w = toPx(shorthandParts(decls.border)[0], tokens);
        return w ? w * 2 : 0;
    }
    return 0;
}

/**
 * The smallest height a rule's own declarations can produce.
 *
 * `stated` distinguishes the two ways to reach the floor: an explicit
 * height/min-height (a property of the rule) versus padding plus a line
 * box (a property of the rule AND the font). Both can pass, but only the
 * stated one is immune to the font swap that started this.
 */
export function ruleFloor(decls, tokens) {
    const explicit = [
        toPx(decls.height, tokens),
        toPx(decls['block-size'], tokens),
        toPx(decls['min-height'], tokens),
        toPx(decls['min-block-size'], tokens),
    ].filter((v) => v !== null);
    if (explicit.length) {
        const px = Math.max(...explicit);
        return { px, stated: true, basis: `stated ${px}px` };
    }

    const padding = blockAxis(decls, 'padding', tokens);
    const border = borderBlock(decls, tokens);
    const fontPx = toPx(decls['font-size'], tokens) ?? INHERITED_FONT_PX;
    const rawLh = decls['line-height'];
    let lineHeightPx = toPx(rawLh, tokens);
    if (lineHeightPx === null && rawLh !== undefined && /^[\d.]+$/.test(rawLh.trim())) {
        lineHeightPx = parseFloat(rawLh) * fontPx;
    }
    const line = lineBoxFloor(fontPx, lineHeightPx);
    return {
        px: padding + border + line,
        stated: false,
        basis: `padding ${padding} + border ${border} + line-box floor ${line}`,
    };
}

/**
 * The inline axis, which can only ever be answered one way statically.
 *
 * A control's width is normally set by its label, so there is no floor to
 * compute and no claim to make. But a rule that STATES a width under 24px
 * has decided the question, and the responsive walk checks both axes, so
 * an 8px pagination dot or a 22px icon button is a violation the moment
 * the number is written down.
 *
 * Only `width`/`inline-size` count. `min-width` is a floor rather than a
 * size, and `min-width: 0` in particular is the flex-shrink idiom that
 * pairs with `width: 100%`; reading it as "this control is 0px wide"
 * would flag every truncating row in the wallet.
 */
export function statedWidth(decls, tokens) {
    const stated = [
        toPx(decls.width, tokens),
        toPx(decls['inline-size'], tokens),
    ].filter((v) => v !== null);
    return stated.length ? Math.max(...stated) : null;
}

/** Does this selector describe a hover/focus/active state of another rule? */
const isStateOnly = (sel) => /:(hover|focus|focus-visible|focus-within|active|disabled|checked|target)\b/.test(sel);

/**
 * Audit one stylesheet. Returns every rule that presents a pointer target
 * (`cursor: pointer`) whose guaranteed floor is under 24px, plus any rule
 * that shrinks such a control back under the floor from a breakpoint.
 */
export function auditStylesheet(css, tokens) {
    const rules = parseRules(css).map((r) => ({ ...r, decls: declarations(r.body) }));

    // Declarations are merged per selector before anything is scored. A
    // stylesheet is free to restate a selector (IssueTokenForm declares
    // `.back` twice, once for geometry and once for a transition), and
    // scoring the second block on its own would invent a violation out of
    // a rule that sets no geometry at all.
    const base = new Map();
    for (const r of rules) {
        if (r.at.length > 0 || isStateOnly(r.sel)) continue;
        base.set(r.sel, { ...(base.get(r.sel) ?? {}), ...r.decls });
    }

    // A pointer target is a selector that ends up with `cursor: pointer`
    // outside a hover/focus state. State rules are skipped rather than
    // audited: they re-declare colour, not geometry.
    const interactive = new Set();
    for (const [sel, decls] of base) {
        if (/^pointer$/i.test((decls.cursor ?? '').trim())) interactive.add(sel);
    }

    const findings = [];
    const score = (sel, at, decls) => {
        const width = statedWidth(decls, tokens);
        if (width !== null && width < FLOOR_PX) {
            findings.push({
                sel,
                at,
                axis: 'inline',
                floorPx: width,
                basis: `stated width ${width}px`,
                stated: true,
            });
        }
        const floor = ruleFloor(decls, tokens);
        if (floor.px >= FLOOR_PX) return;
        findings.push({
            sel, at, axis: 'block', floorPx: floor.px, basis: floor.basis, stated: floor.stated,
        });
    };
    for (const sel of interactive) score(sel, [], base.get(sel));
    // A breakpoint override is scored against the whole cascade for its
    // selector: a @media block that drops the padding back under the floor
    // is the same defect as never stating the floor.
    for (const r of rules) {
        if (r.at.length === 0 || !interactive.has(r.sel) || isStateOnly(r.sel)) continue;
        score(r.sel, r.at, { ...base.get(r.sel), ...r.decls });
    }
    return { rules, interactive, findings };
}
