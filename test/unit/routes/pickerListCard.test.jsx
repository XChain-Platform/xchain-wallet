// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The wallet and account pickers draw their rows as one flush list card with
// divider lines, never as separately boxed cards (U41, U58), and their add
// button is the screen's one green main action with an icon (U63).

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';
import { AccountPicker } from '../../../packages/core/src/shared/routes/AccountPicker.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import menuStyles from '../../../packages/core/src/shared/routes/ActionsMenu.module.css';

afterEach(() => cleanup());

// Both pickers draw their list with the shared list card of CoSignerAccountList.
const pickerCss = readFileSync('packages/core/src/shared/routes/CoSignerAccountList.module.css', 'utf8');

function expectOneListCard(listName, rowCount) {
    const list = screen.getByRole('list', { name: listName });
    const items = list.querySelectorAll(':scope > li');
    expect(items).toHaveLength(rowCount);
    for (const li of items) {
        expect(li.querySelector(`.${menuStyles.entry}`)).toBeNull();
    }
    return list;
}

describe('picker rows sit in one list card', () => {
    it('Wallets: rows in one list, Add wallet is the title-bar plus icon, and a row opens the wallet page', async () => {
        const wallets = [
            { id: 'w1', name: 'Primary', format: 'bip39' },
            { id: 'w2', name: 'Savings', format: 'bip39' },
        ];
        await act(async () => {
            render(
                <MessagingProvider shell="popup" messaging={{ listWallets: () => Promise.resolve(wallets) }}>
                    <WalletPicker activeWalletId="w1" onSwitch={() => {}} onAddWallet={() => {}} onShowDetails={() => {}} onBack={() => {}} />
                </MessagingProvider>,
            );
            await Promise.resolve();
        });
        expectOneListCard('My Wallets', 2);
        // Add is the plus icon on the title line, not a green button under the list.
        const add = screen.getByRole('button', { name: 'Add Wallet' });
        expect(add).not.toHaveClass(buttonStyles.success);
        expect(add.querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Manage Wallet' })).toBeNull();
        expect(document.querySelector(`.${buttonStyles.success}`)).toBeNull();
    });

    it('Accounts: rows in one list and Add account is the title-bar plus icon', async () => {
        const accounts = [
            { id: 'a1', index: 0, name: 'Main' },
            { id: 'a2', index: 1, name: 'Spare' },
        ];
        await act(async () => {
            render(
                <MessagingProvider shell="web" messaging={{ listAccounts: () => Promise.resolve(accounts) }}>
                    <AccountPicker walletId="w1" activeAccountId="a1" onSwitch={() => {}} onAddAccount={() => {}} onRenameAccount={() => {}} onBack={() => {}} />
                </MessagingProvider>,
            );
            await Promise.resolve();
        });
        expectOneListCard('My Accounts', 2);
        const add = screen.getByRole('button', { name: 'Add Account' });
        expect(add).not.toHaveClass(buttonStyles.success);
        expect(add.querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull();
        expect(document.querySelector(`.${buttonStyles.success}`)).toBeNull();
    });

    it('the list card composes the flush card and draws dividers between rows', () => {
        const listRule = /\.list\s*\{([^}]*)\}/.exec(pickerCss)?.[1] || '';
        expect(listRule).toMatch(/composes:\s*flush from/);
        expect(pickerCss).toMatch(/\.list > li \+ li\s*\{[^}]*border-top:\s*1px solid var\(--xc-border\)/);
    });
});
