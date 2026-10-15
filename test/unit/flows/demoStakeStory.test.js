// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: the demo wallet DeFi stake rows and the Staking screen read one fixture.

import { describe, expect, test } from 'vitest';

import { synthesizeDemoDefiPositions, synthesizeDemoStaking } from '../../../packages/core/src/flows/demoFixtures.js';

describe('the demo validator stake tells one story', () => {
    const stakes = synthesizeDemoDefiPositions().filter((p) => p.kind === 'stake');
    const staking = synthesizeDemoStaking('bitcoin-regtest').stakes[0];

    test('every DeFi stake row shows the amount the Staking screen holds', () => {
        expect(stakes.length).toBeGreaterThan(1);
        for (const row of stakes) {
            expect(Number(row.primary.replace(/[^0-9.]/g, '').replace(/\.0+$/, '').replace(/,/g, ''))).toBe(Number(staking.amount));
        }
    });

    test('every DeFi stake row names the same validator', () => {
        for (const row of stakes) expect(row.secondary).toContain('demo-validator-7');
    });
});

test('mainnet and regtest hold the same validator stake', () => {
    const mainnet = synthesizeDemoStaking('bitcoin-mainnet');
    const regtest = synthesizeDemoStaking('bitcoin-regtest');
    expect(mainnet.stakes).toEqual(regtest.stakes);
    expect(mainnet.stakes[0].amount).toBe('50000');
});
