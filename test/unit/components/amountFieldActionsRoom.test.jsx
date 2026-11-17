// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Operator ruling: a control inside a field is just an icon. Max on every
// amount field is the shared in-field icon action (FieldIconButton through the
// Input's fieldAction slot): no button box, no visible text, an accessible
// name and a tooltip, and the Input reserves its room so typed digits stop
// before it. The Give/Get Quick card's Max is the same icon.

import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';
import { GiveGetQuick } from '../../../packages/core/src/shared/components/giveGet/GiveGetQuick.jsx';
import fieldIconStyles from '../../../packages/core/src/ui/FieldIconButton.module.css';
import inputStyles from '../../../packages/core/src/ui/Input.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const MAX_NAME = 'Use max available amount';

function expectIconOnly(button, name) {
    expect(button).toHaveAttribute('aria-label', name);
    expect(button).toHaveAttribute('title', name);
    expect(button).toHaveClass(fieldIconStyles.button);
    expect(button).not.toHaveClass(buttonStyles.btn);
    expect(button.textContent.trim()).toBe('');
    expect(button.querySelectorAll('svg[data-xc-icon]')).toHaveLength(1);
}

function MaxHost({ max = '1.5' }) {
    const [amount, setAmount] = useState('');
    return (
        <AmountField
            amount={amount}
            tick="XCP"
            onAmountFieldChange={setAmount}
            onMax={() => setAmount(max)}
        />
    );
}

afterEach(cleanup);

describe('amount field Max is an in-field icon', () => {
    it.each(['sm', 'md', 'lg'])('renders an icon-only button with its name and no text at size %s', (size) => {
        render(<AmountField amount="" tick="BTC" size={size} onAmountFieldChange={() => {}} onMax={() => {}} />);
        expectIconOnly(screen.getByRole('button', { name: MAX_NAME }), MAX_NAME);
    });

    it('sits in the field\'s own trailing slot, which reserves the input end room', () => {
        render(<AmountField amount="" tick="BTC" onAmountFieldChange={() => {}} onMax={() => {}} />);
        const input = screen.getByRole('textbox', { name: 'Amount (BTC)' });
        const max = screen.getByRole('button', { name: MAX_NAME });
        expect(max.parentElement).toHaveClass(inputStyles.controlActions);
        expect(input).toHaveClass(inputStyles.inputWithFieldAction);
        expect(screen.queryByText('Max')).toBeNull();
    });

    it('fills the maximum when tapped', () => {
        render(<MaxHost max="1.5" />);
        fireEvent.click(screen.getByRole('button', { name: MAX_NAME }));
        expect(screen.getByRole('textbox', { name: 'Amount (XCP)' })).toHaveValue('1.5');
    });

    it('keeps the disabled icon shown before a token is chosen', () => {
        render(<AmountField amount="" onAmountFieldChange={() => {}} />);
        const max = screen.getByRole('button', { name: MAX_NAME });
        expect(max).toBeDisabled();
        expectIconOnly(max, MAX_NAME);
    });

    it('marks the icon busy while a Max quote is in flight', () => {
        render(<AmountField amount="" tick="BTC" onAmountFieldChange={() => {}} onMax={() => {}} maxBusy />);
        const max = screen.getByRole('button', { name: MAX_NAME });
        expect(max).toBeDisabled();
        expect(max).toHaveAttribute('aria-busy', 'true');
    });
});

describe('Give/Get Quick Max is the same icon', () => {
    it('renders the give side Max as an icon-only button that fills the maximum', () => {
        let filled = 0;
        const give = {
            label: 'You give',
            asset: { chainId: 'bitcoin-mainnet', tick: 'XCP' },
            assetLabel: 'Give asset',
            onOpenAsset: () => {},
            amount: '',
            onAmountChange: () => {},
            amountLabel: 'Give amount',
            balanceText: '10 XCP available',
            onMax: () => { filled += 1; },
        };
        const get = { ...give, label: 'You get', assetLabel: 'Get asset', amountLabel: 'Get amount', onMax: undefined, balanceText: undefined };
        render(<GiveGetQuick give={give} get={get} />);
        const max = screen.getByRole('button', { name: 'Max you give amount' });
        expectIconOnly(max, 'Max you give amount');
        fireEvent.click(max);
        expect(filled).toBe(1);
    });
});
