// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';
import listRowStyles from '../../../packages/core/src/ui/ListRow.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

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

// Search, network and the address type picker sit behind the title-bar filter button (G04).
async function openFilter() {
    fireEvent.click(await screen.findByRole('button', { name: 'Filter addresses' }));
    await screen.findByRole('dialog', { name: 'Filter addresses' });
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
    it('middle-truncates card addresses while keeping the full value available on focus and copy', async () => {
        mount(messagingWith());

        const address = await screen.findByLabelText(ADDRESS);
        expect(address).toHaveTextContent(`${ADDRESS.slice(0, 6)}…${ADDRESS.slice(-6)}`);

        const setData = vi.fn();
        fireEvent.copy(address, { clipboardData: { setData } });
        expect(setData).toHaveBeenCalledWith('text/plain', ADDRESS);

        fireEvent.focus(address);
        expect(address).toHaveTextContent(ADDRESS);
    });

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

        fireEvent.click(screen.getByRole('button', { name: 'Copy Address' }));

        // The copy icon (icon only) names itself Copied, and announces its
        // result in a polite status region.
        expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
        expect(screen.getAllByText('Copied: Address')).toHaveLength(1);
    });

    it('reports clipboard failure and does not switch the button to Copied', async () => {
        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: vi.fn(() => false),
        });
        mount(messagingWith());
        fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));

        fireEvent.click(screen.getByRole('button', { name: 'Copy Address' }));

        await waitFor(() => expect(
            screen.getByRole('alert'),
        ).toHaveTextContent('Copy failed: the clipboard is unavailable.'));
        expect(screen.getByRole('button', { name: 'Copy Address' })).toBeInTheDocument();
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

        expect(screen.queryByRole('button', { name: /^Set active/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Secret/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Edit label/ })).toBeNull();
        expect(screen.getByRole('button', { name: /^Explorer/ })).toBeInTheDocument();
        await waitFor(() => expect(messaging.listMultisigReceiveAddresses).toHaveBeenLastCalledWith({
            walletId: WALLET.id,
            chainId: CHAIN,
        }));
    });

    it('renames an address in the Edit label form and shows the new label as the card title', async () => {
        const messaging = messagingWith();
        mount(messaging);
        fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));
        fireEvent.click(screen.getByRole('button', { name: /^Edit label/ }));

        fireEvent.change(screen.getByRole('textbox', { name: 'Address label' }), {
            target: { value: 'Savings' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save Label' }));

        await waitFor(() => expect(messaging.setAddressLabel).toHaveBeenCalledWith('addr-1', 'Savings'));
        expect(await screen.findByRole('heading', { level: 2, name: 'Savings' })).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Address label' })).toBeNull();
        expect(screen.getByRole('status', { name: 'Notifications' })).toHaveTextContent('Address label saved.');
    });

    it('gives the Edit label form one Save Label action with an icon, held while unchanged', async () => {
        mount(messagingWith());
        fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));
        fireEvent.click(screen.getByRole('button', { name: /^Edit label/ }));

        const save = screen.getByRole('button', { name: 'Save Label' });
        expect(save.querySelector('svg')).not.toBeNull();
        expect(save).toBeDisabled();
        expect(screen.getByRole('textbox', { name: 'Address label' })).toHaveValue('BTC Address #1');
        expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('opens on an Actions | Details tab row with Actions chosen', async () => {
        mount(messagingWith());
        fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));

        expect(screen.getByRole('tablist')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Actions' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'false');
        expect(screen.queryByRole('heading', { name: 'About' })).toBeNull();
    });

    it('does not offer to activate the address that is already active, and shows no pill', async () => {
        const messaging = messagingWith({
            getActiveAddresses: vi.fn().mockResolvedValue({
                [CHAIN]: { id: 'addr-1', address: ADDRESS },
            }),
        });
        mount(messaging);
        fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));

        expect(screen.queryByText('Active')).toBeNull();
        expect(screen.queryByRole('button', { name: /^Set active/ })).toBeNull();
    });

    it('hides an address, then exposes it for unhide from the collapsed section', async () => {
        const messaging = messagingWith();
        mount(messaging);
        fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));
        fireEvent.click(screen.getByRole('button', { name: /^Hide/ }));

        await waitFor(() => expect(messaging.setAddressHidden).toHaveBeenCalledWith('addr-1', true));
        expect(screen.queryByRole('button', { name: `View address ${ADDRESS}` })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Show 1 Hidden Address' }));
        fireEvent.click(screen.getByRole('button', { name: `View address ${ADDRESS}` }));
        fireEvent.click(screen.getByRole('button', { name: /^Unhide/ }));

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
        await openFilter();
        fireEvent.click(screen.getByRole('button', { name: /All addresses/ }));
        fireEvent.click(screen.getByRole('option', { name: 'Misc' }));

        expect(screen.queryByRole('button', { name: `View address ${ADDRESS}` })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: `View address ${CHANGE_ADDRESS}` }));
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
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
        await openFilter();
        fireEvent.click(screen.getByRole('button', { name: /^Filter by network/ }));
        // The network filter opens the full-screen network list.
        fireEvent.click(screen.getByRole('button', { name: 'Select Dogecoin' }));

        expect(screen.queryByRole('button', { name: `View address ${ADDRESS}` })).toBeNull();
        expect(screen.getByRole('button', { name: `View address ${DOGE_ADDRESS}` })).toBeInTheDocument();
    });

    it('hides the network switch on a locked picker and keeps rows on its chain', async () => {
        const messaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'btc', address: ADDRESS, source: 'hd', role: 'receive' }],
                'dogecoin-regtest': [{ id: 'doge', address: DOGE_ADDRESS, source: 'hd', role: 'receive' }],
            }),
        });
        mount(messaging, { pickerMode: true, onPick: vi.fn(), networkFilter: 'bitcoin', networkLocked: true });

        await screen.findByRole('button', { name: `View address ${ADDRESS}` });
        await openFilter();
        expect(screen.queryByRole('button', { name: /Filter by network/ })).toBeNull();
        expect(screen.queryByRole('button', { name: `View address ${DOGE_ADDRESS}` })).toBeNull();
    });

    it('keeps the network switch on a picker that may change chains', async () => {
        mount(messagingWith(), { pickerMode: true, onPick: vi.fn(), networkFilter: 'bitcoin' });

        await screen.findByRole('button', { name: `View address ${ADDRESS}` });
        await openFilter();
        expect(screen.getByRole('button', { name: /Filter by network/ })).toBeInTheDocument();
    });

    it('marks the address currently shown by the calling screen', async () => {
        mount(messagingWith(), {
            pickerMode: true,
            onPick: vi.fn(),
            pickerSelectedAddress: { id: 'addr-1', address: ADDRESS },
        });

        expect(await screen.findByRole('button', { name: `View address ${ADDRESS}` }))
            .toHaveAttribute('aria-current', 'true');
    });

    it('disables a picker row the form cannot use and says why', async () => {
        const onPick = vi.fn();
        mount(messagingWith(), {
            pickerMode: true,
            onPick,
            pickerUnavailableReason: (record) => (record.id === 'addr-1' ? 'Watch-only' : null),
        });

        const row = await screen.findByRole('button', { name: `View address ${ADDRESS}` });
        expect(row).toBeDisabled();
        expect(row).toHaveTextContent('Watch-only');
        fireEvent.click(row);
        expect(onPick).not.toHaveBeenCalled();
    });

    it('keeps style-guide search and menu controls available by role', async () => {
        mount(messagingWith());

        await openFilter();
        const search = await screen.findByRole('searchbox', { name: 'Search addresses' });
        expect(search).toHaveAttribute('type', 'search');

        fireEvent.click(screen.getByRole('button', { name: 'Add or import address' }));
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            'Add Address',
            'Import Address',
        ]);
    });

    it('gives the address rows the standard trailing chevron', async () => {
        mount(messagingWith());

        const row = await screen.findByRole('button', { name: `View address ${ADDRESS}` });
        expect(row.querySelector(`.${listRowStyles.chevron}`)).not.toBeNull();
    });

    it('offers the optional address index inside the Add Address form', async () => {
        mount(messagingWith());

        await screen.findByRole('button', { name: 'Filter addresses' });
        fireEvent.click(screen.getByRole('button', { name: 'Add or import address' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Add Address' }));

        expect(await screen.findByTestId('add-address-index')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Address index' })).toBeInTheDocument();
    });

    it('shows help for the imported key network and recovery acknowledgement', async () => {
        mount(messagingWith());

        await screen.findByRole('button', { name: 'Filter addresses' });
        fireEvent.click(screen.getByRole('button', { name: 'Add or import address' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Import Address' }));

        expect(screen.getByRole('button', { name: 'About Network' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^About I understand this key/ })).toBeInTheDocument();
    });

    it('keeps Import enabled and reports missing WIF fields without importing', async () => {
        const importWifRequest = vi.fn();
        mount(messagingWith({
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            importWifRequest,
        }));

        await screen.findByRole('button', { name: 'Filter addresses' });
        fireEvent.click(screen.getByRole('button', { name: 'Add or import address' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Import Address' }));

        const submit = screen.getByRole('button', { name: 'Import' });
        expect(submit).not.toBeDisabled();
        fireEvent.click(submit);

        await waitFor(() => expect(document.querySelector('[data-form-errors]'))
            .toHaveTextContent('Paste a WIF private key.'));
        expect(screen.getByLabelText('WIF private key')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('checkbox', { name: /I understand this key/i }))
            .toHaveAttribute('aria-invalid', 'true');
        expect(importWifRequest).not.toHaveBeenCalled();
    });

    it('renders picker actions with shared list-row interaction styles', async () => {
        const onSelect = vi.fn();
        mount(messagingWith(), {
            pickerMode: true,
            pickerActions: [{
                key: 'new',
                label: 'New dispenser address',
                sublabel: 'Generate an Address',
                onSelect,
            }],
        });

        const action = await screen.findByRole('button', {
            name: 'New dispenser address Generate an Address',
        });
        expect(action).toHaveClass(listRowStyles.row, listRowStyles.interactive);
        expect(action).toHaveAttribute('type', 'button');
        expect(action).toHaveAttribute('aria-busy', 'false');

        fireEvent.click(action);
        expect(onSelect).toHaveBeenCalledOnce();
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
        const showMore = screen.getByRole('button', { name: 'Show More Addresses' });
        // Every button carries an icon (U63).
        expect(showMore.querySelector('svg')).not.toBeNull();
        // Add or import address is now the title bar's icon-only plus (G02), not a green action.
        expect(screen.getByTestId('address-add-menu')).not.toHaveClass(buttonStyles.success);
        expect(screen.getByTestId('address-add-menu').querySelector('svg')).not.toBeNull();
        showMore.focus();
        expect(document.activeElement).toBe(showMore);
        fireEvent.click(showMore);

        await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(200));
        expect(scroller.scrollTop).toBe(173);

        await openFilter();
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search addresses' }), {
            target: { value: 'Fixture 4999' },
        });
        await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(1));
        expect(screen.queryByRole('button', { name: 'Show More Addresses' })).toBeNull();
    });

    it('uses chain icons without rendering coin or network-kind row text', async () => {
        mount(messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ id: 'btc', address: ADDRESS, source: 'hd', role: 'receive' }],
                'dogecoin-regtest': [{ id: 'doge', address: DOGE_ADDRESS, source: 'hd', role: 'receive' }],
            }),
        }));

        const bitcoinRow = await screen.findByRole('button', { name: `View address ${ADDRESS}` });
        const dogecoinRow = screen.getByRole('button', { name: `View address ${DOGE_ADDRESS}` });
        expect(bitcoinRow).toHaveClass(listRowStyles.row, listRowStyles.interactive);
        expect(dogecoinRow).toHaveClass(listRowStyles.row, listRowStyles.interactive);
        expect(bitcoinRow).toHaveAttribute('aria-busy', 'false');
        expect(bitcoinRow.querySelector('img')).toBeTruthy();
        expect(dogecoinRow.querySelector('img')).toBeTruthy();
        expect(bitcoinRow).not.toHaveTextContent(/Bitcoin|regtest|testnet|not mainnet/i);
        expect(dogecoinRow).not.toHaveTextContent(/Dogecoin|regtest|testnet|not mainnet/i);
    });
});
