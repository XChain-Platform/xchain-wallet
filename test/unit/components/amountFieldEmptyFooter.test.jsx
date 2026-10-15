// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An amount field with no unit toggle and no balance line (Mint, Dividend,
// Airdrop, Destroy) still rendered its footer row: two empty spans under a
// top margin, which on a phone stacked with a row gap. The space under that
// field then read 8px wider than every other field gap in the form. The
// footer now renders only when it carries the toggle or the balance text.

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';
import styles from '../../../packages/core/src/shared/components/AmountField.module.css';

function mount(props) {
    return render(React.createElement(AmountField, {
        amount: '',
        tick: 'XCP',
        label: 'Amount',
        onAmountFieldChange() {},
        ...props,
    }));
}

const footer = (container) => container.querySelector(`.${styles.amountFooter}`);

describe('AmountField footer', () => {
    it('renders no footer when there is nothing to show', () => {
        const { container } = mount({});
        expect(footer(container)).toBeNull();
    });

    it('keeps the footer and its live region when balance text is given', () => {
        const { container, getByRole } = mount({ balanceText: '12 XCP available' });
        expect(footer(container)).not.toBeNull();
        expect(getByRole('status').textContent).toBe('12 XCP available');
    });

    it('keeps the footer for the unit toggle', () => {
        const { container, getByRole } = mount({
            amount: '1',
            tick: 'BTC',
            fiatRate: { rate: 67000, fiatCurrency: 'USD' },
            toggleAmountInputMode() {},
            amountInputMode: 'coin',
        });
        expect(footer(container)).not.toBeNull();
        expect(getByRole('button', { name: /switch input to usd/i })).toBeTruthy();
    });
});
