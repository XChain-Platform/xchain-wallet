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
import { simulateAction } from '../../../packages/core/src/decoder/txSimulator.js';

describe('simulateAction edge branches', () => {
    it('does not credit initial supply routed to another address', () => {
        const result = simulateAction({
            action: 'ISSUE',
            params: {
                VERSION: '0', TICK: 'EDGE', MINT_SUPPLY: '100', TRANSFER_SUPPLY: 'addr1',
            },
            balances: [{ tick: 'EDGE', amount: '5' }],
            feeEstimate: '0',
        });

        expect(result.deltas).toEqual([]);
        expect(result.sideEffects).toContainEqual({
            kind: 'supply', label: 'EDGE supply', value: '+100 (initial)',
        });
    });

    it.each([
        [{ ORACLE_ADDRESS: 'oracle1', FIAT_CODE: '' }, 'oracle-priced in fiat'],
        [{ FIAT_AMOUNT: '12.50', FIAT_CODE: 'usd' }, '12.50 USD'],
        [{ GET_TICK: 'pay', GET_AMOUNT: '3' }, '3 PAY'],
        [{ GET_COIN: 'btc', GET_AMOUNT: '0.1' }, '0.1 BTC'],
    ])('selects the dispenser pricing branch for %j', (pricing, expected) => {
        const result = simulateAction({
            action: 'DISPENSER',
            params: {
                VERSION: '0', GIVE_TICK: 'EDGE', GIVE_AMOUNT: '1', GIVE_ESCROW: '5',
                ...pricing,
            },
            balances: [{ tick: 'EDGE', amount: '10' }],
            feeEstimate: '0',
        });

        expect(result.sideEffects[0].value).toContain(`per ${expected}`);
    });

    it('omits a fee row when no native coin can be inferred', () => {
        const result = simulateAction({
            action: 'SEND',
            params: { TICK: 'EDGE', AMOUNT: '2' },
            balances: [{ tick: 'EDGE', amount: '10' }],
            feeEstimate: '0.1',
        });

        expect(result.deltas).toEqual([
            { tick: 'EDGE', before: '10', after: '8', isCoin: false, isFee: false },
        ]);
    });

    it('normalizes separators in a generic fallback action name', () => {
        const result = simulateAction({ action: 'FUTURE_ACTION-NAME', params: {} });

        expect(result.notes).toEqual([
            'Balance changes for "Future action name" are not pre-simulated. The fee row above is the only confirmed debit.',
        ]);
    });

    it('uses placeholders for an airdrop with no tick or amount', () => {
        const result = simulateAction({ action: 'AIRDROP', params: {}, feeEstimate: '0' });

        expect(result.sideEffects[0].value).toBe('? ? per recipient');
    });

    it('aggregates repeated debits to the same token in a batch', () => {
        const result = simulateAction({
            action: 'BATCH',
            params: {
                COMMANDS: [
                    { action: 'SEND', params: { TICK: 'EDGE', AMOUNT: '2' } },
                    { action: 'DESTROY', params: { TICK: 'EDGE', AMOUNT: '3' } },
                ],
            },
            balances: [{ tick: 'EDGE', amount: '10' }],
            feeEstimate: '0',
        });

        expect(result.deltas).toEqual([
            { tick: 'EDGE', before: '10', after: '5', isCoin: false, isFee: false },
        ]);
    });

    it('treats a missing balance amount as zero', () => {
        const result = simulateAction({
            action: 'MINT',
            params: { TICK: 'EDGE', AMOUNT: '.5' },
            balances: [{ tick: 'edge' }],
            feeEstimate: '0',
        });

        expect(result.deltas[0]).toEqual({
            tick: 'EDGE', before: '0', after: '0.5', isCoin: false, isFee: false,
        });
    });
});
