// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

vi.mock('../../../packages/core/src/shared/routes/SignerSelectForm.jsx', () => ({
    SignerSelectForm: () => null,
}));

const { AddAccountForm } = await import(
    '../../../packages/core/src/shared/routes/AddAccountForm.jsx');

beforeEach(() => {
    messaging = {
        listAccounts: vi.fn().mockResolvedValue([]),
        createAccount: vi.fn().mockResolvedValue(undefined),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('AddAccountForm navigation', () => {
    it('renders a working Back control', () => {
        const onBack = vi.fn();
        render(
            <AddAccountForm walletId="wallet-1" onBack={onBack} onCreated={() => {}} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('uses the highest derivation index for the default name', async () => {
        messaging.listAccounts.mockResolvedValue([
            { id: 'account-1', index: 0, name: 'Account 1' },
            { id: 'account-3', index: 2, name: 'Account 3' },
        ]);
        render(
            <AddAccountForm walletId="wallet-1" onBack={() => {}} onCreated={() => {}} />,
        );

        await waitFor(() => expect(screen.getByLabelText('Account name').value).toBe('Account 4'));
    });

    it('rejects a case-insensitive duplicate before creating', async () => {
        messaging.listAccounts.mockResolvedValue([
            { id: 'account-1', index: 0, name: 'Savings' },
        ]);
        render(
            <AddAccountForm walletId="wallet-1" onBack={() => {}} onCreated={() => {}} />,
        );
        await waitFor(() => expect(messaging.listAccounts).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText('Account name'), {
            target: { value: '  SAVINGS  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add account' }));

        expect(screen.getByText('An account named "SAVINGS" already exists.')).toBeTruthy();
        expect(messaging.createAccount).not.toHaveBeenCalled();
    });

    it('passes the created account to its completion callback', async () => {
        const account = { id: 'account-2', index: 1, name: 'Spending' };
        const onCreated = vi.fn();
        messaging.createAccount.mockResolvedValue({ account, addresses: [] });
        render(
            <AddAccountForm walletId="wallet-1" onBack={() => {}} onCreated={onCreated} />,
        );
        fireEvent.change(screen.getByLabelText('Account name'), {
            target: { value: '  Spending  ' },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Add account' }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledWith(account));
        expect(messaging.createAccount).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            name: 'Spending',
            signerId: undefined,
        });
    });

    it('locks navigation and editing while creation is pending', async () => {
        let resolveCreate;
        messaging.createAccount.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
        render(
            <AddAccountForm walletId="wallet-1" onBack={() => {}} onCreated={() => {}} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Add account' }));

        await waitFor(() => expect(screen.getByLabelText('Account name').disabled).toBe(true));
        expect(screen.getByRole('button', { name: 'Back' }).disabled).toBe(true);
        expect(screen.getByRole('button', { name: 'Add account' }).disabled).toBe(true);
        resolveCreate({ account: { id: 'account-2' } });
    });

    it('shows a create failure and unlocks the form for retry', async () => {
        messaging.createAccount.mockRejectedValue(new Error('Signer unavailable'));
        render(
            <AddAccountForm walletId="wallet-1" onBack={() => {}} onCreated={() => {}} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Add account' }));

        expect(await screen.findByText('Signer unavailable')).toBeTruthy();
        expect(screen.getByLabelText('Account name').disabled).toBe(false);
        expect(screen.getByRole('button', { name: 'Back' }).disabled).toBe(false);
    });
});
