// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src', 'ui', 'Tabs.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

function escape(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns the declaration block of the first rule whose selector is exactly
// `selector`, at the top level or inside an at-rule.
function ruleBody(selector) {
    const match = css.match(new RegExp(`(^|[{}])\\s*${escape(selector)}\\s*\\{([^}]*)\\}`));
    return match ? match[2] : null;
}

// Returns the bodies of every `@media (forced-colors: active)` block, in source order.
function forcedColorsBlocks() {
    const blocks = [];
    const opener = /@media\s*\(forced-colors:\s*active\)\s*\{/g;
    let found;
    while ((found = opener.exec(css)) !== null) {
        let depth = 1;
        let index = opener.lastIndex;
        while (depth > 0 && index < css.length) {
            if (css[index] === '{') depth += 1;
            if (css[index] === '}') depth -= 1;
            index += 1;
        }
        blocks.push({ start: found.index, body: css.slice(opener.lastIndex, index - 1) });
    }
    return blocks;
}

function ruleIn(body, selector) {
    const match = body.match(new RegExp(`(^|[\\s}])${escape(selector)}\\s*\\{([^}]*)\\}`));
    return match ? match[2] : null;
}

// Declarations that paint a top or side edge: the border and border-color
// shorthands and every top, left, right or logical inline edge.
const boxEdge = /(^|[;\s])(border|border-color|border-width|border-style|border-top[\w-]*|border-left[\w-]*|border-right[\w-]*|border-inline[\w-]*|border-block-start[\w-]*)\s*:\s*([^;]*);/g;

function boxEdges(body) {
    return [...body.matchAll(boxEdge)]
        .map((match) => ({ property: match[2], value: match[3].trim() }))
        .filter(({ value }) => !/^(0|none)$/.test(value));
}

// Tabs sit on one line drawn under the whole row, and the selected tab is
// marked only by its underline: no tab draws a top or side edge in any state.
describe('tabs mark the selection with an underline only', () => {
    it('gives every tab a 2px bottom edge and no 1px side or top edge', () => {
        const tab = ruleBody('.tab');
        expect(tab).not.toBeNull();
        expect(tab).not.toMatch(/1px solid transparent/);
        expect(tab).toMatch(/border-bottom:\s*2px solid transparent\s*;/);
        expect(boxEdges(tab)).toEqual([]);
    });

    it('keeps the tab padding on the spacing scale', () => {
        expect(ruleBody('.tab')).toMatch(/padding:\s*0 var\(--xc-space-3\)\s*;/);
    });

    it('leaves the selected tab unfilled and marks only its bottom edge', () => {
        const selected = ruleBody(".tab[aria-selected='true']");
        expect(selected).not.toBeNull();
        expect(selected).toMatch(/background:\s*(transparent|none)\s*;/);
        expect(selected).toMatch(/color:\s*var\(--xc-accent-text\)\s*;/);
        expect(selected).toMatch(/border-bottom-color:\s*var\(--xc-control-selected\)\s*;/);
        expect(boxEdges(selected)).toEqual([]);
    });

    it('draws no side edge on a hovered tab', () => {
        const hover = ruleBody(".tab:hover:not([aria-selected='true'])");
        expect(hover).not.toBeNull();
        expect(boxEdges(hover)).toEqual([]);
    });

    it('changes only the text colour and bottom bar of a hovered tab, never a filled box', () => {
        const hover = ruleBody(".tab:hover:not([aria-selected='true'])");
        expect(hover).not.toBeNull();
        expect(hover).not.toMatch(/(^|[;\s])(background|background-color|box-shadow|outline)\s*:/);
        const borders = [...hover.matchAll(/(^|[;\s])(border[\w-]*)\s*:\s*([^;]*);/g)]
            .map((match) => ({ property: match[2], value: match[3].trim() }))
            .filter(({ property, value }) => property !== 'border-bottom-color' && value !== 'transparent');
        expect(borders).toEqual([]);
        const properties = [...hover.matchAll(/(^|[;\s])([\w-]+)\s*:/g)].map((match) => match[2]);
        expect(properties).toContain('color');
        expect(properties.every((property) => property === 'color' || property === 'border-bottom-color')).toBe(true);
    });

    it('marks the selected tab on its bottom edge in forced colors', () => {
        // Forced colors paints a transparent border in CanvasText, so the
        // override comes after the base rules to win the cascade.
        const selectedRuleAt = css.search(/(^|\n)\.tab\[aria-selected='true'\]\s*\{/);
        const late = forcedColorsBlocks().filter((block) => block.start > selectedRuleAt);
        const idle = late.map((block) => ruleIn(block.body, '.tab')).find(Boolean);
        const selected = late
            .map((block) => ruleIn(block.body, ".tab[aria-selected='true']"))
            .find(Boolean);
        expect(idle).toMatch(/border-bottom-color:\s*Canvas\s*;/);
        expect(selected).toMatch(/border-bottom-color:\s*Highlight\s*;/);
        expect(boxEdges(idle)).toEqual([]);
        expect(boxEdges(selected)).toEqual([]);
    });
});

// Every rule in the file with its selector and declaration block, at the top
// level or inside an at-rule.
function allRules() {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map((match) => ({ selector: match[1].trim(), body: match[2] }));
}

// A pressed tab reads like a hovered one: it changes its text colour only and
// never draws a box, an inset ring or a fill.
describe('a pressed tab draws no box', () => {
    it('declares no box-shadow in any tab rule', () => {
        const shadowed = allRules().filter(({ body }) => /(^|[;\s])box-shadow\s*:/.test(body));
        expect(shadowed.map(({ selector }) => selector)).toEqual([]);
    });

    it('sets no background or box-shadow on a pressed unselected tab', () => {
        const pressed = allRules().filter(({ selector }) => /\.tab:active\b/.test(selector));
        for (const { body } of pressed) {
            expect(body).not.toMatch(/(^|[;\s])(background|background-color|box-shadow)\s*:/);
        }
    });

    it('keeps the underline on the selected tab', () => {
        expect(ruleBody(".tab[aria-selected='true']"))
            .toMatch(/border-bottom-color:\s*var\(--xc-control-selected\)\s*;/);
    });
});
