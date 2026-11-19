// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Pin the account switcher rows: a one-based "Account N" title, no zero-based
// derivation index beside it, and the numbered name as a subtitle only when a
// custom name would otherwise hide it.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act as domAct, fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AccountPicker } from '../../../packages/core/src/shared/routes/AccountPicker.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const pickerCss = readFileSync('packages/core/src/shared/routes/WalletPicker.module.css', 'utf8');

afterEach(() => cleanup());

async function mountWith(accounts, overrides = {}) {
    const messaging = overrides.messaging || { listAccounts: () => Promise.resolve(accounts) };
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AccountPicker
                    walletId="w1"
                    activeAccountId={overrides.activeAccountId ?? null}
                    onSwitch={overrides.onSwitch || (() => {})}
                    onAddAccount={overrides.onAddAccount || (() => {})}
                    onRenameAccount={overrides.onRenameAccount}
                    onShowDetails={overrides.onShowDetails}
                    onBack={overrides.onBack || (() => {})}
                />
            </MessagingProvider>,
        );
        for (let i = 0; i < 16; i += 1) await Promise.resolve();
    });
    return utils;
}

/** The row button whose accessible name starts with `name`. */
function rowFor(name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return screen.getByRole('button', { name: new RegExp(`^${escapedName}`) });
}

describe('AccountPicker row subtitle', () => {
    it('shows an unnamed account by its one-based name with no index subtitle', async () => {
        await mountWith([{ id: 'a1', index: 0, name: '' }]);
        const row = rowFor('Account 1');
        expect(row).toBeTruthy();
        expect(row.textContent).not.toMatch(/BIP44|index|Account 0/i);
    });

    it('keeps the numbered name under a custom name', async () => {
        await mountWith([{ id: 'a3', index: 2, name: 'Savings' }]);
        const row = rowFor('Savings');
        expect(row.textContent).toContain('Account 3');
        expect(row.textContent.match(/Account 3/g)).toHaveLength(1);
        expect(screen.getByText('Savings')).toBeInTheDocument();
    });

    it('does not repeat a name that already equals the numbered one', async () => {
        await mountWith([{ id: 'a2', index: 1, name: 'Account 2' }]);
        const row = rowFor('Account 2');
        expect(row.textContent.match(/Account 2/g)).toHaveLength(1);
    });

    it('never mentions the derivation standard anywhere on the list', async () => {
        const { container } = await mountWith([
            { id: 'a1', index: 0, name: '' },
            { id: 'a2', index: 1, name: 'Trading' },
        ]);
        expect(container.textContent).not.toMatch(/BIP44/);
    });

    // A row opens the account's own page when the shell wires one; renaming
    // lives there, so the row carries no Rename button.
    it('passes the selected record to the account page and offers no row rename button', async () => {
        const account = { id: 'a3', index: 2, name: 'Savings' };
        const onShowDetails = vi.fn();
        const onSwitch = vi.fn();
        await mountWith([account], { onShowDetails, onSwitch });

        expect(screen.queryByRole('button', { name: 'Rename Savings' })).toBeNull();
        fireEvent.click(rowFor('Savings'));

        expect(onShowDetails).toHaveBeenCalledWith(account);
        expect(onSwitch).not.toHaveBeenCalled();
    });

    it('marks the current account and puts Add account on the title line', async () => {
        const account = { id: 'a3', index: 2, name: 'Savings' };
        const onAddAccount = vi.fn();
        await mountWith([account], {
            activeAccountId: account.id,
            onAddAccount,
        });

        expect(rowFor(account.name)).toHaveAttribute('aria-current', 'true');
        const add = screen.getByRole('button', { name: 'Add Account' });
        // The plus sits in the page header; there is no Manage button under the list.
        expect(add.closest('header')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull();
        expect(pickerCss).toMatch(/\.pickerActions button > span:last-child\s*{[^}]*white-space:\s*nowrap/);

        fireEvent.click(add);
        expect(onAddAccount).toHaveBeenCalledOnce();
    });

    it('renders the title-line add affordance as an icon-only kit button', async () => {
        await mountWith(
            [{ id: 'a1', index: 0, name: 'Savings' }],
            {},
        );

        const add = screen.getByRole('button', { name: 'Add Account' });
        expect(add).toHaveClass(buttonStyles.iconOnly);
        expect(add.querySelector('svg[data-xc-icon]')).toBeInTheDocument();
        expect(add.querySelectorAll(':scope > span')).toHaveLength(1);
    });

    // Without an account page wired, a row switches the account; the picker
    // stays open (Back is the title bar's).
    it('switches an inactive account from its row', async () => {
        const onSwitch = vi.fn();
        const onBack = vi.fn();
        await mountWith(
            [{ id: 'a2', index: 1, name: 'Savings' }],
            { activeAccountId: 'a1', onSwitch, onBack },
        );

        fireEvent.click(rowFor('Savings'));

        expect(onSwitch).toHaveBeenCalledWith('a2');
    });

    it('closes without switching when the current account or Back is selected', async () => {
        const account = { id: 'a2', index: 1, name: 'Savings' };
        const onSwitch = vi.fn();
        const onBack = vi.fn();
        await mountWith([account], {
            activeAccountId: account.id,
            onSwitch,
            onBack,
        });

        fireEvent.click(rowFor(account.name));
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(onSwitch).not.toHaveBeenCalled();
        // Only Back leaves; the current account's row does nothing.
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('reports a list failure without rendering an empty account state', async () => {
        await mountWith([], {
            messaging: { listAccounts: () => Promise.reject(new Error('Accounts unavailable')) },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('Accounts unavailable');
        expect(screen.queryByText('No accounts yet.')).toBeNull();
    });
});
