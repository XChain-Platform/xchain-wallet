// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.module.css'),
    'utf8',
);

describe('ManageToken phone action grid', () => {
    it('draws its action tiles on the coin page grid, with no grid of its own', () => {
        const source = readFileSync(
            join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.jsx'),
            'utf8',
        );
        expect(source).toMatch(/className=\{tokenDetailStyles\.assetActionGrid\}/);
        expect(css).not.toMatch(/\.approvedActionGrid\b|\.approvedActionTile\b/);
        expect(css).not.toContain('.statsStrip');
    });
});
