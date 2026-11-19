// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerProvision } from '../../../packages/core/src/shared/routes/CoSignerProvision.jsx';
import { selectOption } from '../../helpers/selectOption.js';

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ onPick }) => (
        <button type="button" onClick={() => onPick({ id: 'address-1' })}>Pick wallet key</button>
    ),
}));

const AGENT_KEY = `03${'b'.repeat(64)}`;

function mount() {
    const addresses = {
        'bitcoin-mainnet': [{
            id: 'address-1',
            address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            publicKey: `02${'a'.repeat(64)}`,
            derivationPath: "m/84'/0'/0'/0/0",
        }],
    };
    render(
        <MessagingProvider shell="web" messaging={{
            getAddressesByChain: vi.fn().mockResolvedValue(addresses),
        }}>
            <CoSignerProvision walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

function valueFor(label) {
    return screen.getByText(label).nextElementSibling;
}

afterEach(() => cleanup());

// The optional policy groups open from their section headers.
function openSection(title) {
    const toggle = screen.getAllByRole('button')
        .find((button) => button.hasAttribute('aria-expanded') && button.textContent.startsWith(title));
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
}

describe('CoSignerProvision limit summaries', () => {
    it('shows readable limits beside their exact policy JSON', async () => {
        mount();
        await screen.findByLabelText("This wallet's key");
        fireEvent.click(screen.getByRole('button', { name: "Choose this wallet's key" }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick wallet key' }));
        fireEvent.change(screen.getByLabelText('Agent public key'), { target: { value: AGENT_KEY } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Send' }));

        openSection('Per-action amount limits');
        fireEvent.click(screen.getByRole('button', { name: 'Add Limit' }));
        selectOption(screen.getByLabelText('Action'), 'SEND');
        fireEvent.change(screen.getByLabelText('Token'), { target: { value: '*' } });
        fireEvent.change(screen.getByRole('textbox', { name: /^Max amount/ }), { target: { value: '100' } });
        openSection('Rolling limit');
        fireEvent.click(screen.getByRole('switch', { name: 'Enforce a rolling limit' }));
        fireEvent.change(screen.getByLabelText('Window length (hours)'), { target: { value: '12' } });
        fireEvent.change(screen.getByLabelText('Max actions per window'), { target: { value: '4' } });

        openSection('Extra-confirmation threshold');
        fireEvent.click(screen.getByRole('button', { name: 'Add Threshold' }));
        const tokenFields = screen.getAllByLabelText('Token');
        fireEvent.change(tokenFields.at(-1), { target: { value: 'BTC' } });
        fireEvent.change(screen.getByLabelText('Warn above'), { target: { value: '1.5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create Agent Account' }));
        await screen.findByRole('heading', { name: 'Review Agent Account' });

        expect(valueFor('Per-action limits')).toHaveTextContent('Send: up to 100 of any token per action');
        expect(valueFor('Per-action limits').querySelector('code')).toHaveTextContent('{"SEND":{"*":"100"}}');
        expect(valueFor('Rolling limit')).toHaveTextContent('At most 4 actions every 12 hours');
        expect(valueFor('Rolling limit').querySelector('code')).toHaveTextContent('{"hours":12,"maxActions":4}');
        expect(valueFor('Confirmation thresholds')).toHaveTextContent('Flag requests over 1.5 BTC as large');
        expect(valueFor('Confirmation thresholds').querySelector('code')).toHaveTextContent('{"perTick":{"BTC":"1.5"}}');
    });
});
