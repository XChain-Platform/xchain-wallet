// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FeeSelector } from '../../../packages/core/src/ui/FeeSelector.jsx';
import {
    registerLocale,
    setLocale,
} from '../../../packages/core/src/i18n/index.js';

const TIERS = {
    unit: 'sat/vB',
    low: { rate: '1 sat/vB', rateValue: 1, coinAmount: '0.00000100', etaMinutes: 30, vsize: 100 },
    normal: { rate: '2 sat/vB', rateValue: 2, coinAmount: '0.00000200', etaMinutes: 10, vsize: 100 },
    fast: { rate: '3 sat/vB', rateValue: 3, coinAmount: '0.00000300', etaMinutes: 2, vsize: 100 },
};

beforeAll(() => {
    registerLocale('de-DE', {});
    registerLocale('fr-FR', {});
});

afterEach(async () => {
    await setLocale('en');
});

describe('<FeeSelector>', () => {
    it('renders an accessible preset slider and formatted estimate', () => {
        render(
            <FeeSelector
                tiers={TIERS}
                value={{ mode: 'normal' }}
                onChange={() => {}}
                label="Fee priority"
                coinTicker="BTC"
                formatFiat={() => '$0.12'}
            />,
        );
        const slider = screen.getByRole('slider', { name: 'Network fee' });
        expect(slider).toHaveAttribute('aria-valuetext', 'Normal: 0.00000200 · ~10 min');
        expect(screen.getByRole('status')).toHaveTextContent('0.00000200 BTC');
        expect(screen.getByRole('status')).toHaveTextContent('$0.12');
        expect(screen.getByRole('button', { name: 'Fee priority help' })).toBeInTheDocument();
    });

    it('emits preset and custom selections', () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <FeeSelector tiers={TIERS} value={{ mode: 'normal' }} onChange={onChange} />,
        );
        fireEvent.change(screen.getByRole('slider'), { target: { value: '2' } });
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'fast' });
        fireEvent.click(document.querySelector('button[aria-label="Custom"]'));
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 2 });

        rerender(
            <FeeSelector
                tiers={TIERS}
                value={{ mode: 'custom', customRate: 4 }}
                customEstimate={{ rate: '4 sat/vB', rateValue: 4, coinAmount: '0.00000400', vsize: 100 }}
                onChange={onChange}
            />,
        );
        fireEvent.change(screen.getByRole('textbox', { name: 'Custom fee rate (sat/vB)' }), {
            target: { value: '5.5' },
        });
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 5.5 });
    });

    it('supports exact-fee editing and converts coin amount to rate', () => {
        const onChange = vi.fn();
        render(
            <FeeSelector
                tiers={TIERS}
                value={{ mode: 'normal' }}
                onChange={onChange}
                coinTicker="BTC"
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Edit exact fee amount' }));
        const amount = screen.getByRole('textbox', { name: 'Network fee amount (BTC)' });
        expect(amount).toHaveValue('0.00000200');
        fireEvent.change(amount, { target: { value: '0.000005' } });
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 5 });

        fireEvent.change(amount, { target: { value: '1,2,3' } });
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 0 });
        expect(amount).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent('valid non-negative network fee');
    });

    it.each([
        ['de-DE', '2,75'],
        ['fr-FR', '2,75'],
    ])('parses a localized custom rate in %s without changing its numeric value', async (
        locale,
        localizedRate,
    ) => {
        await setLocale(locale);
        const onChange = vi.fn();
        render(
            <FeeSelector
                tiers={TIERS}
                value={{ mode: 'custom', customRate: 2.5 }}
                customEstimate={{ rateValue: 2.5, coinAmount: '0.00000250', vsize: 100 }}
                onChange={onChange}
            />,
        );
        const input = screen.getByRole('textbox', { name: 'Custom fee rate (sat/vB)' });
        expect(input).toHaveValue('2,5');

        fireEvent.change(input, { target: { value: localizedRate } });

        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 2.75 });
        expect(screen.queryByRole('alert')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Edit exact fee amount' }));
        const exactFee = screen.getByRole('textbox', { name: 'Network fee amount' });
        expect(exactFee).toHaveValue('0,00000250');
        fireEvent.change(exactFee, { target: { value: '0,000005' } });
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 5 });
    });

    it('renders an unavailable state without a slider', () => {
        render(<FeeSelector tiers={null} value={{ mode: 'normal' }} onChange={() => {}} label="Fee" />);
        expect(screen.getByText('Fee estimate unavailable for this chain.')).toBeInTheDocument();
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    });

    it('removes custom controls and disables all choices when configured', () => {
        render(
            <FeeSelector
                tiers={TIERS}
                value={{ mode: 'normal' }}
                onChange={() => {}}
                allowCustom={false}
                disabled
            />,
        );
        expect(screen.getByRole('slider')).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
        for (const name of ['Slow', 'Normal', 'Fast']) {
            expect(document.querySelector(`button[aria-label="${name}"]`)).toBeDisabled();
        }
    });
});
