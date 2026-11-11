// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const views = [
    'packages/core/src/shared/routes/Home.jsx',
    'packages/core/src/shared/routes/DispensersList.jsx',
    'packages/core/src/shared/routes/ContractsList.jsx',
    'packages/core/src/shared/routes/StakingList.jsx',
    'packages/core/src/shared/routes/History.jsx',
    'packages/core/src/shared/routes/ActionDetail.jsx',
    'packages/core/src/shared/components/PlaceOrderPanel.jsx',
    'packages/core/src/shared/components/TotalBalanceHero.jsx',
];

describe('sample data view boundary', () => {
    it.each(views)('%s carries no wallet-kind branch', (path) => {
        const source = readFileSync(path, 'utf8');
        expect(source).not.toMatch(/\bisDemo(Wallet|Active)?\b/);
        expect(source).not.toMatch(/import[^;]*\bisDemoWallet\b[^;]*from\s+['"][^'"]*flows\/demoMode\.js['"]/s);
        expect(source).not.toMatch(/\bsynthesizeDemo[A-Za-z]*\s*\(/);
    });
});
