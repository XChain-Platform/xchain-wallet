// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { balancesFromSdk } from '../../../packages/core/src/decoder/balanceAdapter.js';

describe('balancesFromSdk low-coverage branches', () => {
    it('defaults a missing divisibility to zero', () => {
        expect(balancesFromSdk({
            tokens: [{ tick: 'whole', quantity: '123' }],
        })).toEqual([
            { tick: 'WHOLE', amount: '123', isCoin: false },
        ]);
    });
});
