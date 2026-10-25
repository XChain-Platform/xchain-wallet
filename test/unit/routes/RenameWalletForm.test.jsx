// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

const { RenameWalletForm } = await import(
    '../../../packages/core/src/shared/routes/RenameWalletForm.jsx');
const { RenameAccountForm } = await import(
    '../../../packages/core/src/shared/routes/RenameAccountForm.jsx');

function mount(overrides = {}) {
    const props = {
        walletId: 'wallet-1',
        initialName: 'Primary wallet',
        onBack: vi.fn(),
        onRenamed: vi.fn(),
        ...overrides,
    };
    const view = render(<RenameWalletForm {...props} />);
    return { ...view, props };
}

beforeEach(() => {
    messaging = {
        listWallets: vi.fn().mockResolvedValue([
            { id: 'wallet-1', name: 'Primary wallet' },
            { id: 'wallet-2', name: 'Savings' },
        ]),
        listAccounts: vi.fn().mockResolvedValue([]),
        renameWallet: vi.fn().mockResolvedValue({
            wallet: { id: 'wallet-1', name: 'Spending' },
        }),
        renameAccount: vi.fn().mockResolvedValue({
            account: { id: 'account-1', name: 'Spending' },
        }),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('RenameWalletForm name validation', () => {
    it('prefills the input with the initial name', () => {
        mount({ initialName: 'Savings' });

        expect(screen.getByLabelText('Wallet name').value).toBe('Savings');
    });

    it('disables Save for an empty or whitespace-only name', () => {
        mount({ initialName: '' });
        const input = screen.getByLabelText('Wallet name');
        const save = screen.getByRole('button', { name: 'Save' });

        expect(save.disabled).toBe(true);
        fireEvent.change(input, { target: { value: '   ' } });
        expect(save.disabled).toBe(true);
    });

    it('rejects a blank name submitted through the form', () => {
        mount({ initialName: '   ' });
        const input = screen.getByLabelText('Wallet name');

        fireEvent.submit(input.closest('form'));

        expect(screen.getByText('Wallet name is required.')).toBeTruthy();
        expect(messaging.renameWallet).not.toHaveBeenCalled();
    });

    it('refuses another wallet name case-insensitively', async () => {
        mount();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false));
        fireEvent.change(screen.getByLabelText('Wallet name'), {
            target: { value: ' savings ' },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(screen.getByText('A wallet named "savings" already exists.')).toBeTruthy();
        expect(messaging.renameWallet).not.toHaveBeenCalled();
    });

    it('accepts 64 Unicode characters after trimming', async () => {
        mount({ initialName: '' });
        await waitFor(() => expect(messaging.listWallets).toHaveBeenCalledOnce());
        const input = screen.getByLabelText('Wallet name');
        fireEvent.change(input, { target: { value: `  ${'🚀'.repeat(64)}  ` } });

        expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(messaging.renameWallet).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            name: '🚀'.repeat(64),
        }));
    });

    it('shows a plain error for names over 64 Unicode characters', async () => {
        mount({ initialName: '' });
        await waitFor(() => expect(messaging.listWallets).toHaveBeenCalledOnce());
        const input = screen.getByLabelText('Wallet name');

        fireEvent.change(input, { target: { value: '🚀'.repeat(65) } });

        expect(input.value).toBe('🚀'.repeat(65));
        expect(screen.getByText('Wallet name must be 64 characters or fewer.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
        expect(messaging.renameWallet).not.toHaveBeenCalled();
    });
});

describe('RenameAccountForm name characters', () => {
    it('preserves trimmed emoji and right-to-left text', async () => {
        render(
            <RenameAccountForm
                accountId="account-1"
                walletId="wallet-1"
                initialName="  חסכון 🚀  "
                onBack={vi.fn()}
                onRenamed={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(messaging.renameAccount).toHaveBeenCalledWith({
            accountId: 'account-1',
            name: 'חסכון 🚀',
        }));
    });

    it('shows the same plain error over 64 Unicode characters', () => {
        render(
            <RenameAccountForm
                accountId="account-1"
                walletId="wallet-1"
                initialName=""
                onBack={vi.fn()}
                onRenamed={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText('Account name'), {
            target: { value: '🚀'.repeat(65) },
        });

        expect(screen.getByText('Account name must be 64 characters or fewer.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
        expect(messaging.renameAccount).not.toHaveBeenCalled();
    });
});

describe.each([
    'packages/web/src/App.jsx',
    'packages/desktop/renderer/App.jsx',
])('%s rename labels', (path) => {
    const source = readFileSync(path, 'utf8');

    it('updates wallet header state and refreshes account header state', () => {
        expect(source).toContain('useAccountList(activeWalletId, accountRenameTarget)');
        expect(source).toMatch(/onRenamed=\{\(wallet\) => \{[\s\S]*?setWalletList/);
    });
});

describe('RenameWalletForm submission', () => {
    it('updates the stored lock-screen name when the active wallet is renamed', async () => {
        localStorage.setItem('xc:activeWallet', JSON.stringify({ id: 'wallet-1', name: 'Primary wallet' }));
        mount({ initialName: 'Spending' });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false));

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(messaging.renameWallet).toHaveBeenCalled());
        expect(JSON.parse(localStorage.getItem('xc:activeWallet'))).toEqual({ id: 'wallet-1', name: 'Spending' });
    });

    it('leaves the stored lock-screen name alone when another wallet is renamed', async () => {
        localStorage.setItem('xc:activeWallet', JSON.stringify({ id: 'wallet-2', name: 'Savings' }));
        mount({ initialName: 'Spending' });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false));

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(messaging.renameWallet).toHaveBeenCalled());
        expect(JSON.parse(localStorage.getItem('xc:activeWallet'))).toEqual({ id: 'wallet-2', name: 'Savings' });
    });


    it('trims a valid name, renames the wallet, and reports completion', async () => {
        const { props } = mount({ initialName: '  Spending  ' });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false));

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(props.onRenamed).toHaveBeenCalledWith({
            id: 'wallet-1',
            name: 'Spending',
        }));
        expect(messaging.renameWallet).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            name: 'Spending',
        });
        expect(messaging.renameWallet.mock.invocationCallOrder[0])
            .toBeLessThan(props.onRenamed.mock.invocationCallOrder[0]);
    });

    it('reports when the shell has no rename method', async () => {
        messaging = { listWallets: vi.fn().mockResolvedValue([]) };
        const { props } = mount();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false));

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText(
            'messaging.renameWallet is not available in this shell.',
        )).toBeTruthy();
        expect(props.onRenamed).not.toHaveBeenCalled();
    });

    it('locks editing and navigation while the rename is in flight', async () => {
        let finishRename;
        messaging.renameWallet.mockImplementation(() => new Promise((resolve) => {
            finishRename = resolve;
        }));
        const { props } = mount();
        const input = screen.getByLabelText('Wallet name');
        const save = screen.getByRole('button', { name: 'Save' });
        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        await waitFor(() => expect(save.disabled).toBe(false));

        fireEvent.click(save);

        expect(input.disabled).toBe(true);
        expect(save.disabled).toBe(true);
        expect(save.getAttribute('aria-busy')).toBe('true');
        expect(back.disabled).toBe(true);
        fireEvent.click(save);
        expect(messaging.renameWallet).toHaveBeenCalledOnce();
        expect(props.onBack).not.toHaveBeenCalled();

        finishRename();
        await waitFor(() => expect(props.onRenamed).toHaveBeenCalledOnce());
    });
});

describe('RenameWalletForm submission failures', () => {
    it.each([
        [new Error('Rename refused'), 'Rename refused'],
        [{}, 'Failed to rename wallet.'],
    ])('shows the failure and re-enables Save', async (failure, message) => {
        messaging.renameWallet.mockRejectedValue(failure);
        mount();
        const save = screen.getByRole('button', { name: 'Save' });
        await waitFor(() => expect(save.disabled).toBe(false));

        fireEvent.click(save);

        expect(await screen.findByText(message)).toBeTruthy();
        expect(save.disabled).toBe(false);
    });

    it('clears a shown error when the user types', async () => {
        messaging.renameWallet.mockRejectedValue(new Error('Rename refused'));
        mount();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Rename refused')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Wallet name'), {
            target: { value: 'Recovered name' },
        });

        expect(screen.queryByText('Rename refused')).toBeNull();
    });
});
