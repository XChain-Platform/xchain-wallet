// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A rename screen open in one window while another window renames the same
// wallet or account. The field the user has not touched follows the stored
// name once the records are read again, so Save does not put the other
// window's rename back to the name this screen opened with. A name the user
// typed is their choice and stays as typed.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let messaging;
let stored;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

const { RenameWalletForm } = await import('../../../packages/core/src/shared/routes/RenameWalletForm.jsx');
const { RenameAccountForm } = await import('../../../packages/core/src/shared/routes/RenameAccountForm.jsx');

beforeEach(() => {
    stored = { wallet: 'Primary', account: 'Main' };
    messaging = {
        listWallets: vi.fn(async () => [{ id: 'w1', name: stored.wallet }, { id: 'w2', name: 'Other' }]),
        listAccounts: vi.fn(async () => [{ id: 'a1', walletId: 'w1', index: 0, name: stored.account }]),
        renameWallet: vi.fn(async ({ name }) => { stored.wallet = name; return { wallet: { id: 'w1', name } }; }),
        renameAccount: vi.fn(async ({ name }) => { stored.account = name; return { account: { id: 'a1', name } }; }),
    };
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
});

const FORMS = [
    {
        label: 'wallet',
        field: 'Wallet name',
        list: () => messaging.listWallets,
        write: () => messaging.renameWallet,
        rename: (name) => { stored.wallet = name; },
        node: (props) => <RenameWalletForm walletId="w1" initialName="Primary" {...props} />,
        opened: 'Primary',
    },
    {
        label: 'account',
        field: 'Account name',
        list: () => messaging.listAccounts,
        write: () => messaging.renameAccount,
        rename: (name) => { stored.account = name; },
        node: (props) => <RenameAccountForm accountId="a1" walletId="w1" initialName="Main" {...props} />,
        opened: 'Main',
    },
];

for (const form of FORMS) {
    describe(`the ${form.label} rename screen when another window renames the record`, () => {
        it('shows the stored name in an untouched field once the records are read again', async () => {
            const props = { onBack: vi.fn(), onRenamed: vi.fn(), refreshKey: 0 };
            const view = render(form.node(props));
            await waitFor(() => expect(form.list()).toHaveBeenCalledTimes(1));

            form.rename('Renamed elsewhere');
            view.rerender(form.node({ ...props, refreshKey: 1 }));

            await waitFor(() => expect(screen.getByLabelText(form.field).value).toBe('Renamed elsewhere'));
        });

        it('keeps a name the user typed when the records are read again', async () => {
            const props = { onBack: vi.fn(), onRenamed: vi.fn(), refreshKey: 0 };
            const view = render(form.node(props));
            await waitFor(() => expect(form.list()).toHaveBeenCalledTimes(1));
            fireEvent.change(screen.getByLabelText(form.field), { target: { value: 'Typed here' } });

            form.rename('Renamed elsewhere');
            view.rerender(form.node({ ...props, refreshKey: 1 }));
            await waitFor(() => expect(form.list()).toHaveBeenCalledTimes(2));

            expect(screen.getByLabelText(form.field).value).toBe('Typed here');
        });

        it('saves the stored name, not the opened one, after the records are read again', async () => {
            const props = { onBack: vi.fn(), onRenamed: vi.fn(), refreshKey: 0 };
            const view = render(form.node(props));
            await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());

            form.rename('Renamed elsewhere');
            view.rerender(form.node({ ...props, refreshKey: 1 }));
            await waitFor(() => expect(screen.getByLabelText(form.field).value).toBe('Renamed elsewhere'));
            fireEvent.submit(screen.getByLabelText(form.field).closest('form'));

            await waitFor(() => expect(form.write()).toHaveBeenCalledTimes(1));
            expect(form.write().mock.calls[0][0].name).toBe('Renamed elsewhere');
        });
    });
}
