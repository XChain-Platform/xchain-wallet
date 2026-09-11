// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The WIF-import payload withholds the wallet password when the session
// signer can supply the master key. The host reaches for the pooled key only
// when `!req.password` (createBackgroundHost, `wallet.importWif`), so a
// password on the request routes the import down the password path instead.
//
// The conditional that withholds it sat under a second literal `password`
// key, which won by object-literal order, so the request always carried the
// credential. It was inert only because the field renders solely while the
// signer is not ready; one state change away from sending a credential the
// code believed it withheld.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';

const REGTEST_SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: { 'bitcoin-regtest': { strategy: 'normal' } },
};

const ACCOUNT = { id: 'account-a', index: 0, walletId: 'wallet-a' };

afterEach(() => cleanup());

function messagingFor(ready) {
    return {
        listWallets: vi.fn().mockResolvedValue([
            { id: 'wallet-a', name: 'Main Wallet', format: 'bip39' },
        ]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue(REGTEST_SETTINGS),
        signerReady: vi.fn().mockResolvedValue({ ready }),
        importWifRequest: vi.fn(async () => ({
            address: { address: 'mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp' },
        })),
    };
}

async function openImportForm(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddressList walletId="wallet-a" accountId={ACCOUNT.id} onBack={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Add or import address/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Import address/i }));
    await screen.findByLabelText(/WIF private key/i);
}

async function submitWif() {
    fireEvent.change(screen.getByLabelText(/WIF private key/i), {
        target: { value: 'cSV3exampleRegtestWifValue' },
    });
    const pw = screen.queryByLabelText(/Wallet password/i);
    if (pw) fireEvent.change(pw, { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^Import$/ }));
}

describe('WIF import withholds the password when the session signer is ready', () => {
    it('omits `password` entirely once the pooled signer can supply the key', async () => {
        const messaging = messagingFor(true);
        await openImportForm(messaging);
        // The field is not rendered in this state, so the guard has to come
        // from the payload rather than from an empty string.
        await waitFor(() => expect(screen.queryByLabelText(/Wallet password/i)).toBeNull());

        await submitWif();
        await waitFor(() => expect(messaging.importWifRequest).toHaveBeenCalledTimes(1));
        const payload = messaging.importWifRequest.mock.calls[0][0];
        expect(Object.hasOwn(payload, 'password')).toBe(false);
    });

    it('sends `password` while the signer is not ready', async () => {
        const messaging = messagingFor(false);
        await openImportForm(messaging);
        await screen.findByLabelText(/Wallet password/i);

        await submitWif();
        await waitFor(() => expect(messaging.importWifRequest).toHaveBeenCalledTimes(1));
        expect(messaging.importWifRequest.mock.calls[0][0].password).toBe('correct horse');
    });
});
