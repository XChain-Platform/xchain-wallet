// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useNativeFiatRates: () => ({
        bitcoin: { rate: 50000, fiatCurrency: 'EUR' },
    }),
    useTokenFiatRates: () => ({
        'bitcoin|TOKEN': { rate: 2, fiatCurrency: 'EUR' },
    }),
}));

const { BalanceChanges } = await import(
    '../../../packages/core/src/shared/components/BalanceChanges.jsx'
);

afterEach(() => cleanup());

const RESULT = {
    deltas: [
        { tick: 'TOKEN', before: '10', after: '7.5', isCoin: false, isFee: false },
        { tick: 'BTC', before: '1', after: '0.9999', isCoin: true, isFee: false },
    ],
    sideEffects: [{ kind: 'airdrop', label: 'Airdrop', value: '? TOKEN per recipient' }],
    notes: [],
};

describe('BalanceChanges pre-sign audit details', () => {
    it('lists every affected asset with a signed amount, unit, and selected-currency fiat', () => {
        const { container } = render(
            <BalanceChanges
                result={RESULT}
                chainCoin="bitcoin"
                nativeTicker="BTC"
                fiatCurrency="EUR"
            />,
        );

        expect(screen.getByText('−2.5 TOKEN')).toBeTruthy();
        expect(screen.getByText('−0.0001 BTC')).toBeTruthy();
        expect(screen.getByText('10 TOKEN')).toBeTruthy();
        expect(screen.getByText('7.5 TOKEN')).toBeTruthy();
        expect(screen.getAllByText('≈ -€5.00 EUR')).toHaveLength(2);
        expect(screen.queryByText(/USD/)).toBeNull();
        for (const row of container.querySelectorAll('[data-direction]')) {
            expect(row.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
            expect(row.querySelector('dd').style.overflowWrap).toBe('anywhere');
        }
    });

    it('states unknown values and unavailable fiat plainly', () => {
        const result = {
            deltas: [
                { tick: 'MYSTERY', before: '4', after: '3', isCoin: false, isFee: false },
                { tick: 'BTC', before: '', after: '', isCoin: true, isFee: true, feeUnknown: true },
            ],
            sideEffects: RESULT.sideEffects,
            notes: [],
        };
        render(<BalanceChanges result={result} chainCoin="bitcoin" fiatCurrency="EUR" />);

        expect(screen.getByText('− unknown BTC')).toBeTruthy();
        expect(screen.getAllByText('Fiat unavailable (EUR)')).toHaveLength(2);
        expect(screen.getByText('unknown TOKEN per recipient')).toBeTruthy();
    });
});
