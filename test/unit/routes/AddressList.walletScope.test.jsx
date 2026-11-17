// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Settings > Wallets > My Addresses: the row's count and the list it opens
// agree, and the list shows every account's addresses under a heading per
// account. The default scope keeps listing the active account only.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';

const WALLET = { id: 'wallet-a', name: 'Main Wallet', format: 'bip39' };
const CHAIN = 'bitcoin-regtest';

function accountsFor(n) {
    return Array.from({ length: n }, (_, i) => ({ id: `acct-${i + 1}`, index: i, walletId: WALLET.id, name: `Account ${i + 1}` }));
}

function addressesFor(accounts) {
    const out = [];
    accounts.forEach((a, ai) => {
        for (let k = 0; k < 3; k += 1) {
            out.push({
                id: `addr-${ai}-${k}`,
                address: `bcrt1qacct${ai}addr${k}${'0'.repeat(30)}`,
                label: `A${ai + 1} address ${k + 1}`,
                source: 'hd',
                addressType: 'p2wpkh',
                role: 'receive',
                accountId: a.id,
            });
        }
    });
    return out;
}

function fakeMessaging(accountCount) {
    const accounts = accountsFor(accountCount);
    const all = addressesFor(accounts);
    const getAddressesByChain = vi.fn(async (_walletId, accountId) => ({
        [CHAIN]: all.filter((a) => !accountId || a.accountId === accountId),
    }));
    return {
        accounts,
        all,
        getAddressesByChain,
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue(accounts),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest' }),
        listMultisigReceiveAddresses: vi.fn().mockResolvedValue([]),
        listConnectedSites: vi.fn().mockResolvedValue([]),
    };
}

function mountList(messaging, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddressList walletId={WALLET.id} accountId="acct-1" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('AddressList wallet scope', () => {
    it('lists both accounts under headings, active account first', async () => {
        const m = fakeMessaging(2);
        // The second account is active, so its group must come first.
        mountList(m, { scope: 'wallet', accountId: 'acct-2' });

        await screen.findByRole('button', { name: /View address bcrt1qacct0addr0/ });
        const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
        expect(headings).toEqual(['Account 2', 'Account 1']);
        expect(screen.getAllByRole('button', { name: /^View address / })).toHaveLength(6);
        const group2 = screen.getByRole('list', { name: 'Account 2' });
        expect(within(group2).getAllByRole('button')).toHaveLength(3);
        expect(within(group2).getByRole('button', { name: /bcrt1qacct1addr0/ })).toBeTruthy();
        // Asked for the whole wallet: no account on the address read.
        expect(m.getAddressesByChain).toHaveBeenCalledWith(WALLET.id, undefined);
    });

    it('the Settings count equals the number of rows the list shows', async () => {
        const m = fakeMessaging(2);
        const onOpenAddresses = vi.fn();
        render(
            <MessagingProvider shell="web" messaging={m}>
                <Settings
                    onBack={() => {}}
                    activeWallet={WALLET}
                    activeAccount={m.accounts[0]}
                    onOpenWalletPicker={() => {}}
                    onOpenAccountPicker={() => {}}
                    onOpenAddresses={onOpenAddresses}
                />
            </MessagingProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: /^Wallets/ }));
        const row = await screen.findByRole('button', { name: /^My Addresses/ });
        await waitFor(() => expect(row.textContent).toMatch(/6 addresses/));
        cleanup();

        mountList(m, { scope: 'wallet' });
        await screen.findByRole('button', { name: /View address bcrt1qacct0addr0/ });
        expect(screen.getAllByRole('button', { name: /^View address / })).toHaveLength(6);
    });

    it('the default scope still lists only the active account', async () => {
        const m = fakeMessaging(2);
        mountList(m);

        await screen.findByRole('button', { name: /View address bcrt1qacct0addr0/ });
        expect(screen.getAllByRole('button', { name: /^View address / })).toHaveLength(3);
        expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
        expect(m.getAddressesByChain).toHaveBeenCalledWith(WALLET.id, 'acct-1');
    });

    it.each([1, 3])('reads once per table regardless of account count (%i accounts)', async (n) => {
        const m = fakeMessaging(n);
        mountList(m, { scope: 'wallet' });

        await screen.findByRole('button', { name: /View address bcrt1qacct0addr0/ });
        await waitFor(() => expect(screen.getAllByRole('button', { name: /^View address / })).toHaveLength(3 * n));
        expect(m.getAddressesByChain).toHaveBeenCalledTimes(1);
        expect(m.listAccounts).toHaveBeenCalledTimes(1);
        expect(m.getWalletBalances).toHaveBeenCalledTimes(1);
        expect(m.getActiveAddresses).toHaveBeenCalledTimes(1);
    });
});
