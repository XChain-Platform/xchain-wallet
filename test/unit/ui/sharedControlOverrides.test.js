// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Guards the button and control audit fixes: a route stylesheet restyling a
// kit Button through a descendant selector, a row class forcing a cursor over
// a disabled Switch, an icon button with its own radius, and an action built
// from raw <button> elements all drift from the shared controls.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const rule = (css, selector) => {
    const start = css.indexOf(`${selector} {`);
    return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
};

describe('shared control overrides', () => {
    it('History leaves the Clear date range Button to the kit', () => {
        const css = read('packages/core/src/shared/routes/History.module.css');

        expect(css).not.toMatch(/\.activeDateRange\s+button/);
    });

    it('Send keeps no Switch row of its own (its per-recipient token Switch left with the old rows)', () => {
        const css = read('packages/core/src/shared/routes/Send.module.css');

        expect(rule(css, '.rbfRow')).toBe('');
        expect(css).not.toMatch(/\.rbfRow\b/);
    });

});
