// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FeeSelector } from '../../../packages/core/src/ui/FeeSelector.jsx';

const TIERS = {
    unit: 'sat/vB',
    low: { rate: '1 sat/vB', rateValue: 1, coinAmount: '0.00000100', etaMinutes: 30, vsize: 100 },
    normal: { rate: '2 sat/vB', rateValue: 2, coinAmount: '0.00000200', etaMinutes: 10, vsize: 100 },
    fast: { rate: '3 sat/vB', rateValue: 3, coinAmount: '0.00000300', etaMinutes: 2, vsize: 100 },
};

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
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Custom fee rate (sat/vB)' }), {
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
        const amount = screen.getByRole('spinbutton', { name: 'Network fee amount (BTC)' });
        expect(amount).toHaveValue(0.000002);
        fireEvent.change(amount, { target: { value: '0.000005' } });
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
        for (const name of ['Low', 'Normal', 'Fast']) {
            expect(document.querySelector(`button[aria-label="${name}"]`)).toBeDisabled();
        }
    });
});
