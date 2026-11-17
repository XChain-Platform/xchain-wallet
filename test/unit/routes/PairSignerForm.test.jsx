// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The three-step Hardware Wallet connect flow (Choose, Connect, Accounts)
// driven on MockHardwareSigner, step by step against the operator rulings.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PairSignerForm } from '../../../packages/core/src/shared/routes/PairSignerForm.jsx';
import { chainIconLargeUrl, signerVendorLogoUrl } from '../../../packages/core/src/branding/branding.js';
import { hardwareNetworkSupport } from '../../../packages/core/src/flows/hardwareWallet.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import { MockHardwareSigner } from '../signers/MockHardwareSigner.js';

// One support table for the test: mainnet and testnet sign, except a Litecoin
// testnet the device app lacks; regtest never shows here unless asked for.
vi.mock('../../../packages/core/src/flows/hardwareWallet.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        hardwareNetworkSupport: vi.fn((vendor, chainId) => (chainId === 'litecoin-testnet'
            ? { supported: false, reason: 'No Litecoin testnet app on this device.' }
            : { supported: true, reason: null })),
    };
});

const PAIRING_INFO = {
    vendor: 'trezor',
    model: 'T2B1',
    deviceIdentifier: 'device-1',
    firmwareVersion: '2.7.2',
};

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function api(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet', fiatCurrency: 'USD' }),
        hardwareBalances: vi.fn(async ({ items }) => items.map((item) => ({
            ...item,
            balance: item.chainId.startsWith('bitcoin') ? '0.2481' : '12.5',
            fiat: item.chainId.startsWith('bitcoin') ? 24810 : 1250,
        }))),
        addHardwareWallet: vi.fn(async ({ name }) => ({
            wallet: { id: 'wallet-hw-1', name },
            signer: { id: 'signer-hw-1' },
            accounts: [],
            addresses: [],
        })),
        ...overrides,
    };
}

function mount({ messaging = api(), signer = new MockHardwareSigner({ vendor: 'trezor' }), pairTrezor, pairLedger, ...props } = {}) {
    const trezor = pairTrezor === undefined
        ? vi.fn(async () => ({ signer, pairingInfo: PAIRING_INFO }))
        : pairTrezor;
    const ledger = pairLedger === undefined ? vi.fn() : pairLedger;
    const handlers = {
        onBack: vi.fn(),
        onCreated: vi.fn(),
        onDeviceReady: vi.fn(),
        onSignerPaired: vi.fn(),
        ...props,
    };
    const utils = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PairSignerForm mode="add" pairTrezor={trezor} pairLedger={ledger} {...handlers} />
        </MessagingProvider>,
    );
    return { ...utils, ...handlers, messaging, signer, pairTrezor: trezor, pairLedger: ledger };
}

function currentStep() {
    const marked = document.querySelectorAll('[aria-current="step"]');
    // The header line is the step marker; the status line marks its running step too.
    return [...marked].map((node) => node.textContent).find((text) => /^Step /.test(text));
}

async function pickTrezor() {
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Trezor/ }));
    });
}

async function reachAccounts(options) {
    const utils = mount(options);
    await pickTrezor();
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    return utils;
}

function statusStates() {
    const line = screen.getByRole('list', { name: 'Connection progress' });
    return [...line.querySelectorAll('li')].map((li) => li.getAttribute('data-state'));
}

beforeEach(() => {
    Object.defineProperty(navigator, 'hid', { configurable: true, value: {} });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    hardwareNetworkSupport.mockImplementation((vendor, chainId) => (chainId === 'litecoin-testnet'
        ? { supported: false, reason: 'No Litecoin testnet app on this device.' }
        : { supported: true, reason: null }));
    Reflect.deleteProperty(navigator, 'hid');
});

