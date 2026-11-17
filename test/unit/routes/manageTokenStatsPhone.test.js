// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.module.css'),
    'utf8',
);

describe('issuer actions phone action list', () => {
    it('draws its actions as the shared action list (G101), with no grid or tiles of its own', () => {
        const source = readFileSync(
            join(process.cwd(), 'packages/core/src/shared/components/TokenOwnerActions.jsx'),
            'utf8',
        );
        expect(source).toMatch(/<ActionList label=\{group\.title\}>/);
        expect(source).not.toMatch(/QuickActionTile|assetActionGrid/);
        expect(css).not.toMatch(/\.approvedActionGrid\b|\.approvedActionTile\b/);
        expect(css).not.toContain('.statsStrip');
    });
});
