// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';

const WALLET = { id: 'wallet-a', name: 'Main Wallet', format: 'bip39' };
const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };
const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qplain0000000000000000000000000000000000';
const CHANGE_ADDRESS = 'bcrt1qchange000000000000000000000000000000000';
const DOGE_ADDRESS = 'mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp';
const MULTISIG = 'bc1qmultisig00000000000000000000000000000000';

function messagingWith(overrides = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        setAddressHidden: vi.fn().mockResolvedValue({ ok: true }),
        setAddressLabel: vi.fn().mockResolvedValue({ ok: true }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest' }),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'addr-1',
                address: ADDRESS,
                label: 'BTC Address #1',
                source: 'hd',
                addressType: 'p2wpkh',
                role: 'receive',
                hidden: false,
                accountId: ACCOUNT.id,
            }],
        }),
        listMultisigReceiveAddresses: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
}

function mount(messaging, props = {}) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <AddressList
                    walletId={WALLET.id}
                    accountId={ACCOUNT.id}
                    onBack={() => {}}
                    {...props}
                />
            </ToastHost>
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('Address detail actions', () => {
    it('shows address fiat balances in the selected currency', async () => {
        mount(messagingWith({
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest', fiatCurrency: 'EUR' }),
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: ADDRESS,
                    balances: {
                        native: { tick: 'BTC', quantity: '50000000', divisibility: 8, fiatRate: 80000 },
                        tokens: [],
                    },
                }],
            }),
        }));

        expect(await screen.findByText('€40,000.00 EUR')).toBeInTheDocument();
        expect(screen.queryByText('$40,000.00 USD')).toBeNull();
    });

    it('announces a successful address copy', async () => {
        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: vi.fn(() => true),
        });
        mount(messagingWith());
        fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));

        fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));

        expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
        const notifications = screen.getByRole('status', { name: 'Notifications' });
        expect(notifications).toHaveTextContent('Copied');
        expect(screen.getAllByText('Copied')).toHaveLength(2);
    });

    it('reports clipboard failure and does not switch the button to Copied', async () => {
        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: vi.fn(() => false),
        });
        mount(messagingWith());
        fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));

        fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));

        await waitFor(() => expect(
            screen.getByRole('status', { name: 'Notifications' }),
        ).toHaveTextContent('Copy failed: the clipboard is unavailable.'));
        expect(screen.getByRole('button', { name: 'Copy address' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
    });

    it('hides record-only actions for a synthetic multisig receive address', async () => {
        const messaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            listMultisigReceiveAddresses: vi.fn().mockResolvedValue([{
                multisigConfigId: 'multisig-1',
                address: MULTISIG,
                threshold: 2,
                cosignerCount: 3,
                scheme: 'p2wsh',
            }]),
        });
        mount(messaging, { onShowPrivateKey: vi.fn(), onSelect: vi.fn() });
        fireEvent.click(await screen.findByRole('button', { name: `View address ${MULTISIG}` }));

        expect(screen.queryByRole('button', { name: /^Use$/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Secret/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'XChain' })).toBeInTheDocument();
        await waitFor(() => expect(messaging.listMultisigReceiveAddresses).toHaveBeenLastCalledWith({
            walletId: WALLET.id,
            chainId: CHAIN,
        }));
    });

    it('renames an address and keeps the edited value in the detail view', async () => {
        const messaging = messagingWith();
        mount(messaging);
        fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));

        fireEvent.change(screen.getByRole('textbox', { name: 'Address label' }), {
            target: { value: 'Savings' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(messaging.setAddressLabel).toHaveBeenCalledWith('addr-1', 'Savings'));
        expect(screen.getByRole('textbox', { name: 'Address label' })).toHaveValue('Savings');
        expect(screen.getByRole('status', { name: 'Notifications' })).toHaveTextContent('Address label saved.');
    });

    it('does not offer to activate the address that is already active', async () => {
        const messaging = messagingWith({
            getActiveAddresses: vi.fn().mockResolvedValue({
                [CHAIN]: { id: 'addr-1', address: ADDRESS },
            }),
        });
        mount(messaging);
        fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));

        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Use' })).toBeNull();
    });

    it('hides an address, then exposes it for unhide from the collapsed section', async () => {
        const messaging = messagingWith();
        mount(messaging);
        fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));
        fireEvent.click(screen.getByRole('button', { name: 'Hide' }));

        await waitFor(() => expect(messaging.setAddressHidden).toHaveBeenCalledWith('addr-1', true));
        expect(screen.queryByRole('button', { name: `View address ${ADDRESS}` })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Show 1 hidden address' }));
        fireEvent.click(screen.getByRole('button', { name: `View address ${ADDRESS}` }));
        fireEvent.click(screen.getByRole('button', { name: 'Unhide' }));

        await waitFor(() => expect(messaging.setAddressHidden).toHaveBeenLastCalledWith('addr-1', false));
        expect(screen.getByRole('button', { name: `View address ${ADDRESS}` })).toBeInTheDocument();
    });

    it('shows rotated change addresses as Change under Misc', async () => {
        const messaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [
                    {
                        id: 'addr-1', address: ADDRESS, label: 'Receive', source: 'hd',
                        addressType: 'p2wpkh', role: 'receive', accountId: ACCOUNT.id,
                    },
                    {
                        id: 'addr-change', address: CHANGE_ADDRESS, label: 'BTC Change #1', source: 'hd',
                        addressType: 'p2wpkh', role: 'change', accountId: ACCOUNT.id,
                    },
                ],
            }),
        });
        mount(messaging);
        fireEvent.click(await screen.findByRole('tab', { name: 'Misc' }));

        expect(screen.queryByRole('button', { name: `View address ${ADDRESS}` })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: `View address ${CHANGE_ADDRESS}` }));
        expect(screen.getByTestId('address-detail-type')).toHaveTextContent('Change');
    });

    it('filters rows to the selected coin chain', async () => {
        const messaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'btc', address: ADDRESS, source: 'hd', role: 'receive' }],
                'dogecoin-regtest': [{ id: 'doge', address: DOGE_ADDRESS, source: 'hd', role: 'receive' }],
            }),
        });
        mount(messaging);
        await screen.findByRole('button', { name: `View address ${ADDRESS}` });
        fireEvent.click(screen.getByRole('button', { name: 'Filter by network' }));
        fireEvent.click(screen.getByRole('option', { name: 'Dogecoin' }));

        expect(screen.queryByRole('button', { name: `View address ${ADDRESS}` })).toBeNull();
        expect(screen.getByRole('button', { name: `View address ${DOGE_ADDRESS}` })).toBeInTheDocument();
    });

    it('keeps style-guide search and menu controls available by role', async () => {
        mount(messagingWith());

        const search = await screen.findByRole('textbox', { name: 'Search addresses' });
        expect(search).toHaveAttribute('type', 'search');

        fireEvent.click(screen.getByRole('button', { name: 'Add or import address' }));
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Add address',
            'Generate at index (advanced)',
            'Import address',
        ]);
    });

    it('bounds thousands of addresses and keeps the list scroller anchored while expanding', async () => {
        const records = Array.from({ length: 5_000 }, (_, index) => ({
            id: `addr-${index}`,
            address: `bcrt1qfixture${String(index).padStart(5, '0')}xxxxxxxxxxxxxxxxxxxx`,
            label: `Fixture ${index}`,
            source: 'hd',
            role: 'receive',
            accountId: ACCOUNT.id,
        }));
        mount(messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: records }),
        }));

        const list = await screen.findByRole('list', { name: 'Addresses' });
        await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(100));
        expect(screen.getByText('100 of 5,000 addresses shown')).toBeInTheDocument();

        const scroller = document.querySelector('main');
        scroller.scrollTop = 173;
        const showMore = screen.getByRole('button', { name: 'Show more addresses' });
        showMore.focus();
        expect(document.activeElement).toBe(showMore);
        fireEvent.click(showMore);

        await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(200));
        expect(scroller.scrollTop).toBe(173);

        fireEvent.change(screen.getByRole('textbox', { name: 'Search addresses' }), {
            target: { value: 'Fixture 4999' },
        });
        await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(1));
        expect(screen.queryByRole('button', { name: 'Show more addresses' })).toBeNull();
    });

    it('labels every address row with its chain and non-mainnet kind', async () => {
        mount(messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'btc', address: ADDRESS, source: 'hd', role: 'receive' }],
                'dogecoin-regtest': [{ id: 'doge', address: DOGE_ADDRESS, source: 'hd', role: 'receive' }],
            }),
        }));

        const bitcoinRow = await screen.findByRole('button', { name: `View address ${ADDRESS}` });
        const dogecoinRow = screen.getByRole('button', { name: `View address ${DOGE_ADDRESS}` });
        expect(bitcoinRow).toHaveTextContent(/Bitcoin\s+regtest/i);
        expect(dogecoinRow).toHaveTextContent(/Dogecoin\s+regtest/i);
    });
});
