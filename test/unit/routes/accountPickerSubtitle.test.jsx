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

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act as domAct } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AccountPicker } from '../../../packages/core/src/shared/routes/AccountPicker.jsx';

afterEach(() => cleanup());

async function mountWith(accounts) {
    const messaging = { listAccounts: () => Promise.resolve(accounts) };
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AccountPicker
                    walletId="w1"
                    activeAccountId={null}
                    onSwitch={() => {}}
                    onAddAccount={() => {}}
                    onBack={() => {}}
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
});
