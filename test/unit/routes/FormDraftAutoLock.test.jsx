// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function createMessaging(overrides = {}) {
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
        ...overrides,
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
        const FIRST = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
        const SECOND = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
        // The wallet and the From address hold XCP, so the Asset picker lists
        // it and Multi takes it.
        const xcp = { tick: 'XCP', quantity: '100000000000', divisibility: 8 };
        const messaging = createMessaging({
            getAddressBalances: vi.fn().mockResolvedValue({
                native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                tokens: [xcp],
            }),
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN_ID]: [{
                    address: SOURCE.address,
                    balances: {
                        native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                        tokens: [xcp],
                    },
                }],
            }),
        });
        const first = mountForm('send', messaging);
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: FIRST } });
        fireEvent.click(screen.getByRole('button', { name: /^Asset:/ }));
        fireEvent.click(await screen.findByRole('button', { name: /^Select XCP(?: on |$)/ }));
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '2.5' } });
        await screen.findByText(/XCP available/);
        // Single's complete recipient opens as Multi's first row.
        fireEvent.click(screen.getByRole('tab', { name: 'Multi' }));
        await waitFor(() => expect(screen.getAllByTestId('send-multi-row')).toHaveLength(1));
        fireEvent.click(screen.getByRole('button', { name: /Add Recipient/ }));
        fireEvent.change(screen.getByLabelText(/^To$/), { target: { value: SECOND } });
        fireEvent.change(screen.getByLabelText(/^Amount/, { selector: 'input' }), { target: { value: '1.25' } });
        fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));

        const storageKey = `xc:formdraft:send:${WALLET_ID}`;
        await waitFor(() => {
            const saved = JSON.parse(localStorage.getItem(storageKey));
            expect(saved.values).toMatchObject({
                sendMode: 'multi',
                multiRecipients: [
                    { to: FIRST, tick: 'XCP', amount: '2.5' },
                    { to: SECOND, tick: 'XCP', amount: '1.25' },
                ],
                toAddress: FIRST,
                tick: 'XCP',
                amount: '2.5',
                perRecipientToken: true,
                extraLegs: [{ to: SECOND, tick: 'XCP', amount: '1.25' }],
            });
            expect(saved.values).not.toHaveProperty('password');
            expect(saved.values).not.toHaveProperty('gatedScanPassword');
        });

        first.unmount();
        mountForm('send', messaging);
        fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: 'Multi' })).toHaveAttribute('aria-selected', 'true');
            expect(screen.getAllByTestId('send-multi-row').map((row) => row.querySelector('button').getAttribute('aria-label')))
                .toEqual([
                    `Edit recipient 1: 2.5 XCP to ${FIRST}`,
                    `Edit recipient 2: 1.25 XCP to ${SECOND}`,
                ]);
        });
        expect(messaging.sendToken).not.toHaveBeenCalled();
    });

    it('opens a draft saved before the tabs, with its extra rows, as the Multi list', async () => {
        const FIRST = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
        const SECOND = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
        localStorage.setItem(`xc:formdraft:send:${WALLET_ID}`, JSON.stringify({
            savedAt: Date.now(),
            values: {
                chainId: CHAIN_ID,
                toAddress: FIRST,
                tick: 'XCP',
                amount: '2.5',
                memo: '',
                perRecipientToken: false,
                extraLegs: [{ id: 'leg-1', to: SECOND, amount: '1.25', tick: '' }],
            },
        }));
        mountForm('send', createMessaging());
        fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
        await waitFor(() => {
            expect(screen.getByRole('tab', { name: 'Multi' })).toHaveAttribute('aria-selected', 'true');
            expect(screen.getAllByTestId('send-multi-row')).toHaveLength(2);
        });
        // The row without its own token took the first row's.
        expect(screen.getByRole('button', { name: `Edit recipient 2: 1.25 XCP to ${SECOND}` })).toBeInTheDocument();
    });

    it('checks a restored half-typed row at Send instead of composing it', async () => {
        const FIRST = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
        const SECOND = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
        localStorage.setItem(`xc:formdraft:send:${WALLET_ID}`, JSON.stringify({
            savedAt: Date.now(),
            values: {
                chainId: CHAIN_ID,
                toAddress: FIRST,
                tick: 'XCP',
                amount: '2.5',
                memo: '',
                extraLegs: [{ id: 'leg-1', to: SECOND, amount: '', tick: '' }],
            },
        }));
        const messaging = createMessaging({
            getAddressBalances: vi.fn().mockResolvedValue({
                native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                tokens: [{ tick: 'XCP', quantity: '100000000000', divisibility: 8 }],
            }),
        });
        mountForm('send', messaging);
        fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
        await waitFor(() => expect(screen.getAllByTestId('send-multi-row')).toHaveLength(2));
        await waitFor(() => {
            fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
            expect(screen.getAllByText('Recipient 2: Enter an amount.').length).toBeGreaterThan(0);
        });
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(messaging.sendToken).not.toHaveBeenCalled();
    });

    it('does not offer a default-only Send record as an unfinished payment', async () => {
        localStorage.setItem(`xc:formdraft:send:${WALLET_ID}`, JSON.stringify({
            savedAt: Date.now(),
            values: {
                chainId: CHAIN_ID,
                toAddress: '',
                tick: 'BTC',
                amount: '',
                memo: '',
            },
        }));

        mountForm('send', createMessaging());

        expect(await screen.findByLabelText(/^To$/)).toBeInTheDocument();
        expect(screen.queryByText(/Your unfinished payment was saved as a draft/)).toBeNull();
        await waitFor(() => {
            expect(localStorage.getItem(`xc:formdraft:send:${WALLET_ID}`)).toBeNull();
        });
    });

    it.each([
        { kind: 'send', label: /^To$/, value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', notice: /Nothing was sent\./ },
        { kind: 'issue-token', label: /^Ticker$/, value: 'LOCKDRAFT', notice: /Nothing was submitted\./ },
        { kind: 'dispenser', label: /^Give amount/, value: '12.5', notice: /Nothing was submitted\./ },
    ])('leaves no $kind draft after Discard and leave', async ({ kind, label, value, notice }) => {
        const messaging = createMessaging();
        const first = mountForm(kind, messaging);
        fireEvent.change(await screen.findByLabelText(label), { target: { value } });

        const storageKey = `xc:formdraft:${kind}:${WALLET_ID}`;
        await waitFor(() => expect(localStorage.getItem(storageKey)).not.toBeNull());

        fireEvent.click(screen.getAllByRole('button', { name: /^Back/ })[0]);
        fireEvent.click(await screen.findByRole('button', { name: 'Discard and leave' }));

        // The confirm re-renders the form before the host navigates away;
        // that render must not write the discarded values back.
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Discard and leave' })).toBeNull());
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(localStorage.getItem(storageKey)).toBeNull();

        first.unmount();
        mountForm(kind, messaging);
        expect(await screen.findByLabelText(label)).toBeInTheDocument();
        expect(screen.queryByText(notice)).toBeNull();
        // A fresh form may autosave its own defaults; the discarded value
        // must not come back.
        expect(localStorage.getItem(storageKey) || '').not.toContain(value);
    });

    it('keeps an unrestored Send draft when the form is left clean', async () => {
        const storageKey = `xc:formdraft:send:${WALLET_ID}`;
        const stored = JSON.stringify({
            savedAt: Date.now(),
            values: { chainId: CHAIN_ID, toAddress: '', tick: 'BTC', amount: '0.5', memo: '' },
        });
        localStorage.setItem(storageKey, stored);

        mountForm('send', createMessaging());
        expect(await screen.findByText(/Nothing was sent\./)).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole('button', { name: /^Back/ })[0]);

        expect(screen.queryByRole('button', { name: 'Discard and leave' })).toBeNull();
        expect(localStorage.getItem(storageKey)).toBe(stored);
    });

    it.each([
        { kind: 'send', label: /^To$/, values: { chainId: CHAIN_ID, amount: '0.5' } },
        { kind: 'issue-token', label: /^Ticker$/, values: { chainId: CHAIN_ID, ticker: 'OLDTOKEN' } },
        { kind: 'dispenser', label: /^Give amount/, values: { chainId: CHAIN_ID, giveAmount: '1' } },
    ])('discards a saved $kind draft from the X and stops offering Restore', async ({ kind, label, values }) => {
        const storageKey = `xc:formdraft:${kind}:${WALLET_ID}`;
        localStorage.setItem(storageKey, JSON.stringify({
            savedAt: Date.now(),
            network: 'mainnet',
            values,
        }));

        const first = mountForm(kind, createMessaging());
        const notice = await screen.findByTestId('draft-notice');
        const form = notice.closest('form');
        const sections = form.querySelector('[data-form-sections]');
        expect(notice.compareDocumentPosition(sections) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        fireEvent.click(within(notice).getByRole('button', { name: 'Discard draft' }));
        await waitFor(() => expect(screen.queryByTestId('draft-notice')).toBeNull());
        expect(localStorage.getItem(storageKey)).toBeNull();

        first.unmount();
        mountForm(kind, createMessaging());
        expect(await screen.findByLabelText(label)).toBeInTheDocument();
        expect(screen.queryByTestId('draft-notice')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
        expect(localStorage.getItem(storageKey)).toBeNull();
    });

    it.each([
        {
            kind: 'send',
            label: /^To$/,
            field: 'toAddress',
            stored: { chainId: CHAIN_ID, amount: '0.5' },
            value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        },
        {
            kind: 'issue-token',
            label: /^Ticker$/,
            field: 'ticker',
            stored: { chainId: CHAIN_ID, ticker: 'OLDTOKEN' },
            value: 'NEWTOKEN',
        },
        {
            kind: 'dispenser',
            label: /^Give amount/,
            field: 'giveAmount',
            stored: { chainId: CHAIN_ID, giveAmount: '1' },
            value: '12.5',
        },
    ])('keeps autosaving $kind when Restore finds no draft', async ({
        kind, label, field, stored, value,
    }) => {
        const storageKey = `xc:formdraft:${kind}:${WALLET_ID}`;
        localStorage.setItem(storageKey, JSON.stringify({
            savedAt: Date.now(),
            network: 'mainnet',
            values: stored,
        }));
        mountForm(kind, createMessaging());

        const restore = await screen.findByRole('button', { name: 'Restore' });
        localStorage.removeItem(storageKey);
        fireEvent.click(restore);
        fireEvent.change(await screen.findByLabelText(label), { target: { value } });

        await waitFor(() => {
            const saved = JSON.parse(localStorage.getItem(storageKey));
            expect(saved.values[field]).toBe(value);
        });
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
