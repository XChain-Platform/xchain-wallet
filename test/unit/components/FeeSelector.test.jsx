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
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';

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

function ControlledSelector({ initialValue = { mode: 'normal' }, onPick, ...props }) {
    const [value, setValue] = useState(initialValue);
    const onChange = (next) => {
        onPick?.(next);
        setValue(next);
    };
    return <FeeSelector tiers={tiers} value={value} onChange={onChange} {...props} />;
}

// The one custom fee editor (G113) is the fee amount; the fixtures price a
// rate at 250 vB, so these fees stand for the rates the cases name.
const feeAt = (rate) => String(Number((rate * 250 / 1e8).toFixed(8)));
const feeEditor = () => screen.getByRole('textbox', { name: /^Network fee amount/ });
const openFeeEditor = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit exact fee amount' }));
    return feeEditor();
};

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
        expect(slider.getAttribute('aria-valuetext')).toBe('Custom: 6 sat/vB');
        // Custom opens the fee amount's own editor and no rate box.
        expect(feeEditor()).toBeTruthy();
        expect(screen.queryByLabelText(/Custom fee rate/)).toBeNull();

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

    it('keeps an emptied fee editor open and rejects empty and zero fees visibly', () => {
        const onChange = vi.fn();
        render(<ControlledSelector initialValue={{ mode: 'custom', customRate: 6 }} onPick={onChange} />);
        const input = openFeeEditor();

        fireEvent.change(input, { target: { value: feeAt(6) } });
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.blur(input);
        // A refused entry holds the editor open beside its message.
        expect(feeEditor().value).toBe('');
        expect(feeEditor().getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByRole('alert').textContent).toMatch(/Enter a custom network fee/);
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 0 });

        fireEvent.change(feeEditor(), { target: { value: '0' } });
        expect(screen.getByRole('alert').textContent).toMatch(/greater than zero/);
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 0 });
    });

    it('warns outside the safe rate range without changing the chosen rate', () => {
        const onChange = vi.fn();
        render(<ControlledSelector initialValue={{ mode: 'custom', customRate: 6 }} onPick={onChange} />);
        const input = openFeeEditor();

        fireEvent.change(input, { target: { value: feeAt(0.5) } });
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByRole('alert').textContent).toBe('Enter a rate of at least 1 sat/vB.');
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 0.5 });

        fireEvent.change(input, { target: { value: feeAt(2.8) } });
        expect(input.getAttribute('aria-invalid')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 2.8 });

        fireEvent.change(input, { target: { value: feeAt(120) } });
        expect(screen.queryByRole('alert')).toBeNull();

        fireEvent.change(input, { target: { value: feeAt(121) } });
        expect(input.getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByRole('alert').textContent).toMatch(/more than 10 times the Fast rate/);
        expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom', customRate: 121 });
    });

    it('refuses a custom rate above the chain maximum and blocks the form submit', () => {
        const onSubmit = vi.fn((event) => event.preventDefault());
        const bounded = { ...tiers, maximumRate: 1000 };
        const { container } = render(
            <form onSubmit={onSubmit}>
                <FeeSelector
                    tiers={bounded}
                    value={{ mode: 'custom', customRate: 99999999 }}
                    onChange={() => {}}
                />
                <button type="submit">Review</button>
            </form>,
        );
        expect(screen.getByRole('alert').textContent).toBe('Enter a rate no higher than 1,000 sat/vB.');
        const input = openFeeEditor();
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.validationMessage).toBe('Enter a rate no higher than 1,000 sat/vB.');
        container.querySelector('form').requestSubmit();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('lets an in-range rate submit and keeps the over-10x warning below the maximum', () => {
        const onSubmit = vi.fn((event) => event.preventDefault());
        const bounded = { ...tiers, maximumRate: 1000 };
        const { container } = render(
            <form onSubmit={onSubmit}>
                <FeeSelector
                    tiers={bounded}
                    value={{ mode: 'custom', customRate: 500 }}
                    onChange={() => {}}
                />
                <button type="submit">Review</button>
            </form>,
        );
        const input = openFeeEditor();
        expect(input.validationMessage).toBe('');
        expect(screen.getByRole('alert').textContent).toMatch(/more than 10 times the Fast rate/);
        container.querySelector('form').requestSubmit();
        expect(onSubmit).toHaveBeenCalledTimes(1);
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

        expect(screen.queryByLabelText(/Custom fee rate/)).toBeNull();
        expect(screen.getByRole('slider', { name: 'Network fee' }).getAttribute('aria-valuetext'))
            .toBe('Custom: 0.5 DOGE/kB');
        expect(screen.getByRole('alert').textContent).toMatch(/1 DOGE\/kB/);
    });

    it('renders the supplied fiat formatter for preset and custom estimates', () => {
        const fiat = { formatNativeFee: vi.fn((amount) => `~$${amount}`) };
        const { rerender } = render(
            <FeeSelector
                tiers={tiers}
                value={{ mode: 'normal' }}
                onChange={() => {}}
                fiat={fiat}
            />,
        );
        expect(screen.getByText('~$0.00001500')).toBeTruthy();

        rerender(
            <FeeSelector
                tiers={tiers}
                value={{ mode: 'custom', customRate: 2.5 }}
                onChange={() => {}}
                customEstimate={estimate(2.5, '0.00000625')}
                fiat={fiat}
            />,
        );
        expect(screen.getByText('~$0.00000625')).toBeTruthy();
    });

    it('keeps fallback tiers editable without reporting their source', () => {
        render(
            <ControlledSelector
                tiers={fallbackTiers}
                initialValue={{ mode: 'normal' }}
            />,
        );

        expect(screen.queryByText(/Using safe default rates/)).toBeNull();
        fireEvent.keyDown(screen.getByRole('slider', { name: 'Network fee' }), { key: 'End' });

        const customInput = feeEditor();
        expect(customInput.disabled).toBe(false);
        fireEvent.change(customInput, { target: { value: feeAt(7.5) } });
        expect(customInput.value).toBe(feeAt(7.5));
        expect(screen.queryByText(/Custom fees remain available/)).toBeNull();
    });

    it('adds no fallback notice to the enclosing form', () => {
        const { container } = render(
            <FormPage actions={<button type="submit">Go</button>}>
                <ControlledSelector tiers={fallbackTiers} initialValue={{ mode: 'normal' }} />
            </FormPage>,
        );

        const form = container.querySelector('form');
        expect(screen.queryByText(/Using safe default rates/)).toBeNull();
        expect(form).toContainElement(screen.getByRole('slider', { name: 'Network fee' }));
    });
});
