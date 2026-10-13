// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const WALLET_ID = 'auto-lock-wallet';
const SOURCE = {
    id: 'source-1',
    address: 'bc1qsourcesourcesourcesourcesourcesources',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function createMessaging() {
    const target = {
        getSettings: vi.fn().mockResolvedValue({
            walletMode: 'full',
            activeNetwork: 'mainnet',
            privacy: { formDraftTtlMs: 86_400_000 },
            grace: { testSendThresholdSats: 0 },
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN_ID]: SOURCE }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN_ID]: [] }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked', unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        sendToken: vi.fn(),
        issueToken: vi.fn(),
        dispenserAction: vi.fn(),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            object[property] = stub;
            return stub;
        },
    });
}

function mountForm(kind, messaging) {
    let form;
    if (kind === 'send') {
        form = <Send walletId={WALLET_ID} onBack={() => {}} />;
    } else if (kind === 'issue-token') {
        form = <IssueTokenForm walletId={WALLET_ID} onBack={() => {}} />;
    } else {
        form = (
            <DispenserForm
                walletId={WALLET_ID}
                initialChainId={CHAIN_ID}
                initialTick="DRAFT"
                onBack={() => {}}
            />
        );
    }
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>{form}</ToastHost>
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('form drafts across auto-lock', () => {
    it('restores every non-secret field of a multi-recipient Send', async () => {
        const messaging = createMessaging();
        const first = mountForm('send', messaging);
        fireEvent.change(await screen.findByLabelText(/^To$/), {
            target: { value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' },
        });
        fireEvent.change(screen.getByLabelText(/^Token$/), { target: { value: 'XCP' } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '2.5' } });
        fireEvent.click(await screen.findByRole('button', { name: /Add recipient/i }));
        fireEvent.change(screen.getByLabelText(/Recipient 2 address/i), {
            target: { value: 'bc1qsecondrecipient0000000000000000000000000' },
        });
        fireEvent.change(screen.getByLabelText(/Recipient 2 amount/i), {
            target: { value: '1.25' },
        });
        fireEvent.click(screen.getByRole('switch', { name: /different token/i }));

        const storageKey = `xc:formdraft:send:${WALLET_ID}`;
        await waitFor(() => {
            const saved = JSON.parse(localStorage.getItem(storageKey));
            expect(saved.values).toMatchObject({
                toAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                tick: 'XCP',
                amount: '2.5',
                perRecipientToken: true,
                extraLegs: [{
                    to: 'bc1qsecondrecipient0000000000000000000000000',
                    amount: '1.25',
                }],
            });
            expect(saved.values).not.toHaveProperty('password');
            expect(saved.values).not.toHaveProperty('gatedScanPassword');
        });

        first.unmount();
        mountForm('send', messaging);
        fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));

        await waitFor(() => {
            expect(document.getElementById('send-destination')).toHaveValue(
                'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            );
            expect(screen.getByLabelText(/^Token$/)).toHaveValue('XCP');
            expect(document.getElementById('send-amount')).toHaveValue('2.5');
            expect(screen.getByLabelText(/Recipient 2 address/i)).toHaveValue(
                'bc1qsecondrecipient0000000000000000000000000',
            );
            expect(screen.getByLabelText(/Recipient 2 amount/i)).toHaveValue('1.25');
            expect(screen.getByRole('switch', { name: /different token/i })).toBeChecked();
        });
        expect(messaging.sendToken).not.toHaveBeenCalled();
    });

    it.each([
        {
            kind: 'send',
            label: /^To$/,
            field: 'toAddress',
            value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            submit: 'sendToken',
            notice: /Nothing was sent\./,
        },
        {
            kind: 'issue-token',
            label: /^Ticker$/,
            field: 'ticker',
            value: 'LOCKDRAFT',
            submit: 'issueToken',
            notice: /Nothing was submitted\./,
        },
        {
            kind: 'dispenser',
            label: /^Give amount/,
            field: 'giveAmount',
            value: '12.5',
            submit: 'dispenserAction',
            notice: /Nothing was submitted\./,
        },
    ])('saves and offers to restore $kind without submitting', async ({
        kind, label, field, value, submit, notice,
    }) => {
        const messaging = createMessaging();
        const first = mountForm(kind, messaging);
        fireEvent.change(await screen.findByLabelText(label), { target: { value } });

        const storageKey = `xc:formdraft:${kind}:${WALLET_ID}`;
        await waitFor(() => {
            const saved = JSON.parse(localStorage.getItem(storageKey));
            expect(saved.values[field]).toBe(value);
        });

        // Auto-lock replaces the unlocked route tree. Unlock mounts the same
        // route again, where the saved draft must require a deliberate choice.
        first.unmount();
        mountForm(kind, messaging);

        expect(await screen.findByText(notice)).toBeInTheDocument();
        expect(messaging[submit]).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        await waitFor(() => expect(screen.getByLabelText(label)).toHaveValue(value));
        expect(messaging[submit]).not.toHaveBeenCalled();
    });
});
