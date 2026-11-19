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

// The Asset field opens the token picker page; a stub with one button for the
// token under test keeps these cases about the shared field rules.
vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, chainIdFilter, onSelect, onBack }) => (
        <section aria-label={title}>
            <h2>{title}</h2>
            <button type="button" onClick={() => onSelect({ chainId: chainIdFilter, tick: 'PEPE' })}>Pick PEPE</button>
            <button type="button" onClick={onBack}>Back</button>
        </section>
    ),
}));

// The test-send threshold is in the display currency and needs the coin's
// price to convert (operator ruling 2026-11-14); a case that sets one also
// gets a BTC price of $50,000, every other case keeps the no-price form.
const price = vi.hoisted(() => ({ rate: null }));
vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useTickFiatRate: () => price.rate,
}));

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TXID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';

function mount({ thresholdFiat = '0', onViewHistory = undefined } = {}) {
    price.rate = thresholdFiat === '0' ? null : {
        rate: 50000, chainCoin: 'bitcoin', fiatCurrency: 'USD', source: 'oracle', fetchedAt: '2026-11-14T00:00:00.000Z', stale: false,
    };
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
            grace: { testSendThresholdFiat: thresholdFiat },
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

        // Multi's add-recipient form: its own help on To and Amount, the
        // shared AmountField with Max, and icons on every button.
        fireEvent.click(screen.getByRole('tab', { name: 'Multi' }));
        const addRecipient = await screen.findByRole('button', { name: /Add Recipient/ });
        expectIcon(addRecipient);
        fireEvent.click(addRecipient);
        fireEvent.click(screen.getByRole('button', { name: /^Token/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Pick PEPE' }));

        expectTip(
            screen.getByRole('button', { name: 'About To' }),
            'The address that receives this amount.',
        );
        expectTip(
            screen.getByRole('button', { name: 'About Amount (PEPE)' }),
            'How much of the token this recipient receives.',
        );

        const rowMax = screen.getByRole('button', { name: 'Use max available amount' });
        expect(rowMax).not.toBeDisabled();
        fireEvent.click(rowMax);
        expect(screen.getByLabelText(/^Amount \(PEPE\)/, { selector: 'input' })).toHaveValue('1,000');
        expectIcon(screen.getByRole('button', { name: /^Add$/ }));
        expectIcon(screen.getByRole('button', { name: /^Cancel$/ }));

        fireEvent.change(screen.getByLabelText(/^To$/), { target: { value: TO } });
        fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
        const recipientRow = screen.getByRole('button', { name: /^Edit recipient 1:/ });
        expectIcon(recipientRow);
        fireEvent.click(recipientRow);
        expectIcon(screen.getByRole('button', { name: 'Remove Recipient 1' }));
        // Memo is its own optional section, closed on load.
        // It holds only the memo, so the field has no label row or tip (ruling).
        fireEvent.click(screen.getByRole('button', { name: /^Memo/, expanded: false }));
        expect(screen.queryByRole('button', { name: 'About Memo' })).toBeNull();
        expect(screen.getByRole('textbox', { name: 'Memo' })).toBeInTheDocument();
    });

    it('gives both test-send choices icons', async () => {
        mount({ thresholdFiat: '1' });
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '0.02' } });
        await screen.findByText(/First payment to this address/);

        expectIcon(screen.getByRole('button', { name: /Continue with the Full Amount/ }));
        expectIcon(screen.getByRole('button', { name: /Send a Small Test First/ }));
    });

    it('makes Done the only green result action and keeps every result action iconized', async () => {
        const messaging = mount({ onViewHistory: vi.fn() });
        await driveToResult(messaging);

        const done = screen.getByRole('button', { name: 'Done' });
        const saveRecipient = screen.getByRole('button', { name: 'Save Recipient' });
        const viewHistory = screen.getByRole('button', { name: 'View in History' });
        const sendAnother = screen.getByRole('button', { name: 'Send Another' });
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
        const saveContact = screen.getByRole('button', { name: 'Save Contact' });
        expectIcon(cancel);
        expectIcon(saveContact);
        // The inline form's own submit is that form's main action, so it is
        // green; its Cancel is not.
        expect(saveContact).toHaveClass(buttonStyles.success);
        expect(cancel).not.toHaveClass(buttonStyles.success);
    });
});