describe('Hardware Wallet step 1: Choose', () => {
    it('heads every step Hardware Wallet with Step 1 of 3: Choose as the current step', () => {
        mount();

        expect(screen.getByRole('heading', { name: 'Hardware Wallet' })).toBeInTheDocument();
        expect(currentStep()).toBe('Step 1 of 3: Choose');
        expect(screen.queryByText('Choose your hardware wallet')).toBeNull();
    });

    it('puts the hardware-wallet key title on its own line above the body', () => {
        mount();

        const title = screen.getByText('Your keys stay on your hardware wallet.');
        const body = screen.getByText('This wallet only reads addresses and asks the hardware wallet to sign.');
        const notice = title.closest('[data-xc-notice], [role="note"]');
        expect(notice).not.toBeNull();
        expect(title.tagName).toBe('DIV');
        expect(title.nextElementSibling).toContainElement(body);
        expect(notice.textContent).not.toMatch(/\bdevice\b/i);
    });

    it('offers Trezor and Ledger as chevron rows with the vendor marks', () => {
        mount();

        for (const [name, vendor] of [['Trezor', 'trezor'], ['Ledger', 'ledger']]) {
            const row = screen.getByRole('button', { name: new RegExp(name) });
            expect(row.querySelector('img')).toHaveAttribute('src', signerVendorLogoUrl(vendor));
            expect(row.querySelector('svg path')).toHaveAttribute('d', 'm9 18 6-6-6-6');
        }
        expect(screen.getByText('Safe 3, Safe 5, Model T, Model One')).toBeInTheDocument();
        expect(screen.getByText('Nano S Plus, Nano X, Stax, Flex')).toBeInTheDocument();
        expect(screen.queryByRole('radio')).toBeNull();
    });

    it('marks Ledger off with the reason when the browser has no WebHID', () => {
        Reflect.deleteProperty(navigator, 'hid');
        const { pairLedger } = mount();

        const ledger = screen.getByRole('button', { name: /Ledger/ });
        expect(ledger).toHaveAttribute('aria-disabled', 'true');
        expect(ledger).toHaveTextContent(/Needs WebHID/);
        fireEvent.click(ledger);
        expect(pairLedger).not.toHaveBeenCalled();
        expect(currentStep()).toBe('Step 1 of 3: Choose');
    });

    it('marks Trezor off where the shell has no Trezor factory (the extension)', () => {
        mount({ pairTrezor: null });

        expect(screen.getByRole('button', { name: /Trezor/ })).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('button', { name: /Trezor/ })).toHaveTextContent('Not available in this app.');
    });

    it('leaves through the header Back with no Cancel button', () => {
        const { onBack } = mount();

        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('offers Open in tab on step 1 only', async () => {
        const onOpenInTab = vi.fn();
        mount({ onOpenInTab });

        fireEvent.click(screen.getByRole('button', { name: 'Open in tab' }));
        expect(onOpenInTab).toHaveBeenCalledOnce();
        await pickTrezor();
        expect(screen.queryByRole('button', { name: 'Open in tab' })).toBeNull();
    });
});

describe('Hardware Wallet step 2: Connect', () => {
    it('shows the device card, the three statuses and the two options while it connects, with no Continue yet', async () => {
        const pending = deferred();
        mount({ pairTrezor: vi.fn(() => pending.promise) });

        await pickTrezor();
        expect(currentStep()).toBe('Step 2 of 3: Connect');
        expect(document.querySelector('[data-hardware-device-card]')).toHaveAttribute('data-status', 'not-connected');
        expect(screen.getByText('Plugged in')).toBeInTheDocument();
        expect(screen.getByText('Unlock')).toBeInTheDocument();
        expect(screen.getByText('Allow XChain')).toBeInTheDocument();
        expect(statusStates()).toEqual(['active', 'todo', 'todo']);

        const options = screen.getByRole('list', { name: 'Connection options' });
        expect(within(options).getAllByRole('listitem')).toHaveLength(2);
        expect(within(options).getByRole('button', { name: /Try again/ })).toBeInTheDocument();
        expect(within(options).getByRole('button', { name: /Help with connecting/ })).toBeInTheDocument();
        expect(screen.queryByText('Other options')).toBeNull();
        expect(screen.queryByText(/Choose another device/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    });

    it('marks all three done, says Found by USB with the model, and shows a green Continue with an icon', async () => {
        mount();

        await pickTrezor();
        expect(statusStates()).toEqual(['done', 'done', 'done']);
        const card = document.querySelector('[data-hardware-device-card]');
        expect(card).toHaveAttribute('data-status', 'found');
        expect(card).toHaveTextContent('Found by USB');
        expect(card).toHaveTextContent('Trezor Safe 3');
        expect(screen.queryByRole('alert')).toBeNull();
        const continueButton = screen.getByRole('button', { name: 'Continue' });
        expect(continueButton).toHaveClass(buttonStyles.success);
        expect(continueButton.querySelector('svg')).toBeInTheDocument();
    });

    it.each([
        ['nothing is plugged in', new Error('No device selected'), ['failed', 'todo', 'todo'], 'No Trezor was found. Plug it in and unlock it, then try again.'],
        ['the device is locked', new Error('Device is locked'), ['done', 'failed', 'todo'], 'Your Trezor is locked. Enter the PIN on it, then try again.'],
        ['the user refuses', new Error('User rejected the request'), ['done', 'done', 'failed'], 'The connection was not allowed. Approve it on your Trezor and in any browser prompt, then try again.'],
        ['the popup is cancelled', new Error('Trezor pairing was cancelled'), ['done', 'done', 'failed'], 'The connection was not allowed.'],
        ['another app holds it', new Error('The device is already open.'), ['failed', 'todo', 'todo'], 'Close Trezor Suite and any other wallet tab'],
    ])('marks the broken status red with plain advice when %s', async (_name, failure, states, advice) => {
        mount({ pairTrezor: vi.fn().mockRejectedValue(failure) });

        await pickTrezor();
        expect(statusStates()).toEqual(states);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(advice);
        expect(screen.getByRole('form', { name: 'Connect hardware wallet' })).toContainElement(alert);
        expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    });

    it('explains the closed Bitcoin app on a Ledger', async () => {
        const signer = new MockHardwareSigner({ vendor: 'ledger' });
        mount({
            pairLedger: vi.fn().mockRejectedValue(new Error('Ledger device: INS_NOT_SUPPORTED (0x6d00)')),
            signer,
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Ledger/ }));
        });
        expect(statusStates()).toEqual(['done', 'done', 'failed']);
        expect(screen.getByRole('alert')).toHaveTextContent("The Bitcoin app isn't open on your Ledger.");
    });

    it('runs the pairing again from Try again and reaches Continue', async () => {
        const signer = new MockHardwareSigner({ vendor: 'trezor' });
        const pairTrezor = vi.fn()
            .mockRejectedValueOnce(new Error('No device selected'))
            .mockResolvedValueOnce({ signer, pairingInfo: PAIRING_INFO });
        mount({ pairTrezor });

        await pickTrezor();
        expect(screen.getByRole('alert')).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
        });
        expect(pairTrezor).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(statusStates()).toEqual(['done', 'done', 'done']);
        expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    });

    it('blocks a firmware XChain refuses at Allow XChain with update advice', async () => {
        const signer = new MockHardwareSigner({ vendor: 'ledger' });
        mount({
            signer,
            pairLedger: vi.fn().mockResolvedValue({
                signer,
                pairingInfo: { vendor: 'ledger', model: 'nanoS', deviceIdentifier: 'device-1', firmwareVersion: '1.9.0' },
            }),
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Ledger/ }));
        });
        expect(statusStates()).toEqual(['done', 'done', 'failed']);
        expect(screen.getByRole('alert')).toHaveTextContent(/firmware is too old\. Update it to version 2\.1\.0 or newer with Ledger Live/);
        expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    });

    it('opens Help with connecting and Back returns to the statuses', async () => {
        mount();

        await pickTrezor();
        fireEvent.click(screen.getByRole('button', { name: /Help with connecting/ }));
        expect(screen.getByText("If your Trezor isn't found:")).toBeInTheDocument();
        expect(screen.getByText(/Use a data cable/)).toBeInTheDocument();
        expect(currentStep()).toBe('Step 2 of 3: Connect');

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    });

    it('goes back to Choose and drops a late device answer', async () => {
        const pending = deferred();
        const { onBack } = mount({ pairTrezor: vi.fn(() => pending.promise) });

        await pickTrezor();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(onBack).not.toHaveBeenCalled();
        expect(currentStep()).toBe('Step 1 of 3: Choose');

        await act(async () => {
            pending.resolve({ signer: new MockHardwareSigner(), pairingInfo: PAIRING_INFO });
        });
        expect(currentStep()).toBe('Step 1 of 3: Choose');
    });
});

