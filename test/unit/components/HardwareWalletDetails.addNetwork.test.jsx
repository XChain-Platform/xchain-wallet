// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Add network moved off the hardware Wallet Details page (G131): a hardware
// account's Account Details, Addresses tab (the shared account page) offers
// it for each network the device signs on the wallet's network setting that
// the account does not have yet. A press reads the address through the app
// open now and fills it into that account (wallet.activateChain with signerId
// and accountId). A Ledger with another app open shows the connect step's
// line, "Open the Litecoin app on your Ledger" on the same tappable row.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AccountDetails } from '../../../packages/core/src/shared/routes/AccountDetails.jsx';
import { hardwareNetworksToAdd } from '../../../packages/core/src/shared/components/hardware/HardwareNetworkRow.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const WALLET = { id: 'hw-1', name: 'Desk Ledger', format: 'hardware', origin: 'connected-hardware' };
const LEDGER = { id: 'sig-l', walletId: WALLET.id, kind: 'ledger', vendor: 'ledger', model: 'nanoX' };
const ACCOUNTS = [
    { id: 'a1', walletId: WALLET.id, index: 0, name: 'Account 1' },
    { id: 'a2', walletId: WALLET.id, index: 1, name: 'Account 2' },
];
const BTC_A1 = { accountId: 'a1', address: 'bc1qa1', derivationPath: "m/84'/0'/0'/0/0", source: 'ledger', signerId: LEDGER.id };
const LTC_A1 = { accountId: 'a1', address: 'ltc1qa1', derivationPath: "m/84'/2'/0'/0/0", source: 'ledger', signerId: LEDGER.id };

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function messagingFor({ byChain, activate, signer = LEDGER, network = 'mainnet' }) {
    let map = byChain;
    return {
        listWallets: vi.fn(async () => [WALLET]),
        listSigners: vi.fn(async () => [signer]),
        getSignerStatus: vi.fn(async () => ({ status: 'available' })),
        listAccounts: vi.fn(async () => ACCOUNTS),
        getSettings: vi.fn(async () => ({ activeNetwork: network })),
        getAddressesByChain: vi.fn(async () => map),
        activateChainRequest: vi.fn(async (req) => {
            const out = await activate(req);
            if (out?.next) map = out.next;
            return out?.result;
        }),
        setMap(next) { map = next; },
    };
}

async function flush() {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

// Account 1's Account Details, on its Addresses tab.
async function renderOnAccounts(messaging, accountId = 'a1') {
    await act(async () => {
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AccountDetails walletId={WALLET.id} accountId={accountId} activeAccountId="a1" onBack={() => {}} />
            </MessagingProvider>,
        );
        await flush();
    });
    await act(async () => {
        fireEvent.click(screen.getByRole('tab', { name: /Addresses/ }));
        await flush();
    });
}

function addRows() {
    const list = screen.getByRole('list', { name: 'Networks to add' });
    return within(list).getAllByRole('listitem');
}

function rowFor(title) {
    const row = addRows().find((item) => item.textContent.includes(title));
    if (!row) throw new Error(`no Add network row "${title}"`);
    return row;
}

