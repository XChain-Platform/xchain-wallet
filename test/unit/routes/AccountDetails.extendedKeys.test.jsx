// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Account Details' Extended public keys row reaches the keys page: the row
// shows for the active account, every shell opens Settings on the
// wallet-xpub page from it, and that page shows the active account's keys at
// once, with copy and QR, no intro step and no password (ruling 2026-11-15).

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountDetails } from '../../../packages/core/src/shared/routes/AccountDetails.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

const { qrToDataURL } = vi.hoisted(() => ({
    qrToDataURL: vi.fn(async () => 'data:image/png;base64,cHVia2V5'),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: qrToDataURL },
}));

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

    it('leaves the row off a hardware wallet account, whose keys stay on the device', async () => {
        const listWallets = vi.fn().mockResolvedValue([{ id: WALLET.id, name: 'My Trezor', format: 'hardware' }]);
        withMessaging({ listAccounts: vi.fn().mockResolvedValue(ACCOUNTS), listWallets }, (
            <AccountDetails
                walletId={WALLET.id}
                accountId="account-2"
                activeAccountId="account-2"
                onBack={() => {}}
                onExtendedKeys={vi.fn()}
            />
        ));

        await screen.findByText('Savings');
        await waitFor(() => expect(listWallets).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByRole('button', { name: /Extended public keys/ })).toBeNull());
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
    const XPUB = `xpub${'A'.repeat(107)}`;
    const TPUB = `tpub${'B'.repeat(107)}`;

    beforeEach(() => {
        qrToDataURL.mockClear();
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn(async () => {}) },
        });
    });

    function settingsMessaging(pairingPayloadRequest) {
        return {
            getSettings: vi.fn().mockResolvedValue({}),
            listConnectedSites: vi.fn().mockResolvedValue([]),
            pairingPayloadRequest,
        };
    }

    function openKeysPage(messaging, wallet = WALLET) {
        return withMessaging(messaging, (
            <Settings
                onBack={() => {}}
                activeWallet={wallet}
                activeAccount={ACCOUNTS[1]}
                initialSubpageId="wallet-xpub"
                reload={vi.fn()}
            />
        ));
    }

    it('shows the active account keys at once, with no intro step and no password', async () => {
        const messaging = settingsMessaging(vi.fn().mockResolvedValue({
            payload: {
                keys: [
                    { chainId: 'bitcoin-mainnet', addressType: 'p2wpkh', path: "m/84'/0'/1'", xpub: XPUB },
                    { chainId: 'bitcoin-testnet', addressType: 'p2wpkh', path: "m/84'/1'/1'", xpub: TPUB },
                ],
            },
        }));
        openKeysPage(messaging);

        expect(await screen.findByText(XPUB)).toBeInTheDocument();
        expect(screen.getByText(TPUB)).toBeInTheDocument();
        expect(screen.getByText(/reveal every address and balance of this account\. They can't move funds/i)).toBeInTheDocument();
        expect(await screen.findByAltText('QR code for Bitcoin extended public key')).toBeInTheDocument();
        expect(qrToDataURL).toHaveBeenCalledWith(XPUB, expect.any(Object));

        // No intro row, no Export button, no password field anywhere.
        expect(screen.queryByRole('button', { name: 'Export…' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Export Keys' })).toBeNull();
        expect(screen.queryByLabelText('Confirm wallet password')).toBeNull();
        expect(document.querySelector('input[type="password"]')).toBeNull();

        // The request asks for this account's public keys and carries no password.
        expect(messaging.pairingPayloadRequest).toHaveBeenCalledTimes(1);
        const request = messaging.pairingPayloadRequest.mock.calls[0][0];
        expect(request).toEqual({ walletId: WALLET.id, accountIndex: 1, publicExport: true });
        expect('password' in request).toBe(false);

        fireEvent.click(screen.getAllByRole('button', { name: 'Copy Extended Public Key' })[0]);
        await waitFor(() => expect(globalThis.navigator.clipboard.writeText).toHaveBeenCalledWith(XPUB));
    });

    it('shows only public extended keys when the host returns anything else', async () => {
        const privateKey = `xprv${'C'.repeat(107)}`;
        const messaging = settingsMessaging(vi.fn().mockResolvedValue({
            payload: { keys: [{ chainId: 'bitcoin-mainnet', path: "m/84'/0'/1'", xpub: privateKey }] },
        }));
        openKeysPage(messaging);

        expect(await screen.findByText('This wallet returned no valid extended public keys.')).toBeInTheDocument();
        expect(screen.queryByText(privateKey)).toBeNull();
        expect(screen.queryByRole('img', { name: /extended public key/i })).toBeNull();
    });

    it('says why when the session cannot read the keys, without asking for a password', async () => {
        const messaging = settingsMessaging(vi.fn().mockRejectedValue(new Error('Unlock this wallet again to show its extended public keys.')));
        openKeysPage(messaging);

        expect(await screen.findByText('Unlock this wallet again to show its extended public keys.')).toBeInTheDocument();
        expect(screen.queryByLabelText('Confirm wallet password')).toBeNull();
    });

    it('says a hardware wallet keeps its keys on the device and reads nothing', async () => {
        const messaging = settingsMessaging(vi.fn());
        openKeysPage(messaging, { id: 'wallet-hw', name: 'My Trezor', format: 'hardware' });

        expect(await screen.findByText("This wallet's keys stay on its hardware device.")).toBeInTheDocument();
        expect(messaging.pairingPayloadRequest).not.toHaveBeenCalled();
    });

    it('says a private-key-only wallet has no extended keys and reads nothing', async () => {
        const messaging = settingsMessaging(vi.fn());
        openKeysPage(messaging, { id: 'wallet-wif', name: 'Imported key', format: 'wif-only' });

        expect(await screen.findByText('Not available for a private-key-only wallet.')).toBeInTheDocument();
        expect(messaging.pairingPayloadRequest).not.toHaveBeenCalled();
    });

    it('shows the keys of a paired watcher wallet the same way', async () => {
        const messaging = settingsMessaging(vi.fn().mockResolvedValue({
            payload: { keys: [{ chainId: 'bitcoin-mainnet', addressType: 'p2wpkh', path: "m/84'/0'/1'", xpub: XPUB }] },
        }));
        openKeysPage(messaging, { ...WALLET, walletMode: 'watcher' });

        expect(await screen.findByText(XPUB)).toBeInTheDocument();
        expect(screen.queryByLabelText('Confirm wallet password')).toBeNull();
    });
});
