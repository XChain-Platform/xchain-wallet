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
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AccountPicker } from '../../../packages/core/src/shared/routes/AccountPicker.jsx';

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
                    onBack={overrides.onBack || (() => {})}
                />
            </MessagingProvider>,
        );
        for (let i = 0; i < 16; i += 1) await Promise.resolve();
    });
    return utils;
}

/** The row button whose title contains `name`. */
function rowFor(container, name) {
    return Array.from(container.querySelectorAll('button'))
        .find((b) => (b.textContent || '').includes(name));
}

describe('AccountPicker row subtitle', () => {
    it('shows an unnamed account by its one-based name with no index subtitle', async () => {
        const { container } = await mountWith([{ id: 'a1', index: 0, name: '' }]);
        const row = rowFor(container, 'Account 1');
        expect(row).toBeTruthy();
        expect(row.textContent).not.toMatch(/BIP44|index|Account 0/i);
    });

    it('keeps the numbered name under a custom name', async () => {
        const { container } = await mountWith([{ id: 'a3', index: 2, name: 'Savings' }]);
        const row = rowFor(container, 'Savings');
        expect(row.textContent).toContain('Account 3');
        expect(row.children).toHaveLength(1);
        expect(row.firstElementChild.children).toHaveLength(2);
    });

    it('does not repeat a name that already equals the numbered one', async () => {
        const { container } = await mountWith([{ id: 'a2', index: 1, name: 'Account 2' }]);
        const row = rowFor(container, 'Account 2');
        expect(row.textContent.match(/Account 2/g)).toHaveLength(1);
    });

    it('never mentions the derivation standard anywhere on the list', async () => {
        const { container } = await mountWith([
            { id: 'a1', index: 0, name: '' },
            { id: 'a2', index: 1, name: 'Trading' },
        ]);
        expect(container.textContent).not.toMatch(/BIP44/);
    });

    it('passes the selected record to the rename route', async () => {
        const account = { id: 'a3', index: 2, name: 'Savings' };
        const onRenameAccount = vi.fn();
        await mountWith([account], { onRenameAccount });

        fireEvent.click(document.querySelector('[aria-label="Rename Savings"]'));

        expect(onRenameAccount).toHaveBeenCalledWith(account);
    });

    it('marks the current account and puts add and manage actions in the footer', async () => {
        const account = { id: 'a3', index: 2, name: 'Savings' };
        const onAddAccount = vi.fn();
        const onRenameAccount = vi.fn();
        const { container } = await mountWith([account], {
            activeAccountId: account.id,
            onAddAccount,
            onRenameAccount,
        });

        expect(rowFor(container, account.name)).toHaveAttribute('aria-current', 'true');
        const add = screen.getByRole('button', { name: 'Add account' });
        const manage = screen.getByRole('button', { name: 'Manage account' });
        expect(add.closest('footer')).toBeTruthy();
        expect(manage.closest('footer')).toBeTruthy();

        fireEvent.click(add);
        fireEvent.click(manage);
        expect(onAddAccount).toHaveBeenCalledOnce();
        expect(onRenameAccount).toHaveBeenCalledWith(account);
    });

    it('switches an inactive account and returns through the supplied route', async () => {
        const onSwitch = vi.fn();
        const onBack = vi.fn();
        const { container } = await mountWith(
            [{ id: 'a2', index: 1, name: 'Savings' }],
            { activeAccountId: 'a1', onSwitch, onBack },
        );

        fireEvent.click(rowFor(container, 'Savings'));

        expect(onSwitch).toHaveBeenCalledWith('a2');
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('closes without switching when the current account or Back is selected', async () => {
        const account = { id: 'a2', index: 1, name: 'Savings' };
        const onSwitch = vi.fn();
        const onBack = vi.fn();
        const { container } = await mountWith([account], {
            activeAccountId: account.id,
            onSwitch,
            onBack,
        });

        fireEvent.click(rowFor(container, account.name));
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(onSwitch).not.toHaveBeenCalled();
        expect(onBack).toHaveBeenCalledTimes(2);
    });

    it('reports a list failure without rendering an empty account state', async () => {
        await mountWith([], {
            messaging: { listAccounts: () => Promise.reject(new Error('Accounts unavailable')) },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('Accounts unavailable');
        expect(screen.queryByText('No accounts yet.')).toBeNull();
    });
});
