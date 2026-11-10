// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every amount field carries its in-field Max action, so the field reads the
// same on every form. A form with no max to offer shows the action disabled
// rather than dropping it, and the input keeps the end room the action takes
// so typed digits stop before it.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';

function mount(props) {
    return render(React.createElement(AmountField, {
        amount: '',
        label: 'Amount',
        onAmountFieldChange() {},
        ...props,
    }));
}

const maxButton = (getByRole) => getByRole('button', { name: 'Use max available amount' });

describe('AmountField Max action', () => {
    it('shows a disabled Max when the form offers no max', () => {
        const { getByRole } = mount({});
        expect(maxButton(getByRole)).toBeDisabled();
    });

    it('enables Max and calls onMax once on click', () => {
        const onMax = vi.fn();
        const { getByRole } = mount({ onMax, tick: 'XCP' });
        const button = maxButton(getByRole);
        expect(button).toBeEnabled();
        fireEvent.click(button);
        expect(onMax).toHaveBeenCalledTimes(1);
    });

    it('holds Max when maxDisabled is set', () => {
        const onMax = vi.fn();
        const { getByRole } = mount({ onMax, maxDisabled: true, tick: 'XCP' });
        const button = maxButton(getByRole);
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(onMax).not.toHaveBeenCalled();
    });

    it('keeps the input end room for Max when the form offers no max', () => {
        const { container } = mount({ tick: 'XCP' });
        const input = container.querySelector('input');
        expect(input.getAttribute('style') || '').toContain('--amount-end-room');
    });
});
