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
});
