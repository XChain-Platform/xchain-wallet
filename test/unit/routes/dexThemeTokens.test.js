// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const FILES = [
    'packages/core/src/shared/routes/MarketView.jsx',
    'packages/core/src/shared/routes/MarketsList.jsx',
    'packages/core/src/shared/routes/MarketActivity.module.css',
    'packages/core/src/shared/routes/SwapForm.jsx',
    'packages/core/src/shared/components/MarketChart.jsx',
    'packages/core/src/shared/components/PlaceOrderPanel.jsx',
    'packages/core/src/shared/components/PriceAlertForm.jsx',
];

describe('DEX surface theme colors', () => {
    it('uses theme tokens instead of literal CSS colors', () => {
        for (const file of FILES) {
            const source = readFileSync(file, 'utf8');
            expect(source, file).not.toMatch(/#[0-9a-f]{3,8}\b/i);
            expect(source, file).not.toMatch(/rgba?\s*\(/i);
        }
    });
});
