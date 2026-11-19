// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// View Address (AddressDetail, rendered by AddressList): the approved
// Layout 1 identity card, its Actions tiles and their gating, the Edit label
// form, Delete with its confirm and Undo, the Secret key hand-off, and the
// Details rows.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';

const WALLET = { id: 'wallet-a', name: 'Main Wallet', format: 'bip39' };
const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };
const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qdevm0000000000000000000000000000001ca490';
const WATCH = 'bcrt1q9wk30000000000000000000000000000000x7m2ds';

const HD = {
    id: 'addr-1',
    address: ADDRESS,
    label: 'BTC Address #1',
    source: 'hd',
    addressType: 'p2wpkh',
    role: 'receive',
    hidden: false,
    derivationPath: "m/84'/1'/0'/0/0",
    accountId: ACCOUNT.id,
};
const WATCH_ONLY = {
    id: 'addr-watch',
    address: WATCH,
    label: 'Cold storage (watch)',
    source: 'watch-only',
    addressType: 'p2wpkh',
    role: 'receive',
    hidden: true,
    accountId: ACCOUNT.id,
};

function messagingWith(overrides = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{ address: ADDRESS, balances: { native: { tick: 'BTC', quantity: '5000000000', divisibility: 8 }, tokens: [] } }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'addr-1', address: ADDRESS } }),
        setActiveAddress: vi.fn().mockResolvedValue({ ok: true }),
        setAddressHidden: vi.fn().mockResolvedValue({ ok: true }),
        setAddressLabel: vi.fn(async (_id, label) => ({ label })),
        deleteAddress: vi.fn().mockResolvedValue({ ok: true }),
        restoreAddress: vi.fn().mockResolvedValue({ ok: true }),
        exportPrivateKey: vi.fn(),
        getAddressPreferences: vi.fn().mockResolvedValue({
            onChain: false,
            feePreference: 0,
            requireMemo: false,
            dispenserPreference: 0,
        }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [HD, WATCH_ONLY] }),
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
                    onReceive={vi.fn()}
                    onShowPrivateKey={vi.fn()}
                    onEditPreferences={vi.fn()}
                    {...props}
                />
            </ToastHost>
        </MessagingProvider>,
    );
}

async function open(address) {
    // A hidden address sits behind the list's hidden-address toggle.
    const row = await screen.findByRole('button', { name: `View address ${address}` }).catch(async () => {
        fireEvent.click(await screen.findByRole('button', { name: /Show 1 Hidden Address/ }));
        return screen.findByRole('button', { name: `View address ${address}` });
    });
    fireEvent.click(row);
    await screen.findByRole('tablist');
}

