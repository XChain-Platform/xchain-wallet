// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AmountFieldSection } from '../../../packages/web/src/style-guide/sections/AmountFieldSection.jsx';

vi.mock('@xchain-wallet/core/shared/components/AmountField.jsx', () => ({
    AmountField: ({
        amount,
        fiatAmount = '',
        amountInputMode = 'coin',
        onAmountFieldChange,
        toggleAmountInputMode,
        onMax,
    }) => (
        <div>
            <input
                aria-label="Amount value"
                value={amountInputMode === 'fiat' ? fiatAmount : amount}
                onChange={(event) => onAmountFieldChange(event.target.value)}
            />
            <output aria-label="Canonical amount">{amount}</output>
            {toggleAmountInputMode ? (
                <button type="button" onClick={toggleAmountInputMode}>Toggle unit</button>
            ) : null}
            {onMax ? <button type="button" onClick={onMax}>Max</button> : null}
        </div>
    ),
}));

vi.mock('../../../packages/web/src/style-guide/StyleGuidePage.jsx', () => ({
    Section: ({ children }) => <main>{children}</main>,
    Guidance: () => null,
    Markup: () => null,
    LiveExample: ({ label, children }) => <section aria-label={label}>{children}</section>,
}));

describe('AmountFieldSection', () => {
    it('normalizes coin input, rejects invalid input, and converts both directions', () => {
        render(<AmountFieldSection />);
        const example = screen.getByRole('region', { name: /^Standard \(md\):/ });
        const input = within(example).getByRole('textbox', { name: 'Amount value' });
        const canonical = within(example).getByLabelText('Canonical amount');

        fireEvent.change(input, { target: { value: '1,2.5' } });
        expect(input).toHaveValue('12.5');
        expect(canonical).toHaveTextContent('12.5');

        fireEvent.change(input, { target: { value: 'not-a-number' } });
        expect(input).toHaveValue('12.5');

        fireEvent.click(within(example).getByRole('button', { name: 'Toggle unit' }));
        expect(input).toHaveValue('750000.00');

        fireEvent.change(input, { target: { value: '120,000' } });
        expect(input).toHaveValue('120000');
        expect(canonical).toHaveTextContent('2.00000000');

        fireEvent.click(within(example).getByRole('button', { name: 'Toggle unit' }));
        expect(input).toHaveValue('2.00000000');
    });

    it('keeps the token and hero examples independent and handles Max', () => {
        render(<AmountFieldSection />);
        const token = screen.getByRole('region', { name: /^Token variant/ });
        const hero = screen.getByRole('region', { name: /^Hero \(lg\):/ });
        const tokenInput = within(token).getByRole('textbox', { name: 'Amount value' });
        const heroInput = within(hero).getByRole('textbox', { name: 'Amount value' });

        fireEvent.change(tokenInput, { target: { value: '2,500.5' } });
        expect(tokenInput).toHaveValue('2500.5');
        fireEvent.change(tokenInput, { target: { value: '2.5.0' } });
        expect(tokenInput).toHaveValue('2500.5');

        fireEvent.click(within(hero).getByRole('button', { name: 'Toggle unit' }));
        expect(heroInput).toHaveValue('30000.00');
        fireEvent.click(within(hero).getByRole('button', { name: 'Max' }));
        expect(heroInput).toHaveValue('50');
        expect(tokenInput).toHaveValue('2500.5');
    });
});
