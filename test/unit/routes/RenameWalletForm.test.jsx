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
        expect(screen.getByText('7 / 64')).toBeTruthy();
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

    it('limits names to 64 characters and updates the counter', async () => {
        mount({ initialName: '' });
        await waitFor(() => expect(messaging.listWallets).toHaveBeenCalledOnce());
        const input = screen.getByLabelText('Wallet name');
        fireEvent.change(input, { target: { value: 'x'.repeat(64) } });

        expect(input.maxLength).toBe(64);
        expect(screen.getByText('64 / 64')).toBeTruthy();

        fireEvent.change(input, { target: { value: 'x'.repeat(65) } });
        expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
        expect(messaging.renameWallet).not.toHaveBeenCalled();
    });
});

describe('RenameAccountForm name length', () => {
    it('uses the same 64-character limit and counter as wallet renames', () => {
        render(
            <RenameAccountForm
                accountId="account-1"
                walletId="wallet-1"
                initialName="Savings"
                onBack={vi.fn()}
                onRenamed={vi.fn()}
            />,
        );

        expect(screen.getByLabelText('Account name').maxLength).toBe(64);
        expect(screen.getByText('7 / 64')).toBeTruthy();
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
