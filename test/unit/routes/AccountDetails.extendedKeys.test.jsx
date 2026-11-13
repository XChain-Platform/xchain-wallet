// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Account Details' Extended public keys row reaches the export page: the row
// shows for the active account, every shell opens Settings on the
// wallet-xpub page from it, and that page exports the active account's keys.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountDetails } from '../../../packages/core/src/shared/routes/AccountDetails.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

const WALLET = { id: 'wallet-1', name: 'Main', format: 'bip39' };
const ACCOUNTS = [
    { id: 'account-1', name: 'Spending', index: 0 },
    { id: 'account-2', name: 'Savings', index: 1 },
];

function withMessaging(messaging, node) {
    return render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>{node}</MessagingContext.Provider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Account Details Extended public keys', () => {
    it('offers the row on the active account and hands that account to the shell', async () => {
        const onExtendedKeys = vi.fn();
        withMessaging({ listAccounts: vi.fn().mockResolvedValue(ACCOUNTS) }, (
            <AccountDetails
                walletId={WALLET.id}
                accountId="account-2"
                activeAccountId="account-2"
                onBack={() => {}}
                onExtendedKeys={onExtendedKeys}
            />
        ));

        fireEvent.click(await screen.findByRole('button', { name: /Extended public keys/ }));
        expect(onExtendedKeys).toHaveBeenCalledWith(expect.objectContaining({ id: 'account-2' }));
    });

    it('leaves the row off an account that is not active', async () => {
        withMessaging({ listAccounts: vi.fn().mockResolvedValue(ACCOUNTS) }, (
            <AccountDetails
                walletId={WALLET.id}
                accountId="account-1"
                activeAccountId="account-2"
                onBack={() => {}}
                onExtendedKeys={vi.fn()}
            />
        ));

        await screen.findByText('Spending');
        expect(screen.queryByRole('button', { name: /Extended public keys/ })).toBeNull();
    });

    for (const file of [
        'packages/web/src/App.jsx',
        'packages/desktop/renderer/App.jsx',
        'packages/extension/src/popup/App.jsx',
    ]) {
        it(`${file} opens the Settings export page from the row`, () => {
            const source = readFileSync(file, 'utf8');
            const mount = /<AccountDetails\b[\s\S]*?\n\s*\/>/.exec(source)?.[0] || '';
            expect(mount).toMatch(/onExtendedKeys=\{\(\) => \{\s*setSettingsInitialSection\('wallet-xpub'\);\s*setUnlockedView\('settings'\);/);
        });
    }
});

describe('Settings wallet-xpub page', () => {
    it('exports the active account keys behind the wallet password', async () => {
        const xpub = `xpub${'A'.repeat(107)}`;
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({}),
            listConnectedSites: vi.fn().mockResolvedValue([]),
            pairingPayloadRequest: vi.fn().mockResolvedValue({
                xpubs: { 'bitcoin-mainnet': { xpub, path: "m/84'/0'/1'" } },
            }),
        };
        withMessaging(messaging, (
            <Settings
                onBack={() => {}}
                activeWallet={WALLET}
                activeAccount={ACCOUNTS[1]}
                initialSubpageId="wallet-xpub"
                reload={vi.fn()}
            />
        ));

        expect((await screen.findAllByRole('heading', { name: /Extended Public Keys/i })).length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        fireEvent.change(screen.getByLabelText('Confirm wallet password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Export Keys' }));

        await waitFor(() => expect(messaging.pairingPayloadRequest).toHaveBeenCalledWith(expect.objectContaining({
            walletId: WALLET.id,
            accountIndex: 1,
            publicExport: true,
        })));
    });
});
