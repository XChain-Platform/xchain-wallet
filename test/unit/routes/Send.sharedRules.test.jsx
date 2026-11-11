// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TXID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';

function mount({ thresholdSats = 0, onViewHistory = undefined } = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'source',
                address: FROM,
                publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0",
                source: 'hd',
            }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [{ tick: 'PEPE', quantity: '1000', divisibility: 0 }],
        }),
        getAddressUtxos: vi.fn().mockResolvedValue({ utxos: [] }),
        getSettings: vi.fn().mockResolvedValue({
            walletMode: 'full',
            grace: { testSendThresholdSats: thresholdSats },
        }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff',
            encoding: 'P2SH',
            actionString: 'SEND|1|PEPE|1|' + TO,
            version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        sendToken: vi.fn().mockResolvedValue({ txid: TXID }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 0 }),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <Send
                    walletId="wallet-1"
                    onBack={() => {}}
                    onViewHistory={onViewHistory}
                />
            </ToastHost>
        </MessagingProvider>,
    );
    return messaging;
}

function expectIcon(button) {
    expect(button.querySelector('svg'), button.textContent).not.toBeNull();
}

function expectTip(trigger, copy) {
    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent(copy);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
}

async function driveToResult(messaging) {
    fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
    fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    const approve = await screen.findByTestId('confirm-approve');
    await waitFor(() => expect(approve).not.toBeDisabled());
    fireEvent.click(approve);
    await waitFor(() => expect(messaging.sendToken).toHaveBeenCalled());
    await screen.findByRole('heading', { name: 'Broadcast pending' });
}

afterEach(() => cleanup());

describe('Send shared field and action rules', () => {
    it('puts Send-specific help on recipient and amount fields and uses AmountField for added rows', async () => {
        mount();
        await screen.findByLabelText(/^To$/);

        expectTip(
            screen.getByRole('button', { name: 'About To' }),
            'The address or contact that receives this payment. Check the address carefully; a sent payment is final.',
        );
        expectTip(
            screen.getByRole('button', { name: 'About Amount (BTC)' }),
            'How much of the selected asset to send. Max fills the most this From address can send after the network fee.',
        );

        fireEvent.change(screen.getByLabelText(/^Token$/), { target: { value: 'PEPE' } });
        const addRecipient = await screen.findByRole('button', { name: /Add recipient/ });
        expectIcon(addRecipient);
        fireEvent.click(addRecipient);

        const toTips = screen.getAllByRole('button', { name: 'About To' });
        expectTip(toTips[toTips.length - 1], 'The address or contact that receives this payment.');
        expectTip(
            screen.getByRole('button', { name: 'About Recipient 2 amount (PEPE)' }),
            'How much of the selected asset to send.',
        );

        const maxButtons = screen.getAllByRole('button', { name: 'Use max available amount' });
        const rowMax = maxButtons[maxButtons.length - 1];
        expect(rowMax).not.toBeDisabled();
        fireEvent.click(rowMax);
        expect(screen.getByLabelText(/^Recipient 2 amount/)).toHaveValue('1,000');

        expectIcon(screen.getByRole('button', { name: 'Remove recipient 2' }));
        fireEvent.click(screen.getByText('Advanced'));
        expectTip(
            screen.getByRole('button', { name: 'About Memo' }),
            'The memo is stored with this token send on chain and is readable by anyone, up to 250 characters.',
        );
    });

    it('gives both test-send choices icons', async () => {
        mount({ thresholdSats: 1 });
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '0.02' } });
        await screen.findByText(/First payment to this address/);

        expectIcon(screen.getByRole('button', { name: /Continue with the full amount/ }));
        expectIcon(screen.getByRole('button', { name: /Send a small test first/ }));
    });

    it('makes Done the only green result action and keeps every result action iconized', async () => {
        const messaging = mount({ onViewHistory: vi.fn() });
        await driveToResult(messaging);

        const done = screen.getByRole('button', { name: 'Done' });
        const saveRecipient = screen.getByRole('button', { name: 'Save recipient' });
        const viewHistory = screen.getByRole('button', { name: 'View in history' });
        const sendAnother = screen.getByRole('button', { name: 'Send another' });
        [done, saveRecipient, viewHistory, sendAnother].forEach(expectIcon);
        expect(done).toHaveClass(buttonStyles.success);
        expect(screen.getAllByRole('button').filter((button) => button.classList.contains(buttonStyles.success)))
            .toEqual([done]);

        fireEvent.click(saveRecipient);
        expectTip(
            screen.getByRole('button', { name: 'About Contact name' }),
            'The name used for this recipient in your contacts.',
        );
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        const saveContact = screen.getByRole('button', { name: 'Save contact' });
        expectIcon(cancel);
        expectIcon(saveContact);
        expect(saveContact).not.toHaveClass(buttonStyles.success);
    });
});
