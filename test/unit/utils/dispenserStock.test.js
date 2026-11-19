// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { dispenserStock } from '../../../packages/core/src/shared/utils/dispenserStock.js';

describe('dispenserStock', () => {
    it('uses remaining escrow over give amount and original escrow for the total', () => {
        expect(dispenserStock({
            remainingEscrow: '60',
            giveAmount: '1',
            originalEscrow: '100',
            dispenseCount: '40',
        })).toEqual({
            remaining: 60n,
            total: 100n,
            percent: 60,
            label: '60 of 100 left',
        });
    });

    it('keeps exact fractional arithmetic and groups large stock counts', () => {
        expect(dispenserStock({
            remainingEscrow: '1250.0',
            giveAmount: '0.1',
            totalDispenses: '25000',
        })).toEqual({
            remaining: 12500n,
            total: 25000n,
            percent: 50,
            label: '12,500 of 25,000 left',
        });
    });

    it('reports unavailable stock when no total source is present', () => {
        expect(dispenserStock({ remainingEscrow: '4', giveAmount: '1' })).toMatchObject({
            remaining: 4n,
            total: null,
            percent: 0,
            label: 'Stock unavailable',
        });
    });
});