// The address row's box and the text's measured width, as AddressText's fit
// mode reads them: the row is `rowWidth` wide and each character is 10px.
function mockAddressRow(rowWidth) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function width() {
        return this.dataset?.testid === 'address-detail-address' ? rowWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function bounds() {
        const w = this.hasAttribute('data-address-measure') ? this.textContent.length * 10 : 0;
        return { width: w, height: 0, top: 0, right: w, bottom: 0, left: 0, x: 0, y: 0, toJSON() {} };
    });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('View Address identity card', () => {
    it('stacks the label title, then the network icon beside the QR, then the address', async () => {
        mount(messagingWith());
        await open(ADDRESS);

        const card = screen.getByRole('region', { name: 'Address' });
        const title = within(card).getByRole('heading', { level: 2, name: 'BTC Address #1' });
        const pair = within(card).getByTestId('address-detail-pair');
        const address = within(card).getByTestId('address-detail-address');
        // Document order: title, pair, address.
        expect(title.compareDocumentPosition(pair) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(pair.compareDocumentPosition(address) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // Icon first (left), QR second (right).
        const [icon, qr] = Array.from(pair.children);
        expect(icon).toHaveAttribute('data-testid', 'address-detail-network-icon');
        expect(within(icon).getByRole('img', { name: /Bitcoin/ })).toBeInTheDocument();
        expect(qr).toHaveAttribute('data-testid', 'address-detail-qr');
        expect(await within(qr).findByRole('img', { name: 'QR code for this address' })).toBeInTheDocument();
        expect(within(address).getByLabelText(ADDRESS)).toBeInTheDocument();
        expect(within(address).getByRole('button', { name: 'Copy Address' })).toBeInTheDocument();
    });

    it('carries no network or Active pills', async () => {
        mount(messagingWith());
        await open(ADDRESS);

        const card = screen.getByRole('region', { name: 'Address' });
        expect(within(card).queryByText('Active')).toBeNull();
        expect(within(card).queryByText(/^ACTIVE$/i)).toBeNull();
        expect(within(card).queryByText('Bitcoin')).toBeNull();
        expect(within(card).queryByText(/Bitcoin Regtest/i)).toBeNull();
    });

    it('shows the whole address when it fits its row', async () => {
        mockAddressRow(1000);
        mount(messagingWith());
        await open(ADDRESS);

        const text = within(screen.getByTestId('address-detail-address')).getByLabelText(ADDRESS);
        expect(text).toHaveTextContent(ADDRESS);
        expect(text.textContent).not.toContain('…');
    });

    it('cuts only the middle, and only as much as needed, when the row is too narrow', async () => {
        // 300px: 29 characters fit (14 + ellipsis + 14).
        mockAddressRow(300);
        mount(messagingWith());
        await open(ADDRESS);

        const text = within(screen.getByTestId('address-detail-address')).getByLabelText(ADDRESS);
        expect(text).toHaveTextContent(`${ADDRESS.slice(0, 14)}…${ADDRESS.slice(-14)}`);
        // Copy still writes the whole address.
        const setData = vi.fn();
        fireEvent.copy(text, { clipboardData: { setData } });
        expect(setData).toHaveBeenCalledWith('text/plain', ADDRESS);
    });
});

// Each ActionList row's title, without the description line under it.
const rowTitles = (list) => within(list).getAllByRole('button')
    .map((b) => b.querySelector('[class*="titleText"]').textContent.trim());

describe('View Address Actions list (G101)', () => {
    it('offers the approved rows in order on the active address, with no Set active', async () => {
        mount(messagingWith());
        await open(ADDRESS);

        const list = screen.getByRole('list', { name: 'Actions' });
        expect(rowTitles(list)).toEqual(['Receive', 'Edit label', 'On-chain prefs', 'Hide', 'Secret key', 'Explorer', 'Delete']);
    });

    it('locks Secret key on a watch-only address, says why, and offers Set active and Unhide', async () => {
        mount(messagingWith());
        await open(WATCH);

        const list = screen.getByRole('list', { name: 'Actions' });
        expect(rowTitles(list)).toEqual(['Receive', 'Edit label', 'On-chain prefs', 'Unhide', 'Set active', 'Secret key', 'Explorer', 'Delete']);
        const secret = within(list).getByRole('button', { name: /^Secret key/ });
        // An off ActionList row stays focusable and announces why it is off.
        expect(secret).toHaveAttribute('aria-disabled', 'true');
        expect(secret).toHaveAccessibleDescription('No key in this wallet');
        expect(screen.getByText('No key in this wallet')).toBeInTheDocument();
    });

    it('marks Delete as the one danger row', async () => {
        mount(messagingWith());
        await open(ADDRESS);

        const list = screen.getByRole('list', { name: 'Actions' });
        const danger = within(list).getAllByRole('button').filter((b) => b.getAttribute('data-tone') === 'danger');
        expect(danger.map((b) => b.querySelector('[class*="titleText"]').textContent.trim())).toEqual(['Delete']);
    });

    it('hands Secret key to the reveal screen, which keeps its own password gate, and reveals nothing here', async () => {
        const onShowPrivateKey = vi.fn();
        const messaging = messagingWith();
        mount(messaging, { onShowPrivateKey });
        await open(ADDRESS);

        fireEvent.click(screen.getByRole('button', { name: /^Secret key/ }));
        expect(onShowPrivateKey).toHaveBeenCalledTimes(1);
        expect(onShowPrivateKey.mock.calls[0][0]).toMatchObject({ id: 'addr-1', address: ADDRESS });
        expect(messaging.exportPrivateKey).not.toHaveBeenCalled();
    });

    it('hands Receive and On-chain prefs the address shown', async () => {
        const onReceive = vi.fn();
        const onEditPreferences = vi.fn();
        mount(messagingWith(), { onReceive, onEditPreferences });
        await open(ADDRESS);

        fireEvent.click(screen.getByRole('button', { name: /^Receive/ }));
        expect(onReceive).toHaveBeenCalledWith({ chainId: CHAIN, address: ADDRESS });
        fireEvent.click(screen.getByRole('button', { name: /^On-chain prefs/ }));
        expect(onEditPreferences).toHaveBeenCalledWith({ chainId: CHAIN, address: ADDRESS });
    });

    it('saves a new label from the Edit label form', async () => {
        const messaging = messagingWith();
        mount(messaging);
        await open(ADDRESS);

        fireEvent.click(screen.getByRole('button', { name: /^Edit label/ }));
        expect(screen.getByRole('heading', { name: 'Edit Label' })).toBeInTheDocument();
        const field = screen.getByRole('textbox', { name: 'Address label' });
        expect(field).toHaveValue('BTC Address #1');
        fireEvent.change(field, { target: { value: 'Savings' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Label' }));

        await waitFor(() => expect(messaging.setAddressLabel).toHaveBeenCalledWith('addr-1', 'Savings'));
        expect(await screen.findByRole('heading', { level: 2, name: 'Savings' })).toBeInTheDocument();
    });

    it('deletes after the confirm, then Undo puts the same record back', async () => {
        const messaging = messagingWith();
        mount(messaging);
        await open(ADDRESS);

        fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
        const dialog = await screen.findByRole('dialog', { name: /Delete this address\?/ });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(messaging.deleteAddress).toHaveBeenCalledWith('addr-1'));
        const undo = await screen.findByRole('button', { name: 'Undo' });
        await act(async () => { fireEvent.click(undo); });
        await waitFor(() => expect(messaging.restoreAddress).toHaveBeenCalledWith(expect.objectContaining({ id: 'addr-1', address: ADDRESS })));
    });

    it('keeps the address when the confirm is cancelled', async () => {
        const messaging = messagingWith();
        mount(messaging);
        await open(ADDRESS);

        fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
        const dialog = await screen.findByRole('dialog', { name: /Delete this address\?/ });
        fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/ }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(messaging.deleteAddress).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /^Delete/ })).not.toHaveAttribute('aria-disabled');
    });
});

