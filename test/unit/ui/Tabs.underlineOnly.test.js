// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every view toggle in the wallet (Tabs and SegmentedControl) draws one look,
// ruled 2026-11-13 as Option B: the group spans its row with the card corner
// radius; items share the width with no gap and no inset; the active item
// fills its segment edge to edge with straight inner sides; inactive
// neighbours are split by a 1px divider; the fill is the selected blue, or
// green for Buy and red for Sell. The file name is historical: tabs no longer
// mark the selection with an underline.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const uiRoot = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src', 'ui');
const css = readFileSync(join(uiRoot, 'SegmentedControl.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const tabsCss = readFileSync(join(uiRoot, 'Tabs.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

const ACTIVE = ":is([aria-checked='true'], [aria-selected='true'])";

function escape(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns the declaration block of the first rule whose selector list is
// exactly `selector`, at the top level or inside an at-rule.
function ruleBody(selector, source = css) {
    const match = source.match(new RegExp(`(^|[{}])\\s*${escape(selector)}\\s*\\{([^}]*)\\}`));
    return match ? match[2] : null;
}

describe('the one view-toggle look (Option B)', () => {
    it('spans the row in one frame with the card corner radius and no inset', () => {
        const group = ruleBody('.segmented');
        expect(group).not.toBeNull();
        expect(group).toMatch(/display:\s*flex\s*;/);
        expect(group).toMatch(/width:\s*100%\s*;/);
        expect(group).toMatch(/border-radius:\s*var\(--xc-card-radius\)\s*;/);
        expect(group).toMatch(/padding:\s*0\s*;/);
        expect(group).toMatch(/gap:\s*0\s*;/);
        // The clip gives the active fill its rounding at the outer ends only.
        expect(group).toMatch(/overflow-x:\s*(auto|hidden)\s*;/);
    });

    it('gives items even shares, straight sides and no edge but the divider', () => {
        const item = ruleBody('.segment');
        expect(item).not.toBeNull();
        expect(item).toMatch(/flex:\s*1 1 0\s*;/);
        expect(item).toMatch(/border:\s*0\s*;/);
        expect(item).toMatch(/border-radius:\s*0\s*;/);
        expect(item).toMatch(/white-space:\s*nowrap\s*;/);
        expect(item).toMatch(/min-width:\s*max-content\s*;/);
    });

    it('draws a 1px divider between neighbours and none against the active fill', () => {
        expect(ruleBody('.segment + .segment'))
            .toMatch(/border-inline-start:\s*1px solid var\(--xc-control-border\)\s*;/);
        const cleared = ruleBody(`.segment${ACTIVE},\n.segment${ACTIVE} + .segment`);
        expect(cleared).not.toBeNull();
        expect(cleared).toMatch(/border-inline-start-color:\s*transparent\s*;/);
        // The clearing rule comes after the divider rule so it wins the tie.
        expect(css.indexOf(`.segment${ACTIVE} + .segment`))
            .toBeGreaterThan(css.indexOf('.segment + .segment {'));
    });

    it('fills the active item blue, or green and red for the Buy and Sell tones', () => {
        expect(ruleBody(`.segment${ACTIVE}`)).toMatch(/background:\s*var\(--xc-control-selected\)\s*;/);
        expect(ruleBody(`.segment[data-tone='success']${ACTIVE}`))
            .toMatch(/background:\s*var\(--xc-success-fill\)\s*;/);
        expect(ruleBody(`.segment[data-tone='danger']${ACTIVE}`))
            .toMatch(/background:\s*var\(--xc-danger\)\s*;/);
    });

    it('never fills a hovered or pressed inactive item', () => {
        const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
            .map((match) => ({ selector: match[1].trim(), body: match[2] }))
            .filter(({ selector }) => /\.segment:(hover|active)\b/.test(selector));
        expect(rules.length).toBeGreaterThan(0);
        for (const { body } of rules) {
            expect(body).not.toMatch(/(^|[;\s])(background|background-color|box-shadow)\s*:/);
        }
    });

    it('gives up side padding on narrow rows before a label could wrap', () => {
        const narrow = css.match(/@media \(max-width: 400px\)\s*\{([\s\S]*?)\n\}/);
        expect(narrow).not.toBeNull();
        expect(ruleBody('.segment', narrow[1])).toMatch(/padding:\s*0 var\(--xc-space-2\)\s*;/);
    });

    it('leaves the Tabs sheet no frame, pill or underline of its own', () => {
        expect(tabsCss).not.toMatch(/\.tabs\b/);
        expect(tabsCss).not.toMatch(/border-bottom/);
        expect(tabsCss).not.toMatch(/\.tab\.tab\b/);
    });
});
