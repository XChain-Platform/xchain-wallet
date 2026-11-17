// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Dispenser detail's actions were a row of tiles, then owner buttons under
// the card and a pill row of copy buttons. Ruling G101 (2026-11-13) draws
// every one of them as a row of the shared action list in the Actions tab,
// so the page's stylesheet paints no tile, owner-button or pill row of its
// own. jsdom has no layout, so this pins the source.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function read(path) {
    return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Dispenser detail actions', () => {
    it('paints no tile grid, owner button row or pill row of its own', () => {
        const css = read('packages/core/src/shared/routes/DispenserDetail.module.css').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const selector of ['.quickActions', '.quickActionLink', '.quickActionIcon', '.quickActionLogo', '.ownerActions', '.closeButton', '.linkRow']) {
            expect(css, selector).not.toContain(selector);
        }
    });

    it('draws the actions through the shared action list', () => {
        const source = read('packages/core/src/shared/routes/DispenserDetail.jsx');
        expect(source).toMatch(/<ActionList label="Dispenser actions">/);
        expect(source).not.toMatch(/role="group" aria-label="Dispenser (actions|links)"/);
    });
});
