// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: amount field grouping.
//
//   [P1] 2026-10-23: A fifth typed digit read the field's own group mark as a
//        decimal point, so 1000000 became 1.0000.

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AmountField } from '../../packages/core/src/shared/components/AmountField.jsx';
import { dropFieldGrouping } from '../../packages/core/src/shared/utils/amountFormat.js';

afterEach(cleanup);

function Harness({ onValue }) {
    const [amount, setAmount] = useState('');
    return (
        <AmountField
            amount={amount}
            tick="BTC"
            onAmountFieldChange={(value) => { setAmount(value); onValue(value); }}
        />
    );
}

function type(input, text) {
    for (const character of text) {
        const next = input.value + character;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, next);
        input.setSelectionRange(next.length, next.length);
        fireEvent(input, new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }));
    }
}

describe('typing into the amount field', () => {
    it('keeps every digit once the display groups them', () => {
        let latest = '';
        render(<Harness onValue={(value) => { latest = value; }} />);
        const input = screen.getByRole('textbox');
        type(input, '1000000');
        expect(latest).toBe('1000000');
        expect(input.value).toBe('1,000,000');
    });

    it('drops only the marks the field drew', () => {
        expect(dropFieldGrouping('1,0000', '1,000', 'en-US')).toBe('10000');
        expect(dropFieldGrouping('2,5', '1', 'en-US')).toBe('2,5');
    });
});

