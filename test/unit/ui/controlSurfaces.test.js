// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every button is the shared Button, every text field, select and textarea is
// the shared Input, Select or Textarea, and a screen stylesheet never paints a
// control's own border, radius, background, outline or shadow. Raw controls
// and hand-set control skins outside packages/core/src/ui live in
// controlSurfaces.allowlist.json with the reason each stays. A count may only
// go down: a new raw control fails here, and a fixed one must lower its entry.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    handSetControlSelectors, rawControlCount, scanHandSetStyles, scanRawControls,
} from './controlSurfaces.scan.js';

const allowlist = JSON.parse(readFileSync(join(process.cwd(), 'test/unit/ui/controlSurfaces.allowlist.json'), 'utf8'));

function compare(found, listed) {
    const added = [];
    const lowerable = [];
    const unreasoned = [];
    for (const [file, count] of Object.entries(found)) {
        const entry = listed[file];
        if (!entry) added.push(`${file}: ${count}`);
        else if (count > entry.count) added.push(`${file}: ${count} (allowlist ${entry.count})`);
        else if (count < entry.count) lowerable.push(`${file}: ${count} (allowlist ${entry.count})`);
    }
    for (const [file, entry] of Object.entries(listed)) {
        if (!(file in found)) lowerable.push(`${file}: 0 (allowlist ${entry.count})`);
        if (typeof entry.reason !== 'string' || entry.reason.trim().length < 12) unreasoned.push(file);
    }
    return { added, lowerable, unreasoned };
}

describe('control surfaces', () => {
    it('counts raw controls and hand-set control skins', () => {
        expect(rawControlCount('<button type="button">A</button>\n<Button>B</Button>\n<input />\n<select></select>\n<textarea />')).toBe(4);
        expect(rawControlCount('// <button>\n/* <input> */\n{/* <select> */}\n<Buttons />')).toBe(0);
        expect(handSetControlSelectors([
            '.accept { background: red; border-radius: 4px; }',
            '.saveButton:hover { background: blue; }',
            '.pageTitle { border: 1px solid red; }',
            '.card input { outline: 1px solid red; }',
            '.dismiss { margin: 0; }',
            '.searchField { flex: 1; }',
        ].join('\n'))).toEqual(['.saveButton:hover', '.card input']);
    });

    it('keeps raw button, input, select and textarea elements to the allowlist', () => {
        const { added, lowerable, unreasoned } = compare(scanRawControls(), allowlist.rawElements);
        expect({ added, lowerable, unreasoned }).toEqual({ added: [], lowerable: [], unreasoned: [] });
    });

    it('keeps hand-set control skins in screen stylesheets to the allowlist', () => {
        const { added, lowerable, unreasoned } = compare(scanHandSetStyles(), allowlist.handSetStyles);
        expect({ added, lowerable, unreasoned }).toEqual({ added: [], lowerable: [], unreasoned: [] });
    });

    it('keeps the edge and hover border of an actions entry inside a card', () => {
        // An actions entry composes the shared card, so the nested-card reset
        // (.card .card) strips its border wherever its list sits inside a
        // card. The card list carries data-xc-menu-list="cards", and a later
        // rule in Card.module.css redraws the card surface for its entries.
        const root = process.cwd();
        const cardCss = readFileSync(join(root, 'packages/core/src/ui/Card.module.css'), 'utf8');
        const menuCss = readFileSync(join(root, 'packages/core/src/shared/routes/ActionsMenu.module.css'), 'utf8');
        const menuJsx = readFileSync(join(root, 'packages/core/src/shared/routes/ActionsMenu.jsx'), 'utf8');
        const body = (source, selector) => {
            const match = new RegExp(`(?:^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`, 'm').exec(source);
            return match ? match[1] : null;
        };

        expect(body(menuCss, '\\.entry')).toMatch(/composes:\s*card from '\.\.\/\.\.\/ui\/Card\.module\.css'/);
        expect(menuJsx).toMatch(/styles\.listPopup\}\s*data-xc-menu-list="cards"/);

        const flattener = cardCss.search(/\.card \.card,\s*\.card \.flush,\s*\.flush \.card,\s*\.flush \.flush\s*\{/);
        const keep = /\[data-xc-menu-list="cards"\] \.card\s*\{([^}]*)\}/.exec(cardCss);
        expect(flattener).toBeGreaterThanOrEqual(0);
        expect(keep, 'Card.module.css redraws the card on entries of a card list').not.toBeNull();
        expect(keep.index).toBeGreaterThan(flattener);
        expect(keep[1]).toMatch(/border:\s*var\(--xc-card-border\)/);
        expect(keep[1]).toMatch(/border-radius:\s*var\(--xc-card-radius\)/);
        expect(keep[1]).toMatch(/background:\s*var\(--xc-card-bg\)/);

        // The hover edge outranks the redrawn card surface, (0,3,0) over (0,2,0).
        expect(menuCss).toMatch(/\.entry:hover:not\(\[aria-disabled="true"\]\)\s*\{[^}]*border-color:\s*var\(--xc-control-border-hover\)/);
    });
});
