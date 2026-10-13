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
    it.each([
        {
            kind: 'send',
            label: /^To$/,
            field: 'toAddress',
            value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            submit: 'sendToken',
        },
        {
            kind: 'issue-token',
            label: /^Ticker$/,
            field: 'ticker',
            value: 'LOCKDRAFT',
            submit: 'issueToken',
        },
        {
            kind: 'dispenser',
            label: /^Give amount/,
            field: 'giveAmount',
            value: '12.5',
            submit: 'dispenserAction',
        },
    ])('saves and offers to restore $kind without submitting', async ({
        kind, label, field, value, submit,
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

        expect(await screen.findByText(/Nothing was submitted\./)).toBeInTheDocument();
        expect(messaging[submit]).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        await waitFor(() => expect(screen.getByLabelText(label)).toHaveValue(value));
        expect(messaging[submit]).not.toHaveBeenCalled();
    });
});
