// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';

describe('decodeAction low-coverage branches', () => {
    it('describes a sweep with every selectable category disabled', () => {
        const decoded = decodeAction({
            action: 'SWEEP',
            params: {
                DESTINATION: 'destination',
                BALANCES: '0',
                OWNERSHIPS: '0',
                ORDERS: '0',
                SWAPS: '0',
                DISPENSERS: '0',
            },
        });

        expect(decoded.summary).toBe('Sweep nothing to destination');
        expect(decoded.details).toContainEqual({ label: 'Sweeps', value: 'nothing' });
    });

    it('includes each optional escrow category selected by sweep flags', () => {
        const decoded = decodeAction({
            action: 'SWEEP',
            params: {
                DESTINATION: 'destination',
                BALANCES: '0',
                OWNERSHIPS: '0',
                ORDERS: '1',
                SWAPS: '1',
                DISPENSERS: '1',
            },
        });

        expect(decoded.summary).toBe(
            'Sweep open orders, open swaps, open dispensers to destination',
        );
    });

    it('warns about exactly the categories a sweep selects', () => {
        const escrowOnly = decodeAction({
            action: 'SWEEP',
            params: { DESTINATION: 'destination', BALANCES: '0', OWNERSHIPS: '0', DISPENSERS: '1' },
        });
        expect(escrowOnly.warnings[0]).toBe(
            'Sweep moves the selected categories (open dispensers) from the source address. Double-check the destination.',
        );
        const defaults = decodeAction({ action: 'SWEEP', params: { DESTINATION: 'destination' } });
        expect(defaults.warnings[0]).toBe(
            'Sweep moves the selected categories (balances, ownerships) from the source address. Double-check the destination.',
        );
    });

    it('marks the missing ticker in a multi-destroy leg', () => {
        const decoded = decodeAction({
            action: 'DESTROY',
            params: { VERSION: '2', TICK: ['EDGE'], AMOUNT: ['1', '2'] },
        });

        expect(decoded.summary).toBe('Destroy: 1 EDGE, 2 ?');
        expect(decoded.warnings).toContain('One or more token tickers are empty.');
    });

    it('marks the missing amount in a multi-destroy leg', () => {
        const decoded = decodeAction({
            action: 'DESTROY',
            params: { VERSION: '1', TICK: ['EDGE', 'NEXT'], AMOUNT: ['1'] },
        });

        expect(decoded.summary).toBe('Destroy: 1 EDGE, ? NEXT');
        expect(decoded.warnings).toContain('One or more amounts are not positive.');
    });
});
