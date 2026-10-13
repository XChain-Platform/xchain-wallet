// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { FeeSelector } from '../../../packages/core/src/ui/FeeSelector.jsx';

const estimate = (rateValue, coinAmount, etaMinutes) => ({
    rateValue,
    rate: `${rateValue} sat/vB`,
    coinAmount,
    etaMinutes,
    unit: 'sat/vB',
    vsize: 250,
});

const tiers = {
    low: estimate(1, '0.00000250', 60),
    normal: estimate(6, '0.00001500', 30),
    fast: estimate(12, '0.00003000', 10),
    unit: 'sat/vB',
    minimumRate: 1,
};

const fallbackTiers = {
    ...tiers,
    low: { ...tiers.low, source: 'static-placeholder' },
    normal: { ...tiers.normal, source: 'static-placeholder' },
    fast: { ...tiers.fast, source: 'static-placeholder' },
};

afterEach(cleanup);

function ControlledSelector({ initialValue = { mode: 'normal' }, ...props }) {
    const [value, setValue] = useState(initialValue);
    return <FeeSelector tiers={tiers} value={value} onChange={setValue} {...props} />;
}

describe('FeeSelector', () => {
    it('selects every tier and supports the range keyboard contract', () => {
        render(<ControlledSelector initialValue={{ mode: 'low' }} />);
        const slider = screen.getByRole('slider', { name: 'Network fee' });

        fireEvent.keyDown(slider, { key: 'ArrowRight' });
        expect(slider.value).toBe('1');
        expect(slider.getAttribute('aria-valuetext')).toMatch(/^Normal:/);

        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        expect(slider.value).toBe('2');
        expect(slider.getAttribute('aria-valuetext')).toMatch(/^Fast:/);

        fireEvent.keyDown(slider, { key: 'End' });
        expect(slider.value).toBe('3');
        expect(screen.getByLabelText('Custom fee rate (sat/vB)').value).toBe('6');

        fireEvent.keyDown(slider, { key: 'Home' });
        expect(slider.value).toBe('0');
        expect(slider.getAttribute('aria-valuetext')).toMatch(/^Slow:/);
    });

    it('labels presets by speed and shows each expected confirmation time', () => {
        render(<ControlledSelector />);

        const ticks = [...document.querySelectorAll('button[aria-label]')]
            .filter((button) => ['Slow', 'Normal', 'Fast'].includes(button.getAttribute('aria-label')));
        expect(ticks.map((button) => button.textContent)).toEqual([
            'Slow~60 min',
            'Normal~30 min',
            'Fast~10 min',
        ]);
    });

    it('keeps empty input editable and rejects empty and zero rates visibly', () => {
        const onChange = vi.fn();
        render(
            <FeeSelector
                tiers={tiers}
                value={{ mode: 'custom', customRate: 6 }}
                onChange={onChange}
            />,
        );
        const input = screen.getByLabelText('Custom fee rate (sat/vB)');

        fireEvent.change(input, { target: { value: '' } });
        fireEvent.blur(input);
        expect(input.value).toBe('');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByRole('alert').textContent).toMatch(/Enter a custom fee rate/);
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 0 });

        fireEvent.change(input, { target: { value: '0' } });
        expect(screen.getByRole('alert').textContent).toMatch(/greater than zero/);
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 0 });
    });

    it('warns outside the safe rate range without changing the chosen rate', () => {
        const onChange = vi.fn();
        render(
            <FeeSelector
                tiers={tiers}
                value={{ mode: 'custom', customRate: 6 }}
                onChange={onChange}
            />,
        );
        const input = screen.getByLabelText('Custom fee rate (sat/vB)');

        fireEvent.change(input, { target: { value: '0.5' } });
        expect(input.getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByRole('alert').textContent).toMatch(/below the network minimum of 1 sat\/vB/);
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 0.5 });

        fireEvent.change(input, { target: { value: '2.75' } });
        expect(input.getAttribute('aria-invalid')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 2.75 });

        fireEvent.change(input, { target: { value: '120' } });
        expect(screen.queryByRole('alert')).toBeNull();

        fireEvent.change(input, { target: { value: '121' } });
        expect(input.getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByRole('alert').textContent).toMatch(/more than 10 times the Fast rate/);
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 121 });
    });

    it('names the chain-specific unit in the network minimum warning', () => {
        const onChange = vi.fn();
        render(
            <FeeSelector
                tiers={{ ...tiers, unit: 'DOGE/kB', minimumRate: 1 }}
                value={{ mode: 'custom', customRate: 0.5 }}
                onChange={onChange}
            />,
        );

        expect(screen.getByLabelText('Custom fee rate (DOGE/kB)').value).toBe('0.5');
        expect(screen.getByText('DOGE/kB')).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toMatch(/1 DOGE\/kB/);
    });

    it('renders fiat previews for preset and custom estimates', () => {
        const formatFiat = vi.fn((amount) => `about ${amount} USD`);
        const { rerender } = render(
            <FeeSelector
                tiers={tiers}
                value={{ mode: 'normal' }}
                onChange={() => {}}
                formatFiat={formatFiat}
            />,
        );
        expect(screen.getByText('about 0.00001500 USD')).toBeTruthy();

        rerender(
            <FeeSelector
                tiers={tiers}
                value={{ mode: 'custom', customRate: 2.5 }}
                onChange={() => {}}
                customEstimate={estimate(2.5, '0.00000625')}
                formatFiat={formatFiat}
            />,
        );
        expect(screen.getByText('about 0.00000625 USD')).toBeTruthy();
    });

    it('shows the fallback note while keeping Custom editable', () => {
        render(
            <ControlledSelector
                tiers={fallbackTiers}
                initialValue={{ mode: 'normal' }}
            />,
        );

        expect(screen.getByText(/Using safe default rates/)).toBeTruthy();
        fireEvent.keyDown(screen.getByRole('slider', { name: 'Network fee' }), { key: 'End' });

        const customInput = screen.getByLabelText('Custom fee rate (sat/vB)');
        expect(customInput.disabled).toBe(false);
        fireEvent.change(customInput, { target: { value: '7.5' } });
        expect(customInput.value).toBe('7.5');
        expect(screen.getByText(/Custom fees remain available/)).toBeTruthy();
    });
});
