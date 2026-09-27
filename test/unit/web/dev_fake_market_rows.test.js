// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { fakeOrdersFor, fakeSwapsFor } from '../../../packages/web/src/devFakeBalances.js';

describe('dev fake market rows', () => {
    it('uses the explorer order list shape', () => {
        const rows = fakeOrdersFor('PEPECASH', 'bitcoin-mainnet');
        expect(rows.every((row) => row.status === 'valid'
            && row.give_amount != null && row.get_amount != null
            && row.give_quantity === undefined && row.get_quantity === undefined)).toBe(true);
        expect(rows.some((row) => row.get_tick === null && row.get_coin === 'BTC')).toBe(true);
    });

    it('uses the explorer swap list shape', () => {
        const rows = fakeSwapsFor('PEPECASH', 'bitcoin-mainnet');
        expect(rows.every((row) => row.status === 'valid'
            && row.swap_status === 'complete'
            && row.give_amount != null && row.get_amount != null
            && row.give_quantity === undefined && row.get_quantity === undefined)).toBe(true);
        expect(rows.some((row) => row.give_tick === null && row.give_coin === 'BTC')).toBe(true);
    });
});
