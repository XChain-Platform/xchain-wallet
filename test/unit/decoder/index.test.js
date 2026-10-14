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
import {
    balancesFromSdk,
    decodeAction,
    listEditValue,
    simulateAction,
    withListRemovalDescriptions,
} from '../../../packages/core/src/decoder/index.js';

const ACTION_TYPES = [
    'ADDRESS', 'AIRDROP', 'BATCH', 'BET', 'BROADCAST', 'CALLBACK', 'COINPAY',
    'COLLECT', 'DELEGATE', 'DEPLOY', 'DEPOSIT', 'DESTROY', 'DISPENSER',
    'DIVIDEND', 'EXECUTE', 'FILE', 'ISSUE', 'LINK', 'LIST', 'MESSAGE', 'MINT',
    'ORDER', 'PRICE', 'SEND', 'SLEEP', 'STAKE', 'SWAP', 'SWEEP', 'UNSTAKE',
    'VOTE', 'WITHDRAW',
];

describe('decoder public module', () => {
    it.each(ACTION_TYPES)('decodes %s actions', (action) => {
        const result = decodeAction({ action, params: {} });

        expect(result).toEqual({
            summary: expect.any(String),
            details: expect.any(Array),
            warnings: expect.any(Array),
        });
    });

    it.each(ACTION_TYPES)('simulates %s actions', (action) => {
        const result = simulateAction({ action, params: {}, balances: [] });

        expect(result).toEqual({
            deltas: expect.any(Array),
            sideEffects: expect.any(Array),
            notes: expect.any(Array),
        });
    });

    it.each([
        {
            name: 'balancesFromSdk',
            run: () => balancesFromSdk({
                native: { tick: 'btc', quantity: '100000000', divisibility: 8 },
            }),
            expected: [{ tick: 'BTC', amount: '1', isCoin: true }],
        },
        {
            name: 'listEditValue',
            run: () => listEditValue('0', 'allow'),
            expected: 'Remove allow list',
        },
        {
            name: 'withListRemovalDescriptions',
            run: () => withListRemovalDescriptions(
                { details: [{ label: 'Allow list', value: '0' }] },
                { action: 'ORDER', version: '2', params: { ALLOW_LIST: '0' } },
            ),
            expected: { details: [{ label: 'Allow list', value: 'Remove allow list' }] },
        },
    ])('exports $name', ({ run, expected }) => {
        expect(run()).toEqual(expected);
    });
});
