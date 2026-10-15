// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Paste and Max both sit inside the amount field, so both take the compact
// Button size whatever size the field itself is: Max used to follow the field
// to the medium size and read a point larger than the Paste beside it.

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

describe('AmountField in-field actions', () => {
    for (const size of ['sm', 'md', 'lg']) {
        it(`gives Max and Paste the compact size in a ${size} field`, () => {
            const { getByRole } = render(React.createElement(AmountField, {
                amount: '',
                tick: 'XCP',
                label: 'Amount',
                size,
                onMax() {},
                onAmountFieldChange() {},
            }));
            const max = getByRole('button', { name: /use max/i });
            const paste = getByRole('button', { name: /paste/i });
            expect(max.classList.contains(buttonStyles.sm)).toBe(true);
            expect(max.classList.contains(buttonStyles.md)).toBe(false);
            expect(paste.classList.contains(buttonStyles.sm)).toBe(true);
        });
    }
});
