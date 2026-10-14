// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FeeSelector } from '../../../packages/core/src/ui/FeeSelector.jsx';

const TIERS = {
    unit: 'sat/vB',
    low: { rateValue: 1, coinAmount: '0.00000100', etaMinutes: 30 },
    normal: { rateValue: 2, coinAmount: '0.00000200', etaMinutes: 10 },
    fast: { rateValue: 3, coinAmount: '0.00000300', etaMinutes: 2 },
};

describe('<FeeSelector> edge branches', () => {
    it('suppresses unavailable and fallback notices when requested', () => {
        const { rerender } = render(
            <FeeSelector
                tiers={null}
                value={{ mode: 'normal' }}
                onChange={() => {}}
                showEstimateNotice={false}
                label="Fee"
            />,
        );
        expect(screen.queryByText(/Fee estimate unavailable/)).toBeNull();
        expect(screen.queryByRole('slider')).toBeNull();

        rerender(
            <FeeSelector
                tiers={{
                    ...TIERS,
                    normal: { ...TIERS.normal, source: 'static-placeholder' },
                }}
                value={{ mode: 'normal' }}
                onChange={() => {}}
                showEstimateNotice={false}
            />,
        );
        expect(screen.queryByText(/Using safe default rates/)).toBeNull();
        expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('falls back through available tiers when Custom has no saved rate', () => {
        const onChange = vi.fn();
        render(
            <FeeSelector
                tiers={{ unit: 'sat/vB', low: TIERS.low }}
                value={{ mode: 'normal' }}
                onChange={onChange}
            />,
        );

        fireEvent.click(document.querySelector('button[aria-label="Custom"]'));
        expect(onChange).toHaveBeenCalledWith({ mode: 'custom', customRate: 1 });
    });

    it('uses the tier fee ratio when exact-fee editing has no vsize', () => {
        const onChange = vi.fn();
        render(
            <FeeSelector tiers={TIERS} value={{ mode: 'normal' }} onChange={onChange} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Edit exact fee amount' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Network fee amount' }), {
            target: { value: '0.00000500' },
        });

        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 5 });
    });

    it('converts per-kilobyte exact fees with the estimate vsize', () => {
        const onChange = vi.fn();
        const perKbTiers = {
            unit: 'DOGE/kB',
            low: { rateValue: 1000, coinAmount: '0.001', vsize: 100 },
            normal: { rateValue: 2000, coinAmount: '0.002', vsize: 100 },
            fast: { rateValue: 3000, coinAmount: '0.003', vsize: 100 },
        };
        render(
            <FeeSelector
                tiers={perKbTiers}
                value={{ mode: 'normal' }}
                onChange={onChange}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Edit exact fee amount' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Network fee amount' }), {
            target: { value: '0.5' },
        });

        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 5 });
    });
});
