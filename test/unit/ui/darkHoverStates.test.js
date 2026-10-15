// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8');

// Hover and focus states that lightened a dark surface dropped their labels
// below 4.5:1, and a kit hover fill out-ranked a route's own hover rule.
describe('dark palette hover states', () => {
    it('tints the notice recovery action with its own colour instead of white', () => {
        const css = read('packages/core/src/ui/StatusMessage.module.css');
        const recovery = css.slice(css.indexOf('.recovery {'), css.indexOf('.recovery:hover'));
        expect(recovery).not.toMatch(/rgba\(255,\s*255,\s*255/);
        expect(css).toMatch(/\.recovery:focus-visible\s*\{\s*background:\s*color-mix\(in srgb, currentColor 8%, transparent\)/);
    });

    it('keeps the link button free of a hover fill', () => {
        const css = read('packages/core/src/ui/Button.module.css');
        const link = css.slice(css.indexOf('.link {'), css.indexOf('.ghost'));
        expect(link).toMatch(/--xc-button-hover-bg:\s*transparent/);
    });

    it('out-ranks the Button kit hover on the market selector', () => {
        const css = read('packages/core/src/shared/routes/MarketActivity.module.css');
        expect(css).toMatch(/\.marketSelector\.marketSelector:hover:not\(:disabled\)\s*\{\s*background:\s*var\(--xc-bg-muted\)/);
    });
});
