// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.jsx'),
    'utf8',
);
const owner = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/TokenOwnerActions.jsx'),
    'utf8',
);

// Manage Token uses TokenDetail's owner view, which suppresses the asset
// chart. Neither the route nor the issuer module carries chart machinery.
describe('ManageToken chart removal', () => {
    it('draws or synthesizes no chart of its own', () => {
        expect(route).toContain('<TokenDetail');
        for (const source of [route, owner]) {
            expect(source).not.toContain('Sparkline');
            expect(source).not.toContain('synthesizeTokenChart');
            expect(source).not.toContain('CHART_RANGES');
            expect(source).not.toContain('isDemoWallet');
        }
    });
});
