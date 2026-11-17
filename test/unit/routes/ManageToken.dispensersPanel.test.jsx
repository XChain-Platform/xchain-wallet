// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The issuer's actions and facts (once the Manage token page) now live in
// TokenOwnerActions.jsx, shown on the one asset page.
const source = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/TokenOwnerActions.jsx'),
    'utf8',
);

describe('issuer actions: removed market panels', () => {
    it('does not request dispenser, order, or swap panel data', () => {
        expect(source).not.toContain('getDispensersForToken');
        expect(source).not.toContain('getOrdersForToken');
        expect(source).not.toContain('getSwapsForToken');
        expect(source).not.toContain('DispensersPanel');
        expect(source).not.toContain('OrdersPanel');
        expect(source).not.toContain('SwapsPanel');
    });
});