describe('Add network on a hardware account\'s Account Details, Addresses tab', () => {
    it('lists each network the account lacks on the wallet\'s network setting, under its own group label', async () => {
        await renderOnAccounts(messagingFor({ byChain: { 'bitcoin-mainnet': [BTC_A1] }, activate: async () => ({}) }));
        expect(screen.getByRole('heading', { name: 'Add a Network' })).toBeInTheDocument();
        // This account only, networks in the registry's order.
        expect(addRows().map((row) => row.textContent)).toEqual([
            expect.stringContaining('Add Dogecoin'),
            expect.stringContaining('Add Litecoin'),
        ]);
        expect(rowFor('Add Litecoin')).toHaveTextContent('Read its address from your Ledger');
    });

    it('offers Account 2 every network it lacks', async () => {
        await renderOnAccounts(messagingFor({ byChain: { 'bitcoin-mainnet': [BTC_A1] }, activate: async () => ({}) }), 'a2');
        expect(addRows().map((row) => row.textContent)).toEqual([
            expect.stringContaining('Add Bitcoin'),
            expect.stringContaining('Add Dogecoin'),
            expect.stringContaining('Add Litecoin'),
        ]);
    });

    it('reads the network into that account, keeps retry on the standard row, then drops it once added', async () => {
        let call = 0;
        const messaging = messagingFor({
            byChain: { 'bitcoin-mainnet': [BTC_A1] },
            activate: async () => {
                call += 1;
                if (call === 1) return { result: { chainId: 'litecoin-mainnet', addresses: [], hardwareSkipped: 'wrong-app' } };
                return {
                    result: { chainId: 'litecoin-mainnet', addresses: [{ accountId: 'a1', address: LTC_A1 }] },
                    next: { 'bitcoin-mainnet': [BTC_A1], 'litecoin-mainnet': [LTC_A1] },
                };
            },
        });
        await renderOnAccounts(messaging);

        await act(async () => {
            fireEvent.click(within(rowFor('Add Litecoin')).getByRole('button', { name: /Add Litecoin/ }));
            await flush();
        });
        expect(messaging.activateChainRequest).toHaveBeenCalledWith({
            walletId: WALLET.id, chainId: 'litecoin-mainnet', signerId: LEDGER.id, accountId: 'a1',
        });
        const waiting = rowFor('Add Litecoin');
        expect(waiting).toHaveTextContent('Open the Litecoin app on your Ledger');
        const tryAgain = within(waiting).getByRole('button', { name: /Add Litecoin/ });
        expect(within(waiting).queryByRole('button', { name: /Try Again/ })).toBeNull();

        await act(async () => {
            fireEvent.click(tryAgain);
            await flush();
        });
        expect(messaging.activateChainRequest).toHaveBeenCalledTimes(2);
        expect(messaging.getAddressesByChain).toHaveBeenCalledTimes(2);
        expect(addRows().map((row) => row.textContent)).not.toContainEqual(expect.stringContaining('Add Litecoin'));
        // The new address joins the account's one flat Addresses list (G131).
        const addresses = screen.getByRole('list', { name: 'Addresses' });
        expect(addresses.querySelectorAll('[data-chain-id="litecoin-mainnet"]')).toHaveLength(1);
    });

    it('takes a wrong-app error the host threw as the same wait, and any other error as a failed read', async () => {
        let call = 0;
        const messaging = messagingFor({
            byChain: { 'bitcoin-mainnet': [BTC_A1] },
            activate: async () => {
                call += 1;
                if (call === 1) throw new Error('The wrong app is open on your Ledger. Open the app for this network, then try again.');
                throw new Error('Device busy');
            },
        });
        await renderOnAccounts(messaging);
        await act(async () => {
            fireEvent.click(within(rowFor('Add Dogecoin')).getByRole('button', { name: /Add Dogecoin/ }));
            await flush();
        });
        expect(rowFor('Add Dogecoin')).toHaveTextContent('Open the Dogecoin app on your Ledger');
        await act(async () => {
            fireEvent.click(within(rowFor('Add Dogecoin')).getByRole('button', { name: /Add Dogecoin/ }));
            await flush();
        });
        expect(rowFor('Add Dogecoin')).toHaveTextContent("Couldn't read it from your Ledger");
        expect(within(rowFor('Add Dogecoin')).getByRole('button', { name: /Add Dogecoin/ })).toBeInTheDocument();
        expect(within(rowFor('Add Dogecoin')).queryByRole('button', { name: /Try Again/ })).toBeNull();
    });

    it('shows no Add network rows on a local wallet\'s account', async () => {
        const messaging = messagingFor({ byChain: { 'bitcoin-mainnet': [{ ...BTC_A1, source: 'hd', signerId: null }] }, activate: async () => ({}) });
        messaging.listWallets = vi.fn(async () => [{ id: WALLET.id, name: 'Everyday', format: 'bip39' }]);
        await renderOnAccounts(messaging);
        expect(screen.getByRole('list', { name: 'Addresses' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Add a Network' })).toBeNull();
    });

    it('shows no Add network rows when the account has every network', async () => {
        const full = {
            'bitcoin-mainnet': [BTC_A1, { ...BTC_A1, accountId: 'a2', derivationPath: "m/84'/0'/1'/0/0" }],
            'litecoin-mainnet': [LTC_A1, { ...LTC_A1, accountId: 'a2', derivationPath: "m/84'/2'/1'/0/0" }],
            'dogecoin-mainnet': [
                { accountId: 'a1', derivationPath: "m/44'/3'/0'/0/0", address: 'D1' },
                { accountId: 'a2', derivationPath: "m/44'/3'/1'/0/0", address: 'D2' },
            ],
        };
        await renderOnAccounts(messagingFor({ byChain: full, activate: async () => ({}) }));
        expect(screen.queryByRole('list', { name: 'Networks to add' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Add a Network' })).toBeNull();
    });
});

describe('hardwareNetworksToAdd', () => {
    const chains = defaultRegistry().supportedChains();

    it('offers only what the vendor signs on the wallet\'s network setting: a Trezor on Testnet has no Dogecoin', () => {
        const rows = hardwareNetworksToAdd({
            accounts: [ACCOUNTS[0]], byChain: {}, chains, vendor: 'trezor', network: 'testnet',
        });
        const ids = rows.map((row) => row.descriptor.id);
        expect(ids).toContain('bitcoin-testnet');
        expect(ids).toContain('litecoin-testnet');
        expect(ids).not.toContain('dogecoin-testnet');
        expect(ids.every((id) => id.endsWith('-testnet'))).toBe(true);
    });

    it('a Ledger on Testnet offers Bitcoin Test only, and an account matched by path when its address names no account', () => {
        const rows = hardwareNetworksToAdd({
            accounts: ACCOUNTS,
            byChain: { 'bitcoin-testnet': [{ derivationPath: "m/84'/1'/0'/0/0" }] },
            chains,
            vendor: 'ledger',
            network: 'testnet',
        });
        expect(rows.map((row) => [row.accountId, row.descriptor.id])).toEqual([['a2', 'bitcoin-testnet']]);
    });
});
