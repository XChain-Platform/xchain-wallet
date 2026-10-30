// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later


// Inline notice actions read at the notice text size.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name) => readFileSync(resolve(process.cwd(), `packages/core/src/ui/${name}`), 'utf8');
const rule = (css, selector) => {
    const start = css.indexOf(`\n${selector} {`);
    return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
};

describe('inline actions read at the surrounding text size', () => {
    it('sizes the link Button from its context, not the 16px touch control size', () => {
        expect(rule(read('Button.module.css'), '.link')).toMatch(/font-size:\s*inherit/);
    });

    it('draws the notice recovery action as the small shared Button, not a hand-sized one', () => {
        const jsx = read('StatusMessage.jsx');
        expect((jsx.match(/size="sm"/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(rule(read('StatusMessage.module.css'), '.recovery')).not.toMatch(/font-size|min-height|padding|border/);
    });
});