describe('Hardware Wallet step 3: Accounts', () => {
    it('shows the device card, the Wallet name and a three-tab Networks | Accounts | Addresses toggle (G131)', async () => {
        await reachAccounts();

        expect(currentStep()).toBe('Step 3 of 3: Accounts');
        expect(document.querySelector('[data-hardware-device-card]')).toBeInTheDocument();
        expect(screen.getByLabelText('Wallet name', { selector: 'input' })).toHaveValue('My Trezor');
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Networks', 'Accounts', 'Addresses']);
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        // No group label sits above the Networks list.
        expect(screen.queryAllByRole('heading').map((h) => h.textContent)).toEqual(['Hardware Wallet']);
    });

    it('places the no-supported-network notice first inside the form instead of inside a tab', async () => {
        hardwareNetworkSupport.mockImplementation(() => ({ supported: false, reason: 'Not supported.' }));
        await reachAccounts();

        const notice = screen.getByRole('note');
        const form = screen.getByRole('form', { name: 'Add hardware wallet' });
        const device = document.querySelector('[data-hardware-device-card]');
        expect(notice).toHaveTextContent("doesn't sign on any network shown here");
        expect(form).toContainElement(notice);
        expect(notice.compareDocumentPosition(device) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
        expect(screen.queryByRole('list', { name: 'Accounts found' })).toBeNull();
    });

    it('lists the mainnet networks by default, each the device signs an on switch with its reason', async () => {
        await reachAccounts();

        const list = screen.getByRole('list', { name: 'Networks' });
        const ids = [...list.querySelectorAll('li')].map((li) => li.getAttribute('data-chain-id'));
        expect(ids.sort()).toEqual(['bitcoin-mainnet', 'dogecoin-mainnet', 'litecoin-mainnet']);
        const switches = within(list).getAllByRole('switch');
        expect(switches.map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true']);
        expect(within(list).getByRole('switch', { name: 'Bitcoin' })).toBeChecked();
        expect(within(list).getAllByText(/^Supported by /).length).toBe(3);
    });

    it('renders the standard coin icon for every network and address row', async () => {
        await reachAccounts();

        const expected = [
            ['bitcoin-mainnet', 'BTC', 'Bitcoin'],
            ['litecoin-mainnet', 'LTC', 'Litecoin'],
            ['dogecoin-mainnet', 'DOGE', 'Dogecoin'],
        ];
        const networks = screen.getByRole('list', { name: 'Networks' });
        for (const [chainId] of expected) {
            const row = networks.querySelector(`li[data-chain-id="${chainId}"]`);
            expect(row.querySelector(`img[src="${chainIconLargeUrl(chainId)}"]`)).not.toBeNull();
        }

        fireEvent.click(screen.getByRole('tab', { name: 'Addresses' }));
        const addresses = await screen.findByRole('list', { name: 'Addresses' });
        await waitFor(() => expect(addresses.querySelectorAll('li[data-chain-id]')).toHaveLength(3));
        for (const [chainId, ticker, chainName] of expected) {
            const row = addresses.querySelector(`li[data-chain-id="${chainId}"]`);
            const icon = within(row).getByRole('img', { name: `${ticker} on ${chainName}` });
            expect(icon.querySelector('img')).toHaveAttribute('src', chainIconLargeUrl(chainId));
        }
    });

    it('lists the testnet networks when the wallet is on Testnet, with a red X and the reason where the device cannot sign', async () => {
        await reachAccounts({
            messaging: api({ getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'testnet' }) }),
        });

        const list = screen.getByRole('list', { name: 'Networks' });
        const rows = [...list.querySelectorAll('li')];
        expect(rows.map((li) => li.getAttribute('data-chain-id')).sort())
            .toEqual(['bitcoin-testnet', 'dogecoin-testnet', 'litecoin-testnet']);
        const litecoin = rows.find((li) => li.getAttribute('data-chain-id') === 'litecoin-testnet');
        expect(within(litecoin).getByRole('img', { name: 'Not supported' })).toBeInTheDocument();
        expect(litecoin).toHaveTextContent('No Litecoin testnet app on this device.');
        expect(litecoin).toHaveTextContent('Litecoin Testnet');
    });

    it('makes a Ledger network waiting for its app one chevron row with no inline button', async () => {
        const signer = new MockHardwareSigner({ vendor: 'ledger' });
        mount({
            signer,
            pairLedger: vi.fn().mockResolvedValue({
                signer,
                pairingInfo: {
                    vendor: 'ledger',
                    model: 'nanoX',
                    deviceIdentifier: 'ledger-1',
                    firmwareVersion: '2.2.3',
                    chainIds: ['bitcoin-mainnet'],
                },
            }),
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Ledger/ }));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        });

        const networks = await screen.findByRole('list', { name: 'Networks' });
        const litecoin = networks.querySelector('li[data-chain-id="litecoin-mainnet"]');
        const retryRow = within(litecoin).getByRole('button', { name: 'Try Again on Litecoin' });
        await waitFor(() => expect(retryRow).toBeEnabled());
        expect(retryRow).toHaveTextContent('Open the Litecoin app on your Ledger');
        expect(within(litecoin).getAllByRole('button')).toEqual([retryRow]);
        expect(retryRow.querySelector('svg path')).toHaveAttribute('d', 'm9 18 6-6-6-6');

        fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
        const accounts = screen.getByRole('list', { name: 'Accounts found' });
        const waitingAccount = accounts.querySelector('li[data-chain-id="litecoin-mainnet"]');
        expect(within(waitingAccount).getAllByRole('button')).toHaveLength(1);
        expect(within(waitingAccount).getByRole('button', { name: 'Try Again on Litecoin' }))
            .toHaveTextContent('Open the Litecoin app on your Ledger');
    });

    it('shows one Accounts row per account number with its address and network counts, never one per network', async () => {
        const { signer } = await reachAccounts({
            messaging: api({ getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'testnet' }) }),
        });

        fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
        const list = await screen.findByRole('list', { name: 'Accounts found' });
        await waitFor(() => expect(list).toHaveTextContent('2 addresses on 2 networks'));
        expect(list.querySelectorAll('li[data-account-index]')).toHaveLength(1);
        expect(list.querySelectorAll('li[data-chain-id]')).toHaveLength(0);
        const account = within(list).getByRole('switch', { name: 'Account 1' });
        expect(account).toBeChecked();
        expect(signer.calls.getAddresses).toBe(2);
    });

    it('lists Addresses in one network-ordered list with the account subtitle, AddressText and balances', async () => {
        await reachAccounts({
            messaging: api({ getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'testnet' }) }),
        });

        fireEvent.click(screen.getByRole('tab', { name: 'Addresses' }));
        expect(screen.queryByRole('heading', { name: 'Account 1' })).toBeNull();
        const list = await screen.findByRole('list', { name: 'Addresses' });
        await waitFor(() => expect(within(list).getByText('0.2481 BTC')).toBeInTheDocument());
        const chains = [...list.querySelectorAll('li[data-chain-id]')].map((li) => li.getAttribute('data-chain-id'));
        expect(chains).toEqual(['bitcoin-testnet', 'dogecoin-testnet']);

        const bitcoin = list.querySelector('li[data-chain-id="bitcoin-testnet"]');
        expect(bitcoin).toHaveTextContent('Account 1');
        // The shared AddressText carries the whole address (G99: in full where it fits).
        expect(bitcoin.querySelector('[aria-label^="mock-trezor-addr-"]')).not.toBeNull();
        const amount = within(bitcoin).getByText('0.2481 BTC');
        const fiat = within(bitcoin).getByText('$24,810.00');
        expect(amount.compareDocumentPosition(fiat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('groups address balances without dropping decimal precision', async () => {
        await reachAccounts({
            messaging: api({
                hardwareBalances: vi.fn(async ({ items }) => items.map((item) => ({
                    ...item,
                    balance: '12500.00000001',
                    fiat: null,
                }))),
            }),
        });

        fireEvent.click(screen.getByRole('tab', { name: 'Addresses' }));
        const list = await screen.findByRole('list', { name: 'Addresses' });
        await waitFor(() => expect(within(list).getAllByText(/12,500\.00000001/)).toHaveLength(3));
    });

    it('Add Account adds exactly one account row, read on every network that is on', async () => {
        const { signer, messaging } = await reachAccounts();

        fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
        const list = await screen.findByRole('list', { name: 'Accounts found' });
        await waitFor(() => expect(list).toHaveTextContent('3 addresses on 3 networks'));
        expect(list.querySelectorAll('li[data-account-index]')).toHaveLength(1);
        await act(async () => {
            fireEvent.click(within(list).getByRole('button', { name: /^Add Account/ }));
        });
        await waitFor(() => expect(signer.calls.getAddresses).toBe(6));
        const rows = [...list.querySelectorAll('li[data-account-index]')];
        expect(rows.map((li) => li.getAttribute('data-account-index'))).toEqual(['0', '1']);
        expect(within(rows[1]).getByRole('switch', { name: 'Account 2' })).toBeChecked();
        expect(rows[1]).toHaveTextContent('3 addresses on 3 networks');
        expect(messaging.hardwareBalances).toHaveBeenCalledTimes(2);

        fireEvent.click(screen.getByRole('tab', { name: 'Addresses' }));
        expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
        const addressRows = [...screen.getByRole('list', { name: 'Addresses' }).querySelectorAll('li[data-chain-id]')];
        expect(addressRows.map((row) => [
            row.getAttribute('data-chain-id'), row.getAttribute('data-account-index'),
        ])).toEqual([
            ['bitcoin-mainnet', '0'], ['bitcoin-mainnet', '1'],
            ['dogecoin-mainnet', '0'], ['dogecoin-mainnet', '1'],
            ['litecoin-mainnet', '0'], ['litecoin-mainnet', '1'],
        ]);
        expect(addressRows.map((row) => row.textContent)).toEqual([
            expect.stringContaining('Account 1'), expect.stringContaining('Account 2'),
            expect.stringContaining('Account 1'), expect.stringContaining('Account 2'),
            expect.stringContaining('Account 1'), expect.stringContaining('Account 2'),
        ]);
    });

    it('turning a network off updates every account\'s counts, the Addresses view and the save', async () => {
        const { signer, messaging } = await reachAccounts();

        fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
        await act(async () => {
            fireEvent.click(await screen.findByRole('button', { name: /^Add Account/ }));
        });
        await waitFor(() => expect(signer.calls.getAddresses).toBe(6));

        fireEvent.click(screen.getByRole('tab', { name: 'Networks' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Litecoin' }));
        expect(screen.getByRole('switch', { name: 'Litecoin' })).not.toBeChecked();

        fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
        const rows = [...screen.getByRole('list', { name: 'Accounts found' }).querySelectorAll('li[data-account-index]')];
        expect(rows.map((li) => li.textContent)).toEqual([
            expect.stringContaining('2 addresses on 2 networks'),
            expect.stringContaining('2 addresses on 2 networks'),
        ]);

        fireEvent.click(screen.getByRole('tab', { name: 'Addresses' }));
        const visibleRows = [...screen.getByRole('list', { name: 'Addresses' }).querySelectorAll('li[data-chain-id]')];
        expect(visibleRows.map((row) => [
            row.getAttribute('data-chain-id'), row.getAttribute('data-account-index'),
        ])).toEqual([
            ['bitcoin-mainnet', '0'], ['bitcoin-mainnet', '1'],
            ['dogecoin-mainnet', '0'], ['dogecoin-mainnet', '1'],
        ]);

        // Back on: what was read is kept, so no new device read.
        fireEvent.click(screen.getByRole('tab', { name: 'Networks' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Litecoin' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Dogecoin' }));
        expect(signer.calls.getAddresses).toBe(6);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Add Wallet' }));
        });
        const [input] = messaging.addHardwareWallet.mock.calls[0];
        expect(input.accounts.map((a) => `${a.chainId}:${a.accountIndex}`).sort()).toEqual([
            'bitcoin-mainnet:0', 'bitcoin-mainnet:1', 'litecoin-mainnet:0', 'litecoin-mainnet:1',
        ]);
    });

    it('reads a network turned on after Add Account at every account number it lacks', async () => {
        const { signer } = await reachAccounts();
        await waitFor(() => expect(signer.calls.getAddresses).toBe(3));

        fireEvent.click(screen.getByRole('switch', { name: 'Dogecoin' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^Add Account/ }));
        });
        // Account 2 is read only on the two networks that are on.
        await waitFor(() => expect(signer.calls.getAddresses).toBe(5));

        fireEvent.click(screen.getByRole('tab', { name: 'Networks' }));
        await act(async () => {
            fireEvent.click(screen.getByRole('switch', { name: 'Dogecoin' }));
        });
        await waitFor(() => expect(signer.calls.getAddresses).toBe(6));
        fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
        const rows = [...screen.getByRole('list', { name: 'Accounts found' }).querySelectorAll('li[data-account-index]')];
        expect(rows.map((li) => li.textContent)).toEqual([
            expect.stringContaining('3 addresses on 3 networks'),
            expect.stringContaining('3 addresses on 3 networks'),
        ]);
    });

    it('reads a network switched on while another read runs once that read settles', async () => {
        const { signer } = await reachAccounts();
        await waitFor(() => expect(signer.calls.getAddresses).toBe(3));
        fireEvent.click(screen.getByRole('switch', { name: 'Dogecoin' }));

        // No await between the clicks: Account 2 is still being read when
        // Dogecoin comes back on.
        fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
        fireEvent.click(screen.getByRole('button', { name: /^Add Account/ }));
        fireEvent.click(screen.getByRole('tab', { name: 'Networks' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Dogecoin' }));
        expect(signer.calls.getAddresses).toBeLessThan(6);
        await waitFor(() => expect(signer.calls.getAddresses).toBe(6));
        fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
        const rows = [...screen.getByRole('list', { name: 'Accounts found' }).querySelectorAll('li[data-account-index]')];
        expect(rows.map((li) => li.textContent)).toEqual([
            expect.stringContaining('3 addresses on 3 networks'),
            expect.stringContaining('3 addresses on 3 networks'),
        ]);
    });

    it('leaves an account switched off out of the save, and asks for something to be on when nothing is', async () => {
        const { signer, messaging } = await reachAccounts();

        fireEvent.click(screen.getByRole('tab', { name: 'Accounts' }));
        await act(async () => {
            fireEvent.click(await screen.findByRole('button', { name: /^Add Account/ }));
        });
        await waitFor(() => expect(signer.calls.getAddresses).toBe(6));
        fireEvent.click(screen.getByRole('switch', { name: 'Account 1' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Account 2' }));

        const add = screen.getByRole('button', { name: 'Add Wallet' });
        await act(async () => {
            fireEvent.click(add);
        });
        expect(messaging.addHardwareWallet).not.toHaveBeenCalled();
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent('Turn on at least one network and one account.');

        fireEvent.click(screen.getByRole('switch', { name: 'Account 2' }));
        expect(screen.queryByRole('alert', { name: 'Form errors' })).toBeNull();
        await act(async () => {
            fireEvent.click(add);
        });
        const [input] = messaging.addHardwareWallet.mock.calls[0];
        expect(new Set(input.accounts.map((a) => a.accountIndex))).toEqual(new Set([1]));
        expect(input.accounts).toHaveLength(3);
    });

    it('saves through addHardwareWallet in add mode, hands the live signer to the shell and reports the new wallet', async () => {
        const { messaging, signer, onCreated, onSignerPaired, onDeviceReady } = await reachAccounts();

        fireEvent.change(screen.getByLabelText('Wallet name', { selector: 'input' }), { target: { value: '  Desk Trezor  ' } });
        const add = screen.getByRole('button', { name: 'Add Wallet' });
        expect(add).toHaveClass(buttonStyles.success);
        expect(add.querySelector('svg')).toBeInTheDocument();
        await waitFor(() => expect(add).toBeEnabled());
        await act(async () => {
            fireEvent.click(add);
        });

        expect(messaging.addHardwareWallet).toHaveBeenCalledOnce();
        const [input] = messaging.addHardwareWallet.mock.calls[0];
        expect(input.name).toBe('Desk Trezor');
        expect(input.device).toEqual({
            vendor: 'trezor',
            model: 'T2B1',
            deviceIdentifier: 'device-1',
            firmwareVersion: '2.7.2',
        });
        expect(input.accounts.map((a) => a.chainId).sort()).toEqual(['bitcoin-mainnet', 'dogecoin-mainnet', 'litecoin-mainnet']);
        expect(input.accounts[0]).toEqual(expect.objectContaining({
            accountIndex: 0,
            address: expect.stringMatching(/^mock-trezor-addr-0-0-0$/),
            publicKey: expect.any(String),
            derivationPath: expect.any(String),
            addressType: expect.any(String),
        }));
        expect(input).not.toHaveProperty('vault');
        expect(onSignerPaired).toHaveBeenCalledWith('signer-hw-1', signer);
        expect(onCreated).toHaveBeenCalledWith('wallet-hw-1');
        expect(onDeviceReady).not.toHaveBeenCalled();
    });

    it('hands the wallet to the caller in first mode for the Set Password page', async () => {
        const messaging = api();
        const signer = new MockHardwareSigner({ vendor: 'trezor' });
        const onDeviceReady = vi.fn();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PairSignerForm
                    mode="first"
                    pairTrezor={vi.fn(async () => ({ signer, pairingInfo: PAIRING_INFO }))}
                    pairLedger={null}
                    onBack={vi.fn()}
                    onDeviceReady={onDeviceReady}
                />
            </MessagingProvider>,
        );
        await pickTrezor();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        });
        const add = screen.getByRole('button', { name: 'Add Wallet' });
        await waitFor(() => expect(add).toBeEnabled());
        await act(async () => {
            fireEvent.click(add);
        });

        expect(messaging.addHardwareWallet).not.toHaveBeenCalled();
        expect(onDeviceReady).toHaveBeenCalledWith(expect.objectContaining({
            name: 'My Trezor',
            device: expect.objectContaining({ vendor: 'trezor', deviceIdentifier: 'device-1' }),
            accounts: expect.arrayContaining([expect.objectContaining({ chainId: 'bitcoin-mainnet' })]),
            signer,
        }));
    });

    it('asks for a wallet name before saving', async () => {
        const { messaging } = await reachAccounts();

        fireEvent.change(screen.getByLabelText('Wallet name', { selector: 'input' }), { target: { value: '   ' } });
        const add = screen.getByRole('button', { name: 'Add Wallet' });
        await waitFor(() => expect(add).toBeEnabled());
        await act(async () => {
            fireEvent.click(add);
        });
        const field = screen.getByLabelText('Wallet name', { selector: 'input' });
        const summary = screen.getByRole('alert', { name: 'Form errors' });
        expect(summary).toHaveTextContent('Fix 1 thing to continue');
        expect(summary).toHaveTextContent('Enter a wallet name.');
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(document.getElementById('hardware-wallet-name-error')).toHaveTextContent('Enter a wallet name.');
        expect(messaging.addHardwareWallet).not.toHaveBeenCalled();

        fireEvent.change(field, { target: { value: 'Desk Trezor' } });
        expect(screen.queryByRole('alert', { name: 'Form errors' })).toBeNull();
        expect(document.getElementById('hardware-wallet-name-error')).toBeNull();
        expect(field).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('keeps the page and shows the reason when saving fails', async () => {
        const { onCreated } = await reachAccounts({
            messaging: api({ addHardwareWallet: vi.fn().mockRejectedValue(new Error('Vault is busy.')) }),
        });

        const add = screen.getByRole('button', { name: 'Add Wallet' });
        await waitFor(() => expect(add).toBeEnabled());
        await act(async () => {
            fireEvent.click(add);
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Vault is busy.');
        expect(onCreated).not.toHaveBeenCalled();
    });

    it('goes back from Accounts to Connect with the statuses still done', async () => {
        await reachAccounts();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(currentStep()).toBe('Step 2 of 3: Connect');
        expect(statusStates()).toEqual(['done', 'done', 'done']);
    });
});