describe('View Address Details tab', () => {
    it('lists the facts label-left value-right in order, then the on-chain preferences', async () => {
        mount(messagingWith());
        await open(ADDRESS);
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));

        const facts = screen.getByRole('region', { name: 'Details' });
        // The label's own text, without its ? tip.
        const labels = Array.from(facts.querySelectorAll('dt')).map((dt) => dt.firstChild.textContent.trim());
        // "Account path" is the plain-language name for the derivation path.
        expect(labels).toEqual(['Network', 'Balance', 'Type', 'Address format', 'Account path']);
        expect(screen.getByRole('button', { name: 'Account path help' })).toBeInTheDocument();
        expect(screen.getByTestId('address-detail-balance')).toHaveTextContent('50.00000000 BTC');
        expect(screen.getByTestId('address-detail-type')).toHaveTextContent('Normal');
        expect(screen.getByTestId('address-detail-derivation-path')).toHaveTextContent("m/84'/1'/0'/0/0");

        const prefs = await screen.findByRole('region', { name: 'On-chain preferences' });
        const prefLabels = Array.from(prefs.querySelectorAll('dt')).map((dt) => dt.textContent.trim());
        expect(prefLabels).toEqual(['Protocol fee', 'Incoming sends', 'Dispensers']);
        // A plain sentence-case group heading, no uppercase section label.
        expect(within(prefs).getByRole('heading', { name: 'On-chain preferences' })).toBeInTheDocument();
        expect(screen.queryByText('ON-CHAIN PREFERENCES')).toBeNull();
        expect(screen.queryByRole('heading', { name: 'About' })).toBeNull();
    });
});
