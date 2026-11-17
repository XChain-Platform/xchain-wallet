// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home no longer has a quick action row: its stylesheet holds no tile grid,
// and the loading skeleton draws no tile row either. jsdom has no layout, so
// this pins the source.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Home quick actions grid is gone', () => {
    it('keeps no quick action grid rules in the Home stylesheet', () => {
        const css = read('packages/core/src/shared/routes/Home.module.css');
        expect(css).not.toMatch(/\.quickActions/);
        expect(css).not.toMatch(/\.quickActionsReason/);
    });

    it('draws no tile row in the loading skeleton', () => {
        const source = read('packages/core/src/shared/routes/Home.jsx');
        expect(source).not.toMatch(/shape="tile"/);
        expect(source).not.toMatch(/styles\.quickActions/);
    });
});
