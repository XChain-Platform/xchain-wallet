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
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';
import { balancesFromSdk } from '../../../packages/core/src/decoder/balanceAdapter.js';
import { simulateAction } from '../../../packages/core/src/decoder/txSimulator.js';

describe('decoder malformed input boundaries', () => {
    it('returns a plain decoded error for invalid call shapes', () => {
        for (const value of [null, 'SEND', [], {}, { action: {} }, { action: 'SEND', params: [] }]) {
            const decoded = decodeAction(value);
            expect(decoded).toEqual({
                summary: 'Action data could not be decoded',
                details: [],
                warnings: [
                    'The action data is malformed. Review the raw transaction carefully before approving.',
                ],
            });
        }
    });

    it('flags non-decimal action amounts instead of accepting them as positive', () => {
        const decoded = decodeAction({
            action: 'SEND',
            params: { TICK: 'XCP', AMOUNT: 'not-a-number', DESTINATION: 'bc1qrecipient' },
        });

        expect(decoded.warnings).toContain('Amount is not positive.');
    });

    it('returns a plain simulation error for invalid call shapes', () => {
        for (const value of [null, 'SEND', [], {}, { action: 'SEND', params: [] }]) {
            expect(simulateAction(value)).toEqual({
                deltas: [],
                sideEffects: [],
                notes: [
                    'Balance changes could not be simulated because the transaction data is malformed.',
                ],
            });
        }
    });

    it('rejects a cyclic nested batch without recursing', () => {
        const params = {};
        params.COMMANDS = [{ action: 'BATCH', params }];

        const decoded = decodeAction({ action: 'BATCH', params });
        expect(decoded.summary).toContain('Nested batch command');
        expect(decoded.warnings).toContain(
            'Nested batch commands are malformed and cannot be decoded.',
        );

        const simulated = simulateAction({
            action: 'BATCH',
            params,
            balances: [],
            feeEstimate: '0',
        });
        expect(simulated.notes).toContain(
            'Nested batch commands are malformed and could not be simulated.',
        );
    });

    it.each([
        ['action amount', { action: 'SEND', params: { TICK: 'XCP', AMOUNT: 'abc' }, feeEstimate: '0' }],
        ['network fee', {
            action: 'SEND',
            params: {},
            balances: [{ tick: 'BTC', amount: '1', isCoin: true }],
            feeEstimate: '1e3',
        }],
        ['balance amount', {
            action: 'SEND',
            params: { TICK: 'XCP', AMOUNT: '1' },
            balances: [{ tick: 'XCP', amount: 'NaN' }],
            feeEstimate: '0',
        }],
    ])('returns a plain simulation error for a malformed %s', (_label, input) => {
        expect(simulateAction(input)).toEqual({
            deltas: [],
            sideEffects: [],
            notes: [
                'Balance changes could not be simulated because the transaction data is malformed.',
            ],
        });
    });

    it('marks impossible SDK balance numbers unknown instead of throwing or using zero', () => {
        const balances = balancesFromSdk({
            native: { tick: 'BTC', quantity: '1', divisibility: 'Infinity' },
            tokens: [{ tick: 'XCP', quantity: 'not-a-number', divisibility: 8 }],
        });

        expect(balances).toEqual([
            { tick: 'BTC', amount: '', isCoin: true, unknown: true },
            { tick: 'XCP', amount: '', isCoin: false, unknown: true },
        ]);

        const simulated = simulateAction({
            action: 'SEND',
            params: { TICK: 'XCP', AMOUNT: '1' },
            balances,
            feeEstimate: '0.001',
        });
        expect(simulated.deltas.find((delta) => delta.tick === 'XCP')).toMatchObject({
            before: '',
            after: '',
            beforeUnknown: true,
        });
        expect(simulated.deltas.find((delta) => delta.tick === 'BTC' && !delta.isFee)).toMatchObject({
            before: '',
            after: '',
            beforeUnknown: true,
        });
    });
});
