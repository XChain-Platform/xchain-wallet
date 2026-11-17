// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Wallet Details and Account Details draw their actions as the shared
// ActionList (G101) under the shared Actions | Details toggle (G102):
// Actions is the first tab and chosen, each row runs its own handler, and
// Wallet Details' Remove wallet (or Exit demo) row carries the danger tone.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AccountDetails } from '../../../packages/core/src/shared/routes/AccountDetails.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';

afterEach(() => cleanup());

const WALLET = { id: 'wallet-1', name: 'Main', format: 'counterwallet-legacy', origin: 'created' };
const ACCOUNTS = [
    { id: 'account-1', name: 'Spending', index: 0 },
    { id: 'account-2', name: 'Savings', index: 1 },
];

// Account Details adds its Addresses tab between the two (G131).
function expectActionsFirstAndChosen(names = ['Actions', 'Details']) {
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(names);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    for (const tab of tabs.slice(1)) expect(tab).toHaveAttribute('aria-selected', 'false');
}

describe('Wallet Details actions (G101, G102)', () => {
    function mount(props = {}) {
        const handlers = {
            onMakeActive: vi.fn(),
            onRename: vi.fn(),
            onShowRecoveryPhrase: vi.fn(),
            onExportBackup: vi.fn(),
            onMigrateToBip39: vi.fn(),
            onRemoveWallet: vi.fn(),
        };
        render(
            <MessagingProvider
                shell="web"
                messaging={{
                    listWallets: vi.fn(async () => [WALLET]),
                    listAccounts: vi.fn(async () => []),
                }}
            >
                <WalletDetails walletId={WALLET.id} activeWalletId="other" onBack={() => {}} {...handlers} {...props} />
            </MessagingProvider>,
        );
        return handlers;
    }

    it('opens on Actions, holding one ActionList with the danger row last', async () => {
        mount();
        const list = await screen.findByRole('list', { name: 'Wallet actions' });
        expectActionsFirstAndChosen();
        expect(within(screen.getByRole('tabpanel')).getByRole('list', { name: 'Wallet actions' })).toBe(list);
        const rows = within(list).getAllByRole('listitem').map((item) => item.querySelector('button'));
        expect(rows.map((row) => row.querySelector('[class*="titleText"]').textContent)).toEqual([
            'Set as active wallet',
            'Edit wallet',
            'Show recovery phrase',
            'Export Backup',
            'Upgrade recovery phrase',
            'Remove wallet',
        ]);
        for (const row of rows) {
            expect(row.querySelector('[aria-hidden="true"][data-tone] svg')).toBeTruthy();
        }
        expect(rows.at(-1)).toHaveAttribute('data-tone', 'danger');
        expect(rows.slice(0, -1).every((row) => row.getAttribute('data-tone') === 'default')).toBe(true);
        expect(rows[3].textContent).toContain('Save an encrypted backup file of this wallet');
    });

    it('runs each row\'s own handler with the wallet on screen', async () => {
        const handlers = mount();
        await screen.findByRole('list', { name: 'Wallet actions' });
        const press = (name) => fireEvent.click(screen.getByRole('button', { name }));
        press(/^Edit wallet/);
        press(/^Show recovery phrase/);
        press(/^Export Backup/);
        press(/^Upgrade recovery phrase/);
        press(/^Remove wallet/);
        press(/^Set as active wallet/);
        expect(handlers.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: WALLET.id }));
        expect(handlers.onShowRecoveryPhrase).toHaveBeenCalledWith(expect.objectContaining({ id: WALLET.id }));
        expect(handlers.onExportBackup).toHaveBeenCalledWith(expect.objectContaining({ id: WALLET.id }));
        expect(handlers.onMigrateToBip39).toHaveBeenCalledTimes(1);
        expect(handlers.onRemoveWallet).toHaveBeenCalledWith(expect.objectContaining({ id: WALLET.id }));
        expect(handlers.onMakeActive).toHaveBeenCalledWith(expect.objectContaining({ id: WALLET.id }));
        // Made active, the row leaves the list.
        expect(screen.queryByRole('button', { name: /^Set as active wallet/ })).toBeNull();
    });

    it('shows the facts under Details', async () => {
        mount();
        await screen.findByRole('list', { name: 'Wallet actions' });
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(screen.queryByRole('list', { name: 'Wallet actions' })).toBeNull();
        expect(screen.getByText('FreeWallet (Counterwallet legacy)')).toBeInTheDocument();
    });
});

describe('Account Details actions (G101, G102)', () => {
    function mount(props) {
        render(
            <MessagingProvider shell="web" messaging={{ listAccounts: vi.fn().mockResolvedValue(ACCOUNTS) }}>
                <AccountDetails walletId="wallet-1" onBack={() => {}} {...props} />
            </MessagingProvider>,
        );
    }

    it('opens on Actions, holding one ActionList whose rows run their handlers', async () => {
        const onMakeActive = vi.fn();
        const onRename = vi.fn();
        mount({ accountId: 'account-2', activeAccountId: 'account-1', onMakeActive, onRename, onExtendedKeys: vi.fn() });
        const list = await screen.findByRole('list', { name: 'Account actions' });
        expectActionsFirstAndChosen(['Actions', 'Addresses', 'Details']);
        const rows = within(list).getAllByRole('listitem').map((item) => item.querySelector('button'));
        expect(rows.map((row) => row.querySelector('[class*="titleText"]').textContent)).toEqual([
            'Set as active account',
            'Edit account',
        ]);
        for (const row of rows) {
            expect(row).toHaveAttribute('data-tone', 'default');
            expect(row.querySelector('[aria-hidden="true"][data-tone] svg')).toBeTruthy();
        }
        fireEvent.click(screen.getByRole('button', { name: /^Edit account/ }));
        expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'account-2' }));
        fireEvent.click(screen.getByRole('button', { name: /^Set as active account/ }));
        expect(onMakeActive).toHaveBeenCalledWith(expect.objectContaining({ id: 'account-2' }));
        // Now active: Set as active leaves, Extended public keys arrives.
        expect(screen.queryByRole('button', { name: /^Set as active account/ })).toBeNull();
        expect(screen.getByRole('button', { name: /^Extended public keys/ })).toBeInTheDocument();
    });

    it('shows the account facts under Details', async () => {
        mount({ accountId: 'account-1', activeAccountId: 'account-1' });
        await screen.findByRole('list', { name: 'Account actions' });
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(screen.queryByRole('list', { name: 'Account actions' })).toBeNull();
        expect(screen.getByText('Account number')).toBeInTheDocument();
    });
});
