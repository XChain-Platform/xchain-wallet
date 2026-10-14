// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { userEvent } from '../../helpers/userEvent.js';

const showToast = vi.fn();
const { qrToDataURL } = vi.hoisted(() => ({
    qrToDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
}));

vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast, dismissToast: () => {}, clearToasts: () => {} }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useFiatRate: () => ({ rate: 50000, fiatCurrency: 'USD' }),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: qrToDataURL },
}));

const { Receive } = await import('../../../packages/core/src/shared/routes/Receive.jsx');
const { ReceivePicker } = await import('../../../packages/core/src/shared/routes/ReceivePicker.jsx');

const ADDRESS = {
    id: 'address-1',
    address: 'bcrt1qkeyboard',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    label: 'Deposits',
};

const SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: { 'bitcoin-regtest': { strategy: 'normal' } },
};

function renderReceive(overrides = {}, props = {}) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-regtest': [ADDRESS] }),
        getNewestAddress: vi.fn().mockResolvedValue(ADDRESS),
        ...overrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Receive walletId="wallet-1" accountId="account-1" {...props} />
        </MessagingProvider>,
    );
    return messaging;
}

function renderReceivePicker(onSelect) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [{ address: 'bc1qkeyboard' }],
            'litecoin-mainnet': [{ address: 'ltc1qkeyboard' }],
        }),
        getWalletBalances: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [{
                address: 'bc1qkeyboard',
                balances: { native: { tick: 'BTC', quantity: '1', divisibility: 8 }, tokens: [] },
            }],
            'litecoin-mainnet': [{
                address: 'ltc1qkeyboard',
                balances: { native: { tick: 'LTC', quantity: '1', divisibility: 8 }, tokens: [] },
            }],
        }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ReceivePicker walletId="wallet-1" onBack={() => {}} onSelect={onSelect} />
        </MessagingProvider>,
    );
}

beforeEach(() => {
    qrToDataURL.mockClear();
    showToast.mockClear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete globalThis.ClipboardItem;
    delete navigator.clipboard;
    delete navigator.share;
});

describe('Receive keyboard operation', () => {
    it('selects a chain and token without leaving the keyboard', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        renderReceivePicker(onSelect);

        const search = screen.getByRole('searchbox', { name: 'Search coins or tokens' });
        await screen.findByRole('button', { name: /^Select Bitcoin\b/ });
        expect(document.activeElement).toBe(search);

        await user.tab();
        const chainPicker = screen.getByRole('button', { name: /All networks/ });
        expect(document.activeElement).toBe(chainPicker);
        await user.keyboard('{Enter}');
        // Opening the list moves focus to the selected option.
        expect(document.activeElement).toBe(screen.getByRole('option', { name: /^All networks/ }));
        // The open list is a listbox: arrow keys move between options and Tab leaves it.
        await user.keyboard('{ArrowDown}');
        expect(document.activeElement).toBe(screen.getByRole('option', { name: /^Bitcoin/ }));
        await user.keyboard('{ArrowDown}');
        const litecoin = screen.getByRole('option', { name: /^Litecoin/ });
        expect(document.activeElement).toBe(litecoin);
        await user.keyboard('{Enter}');

        expect(document.activeElement).toBe(chainPicker);
        // Kind tabs use a roving tabindex: only the selected tab is a tab stop.
        const kindTabs = screen.getAllByRole('tab').filter((tab) => tab.getAttribute('tabindex') !== '-1');
        for (const tab of kindTabs) {
            await user.tab();
            expect(document.activeElement).toBe(tab);
        }
        await user.tab();
        const token = screen.getByRole('button', { name: /^Select Litecoin\b/ });
        expect(document.activeElement).toBe(token);
        await user.keyboard('{Enter}');

        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'litecoin-mainnet',
            tick: 'LTC',
            kind: 'native',
        }));
    });

    it('tabs through controls in their visual order', async () => {
        const user = userEvent.setup();
        renderReceive();

        const addressType = await screen.findByRole('combobox', { name: 'Address type' });
        addressType.focus();
        // The QR actions sit together below the address and above the request fields.
        const expected = [
            screen.getByRole('textbox', { name: 'Deposits' }),
            screen.getByRole('button', { name: 'Choose receive address' }),
            screen.getByRole('button', { name: 'Copy payment link' }),
            screen.getByRole('button', { name: 'Share QR payment link' }),
            screen.getByRole('link', { name: 'View address in block explorer' }),
            screen.getByRole('button', { name: 'Generate new address' }),
            screen.getByRole('textbox', { name: 'Address label' }),
            screen.getByRole('button', { name: /^Token:/ }),
            screen.getByRole('textbox', { name: 'Amount (BTC)' }),
        ];

        for (const control of expected) {
            await user.tab();
            expect(document.activeElement).toBe(control);
        }
    });

    it.each([360, 1280])('tabs through the wrapping hero in visual order at %ipx', async (viewportWidth) => {
        const user = userEvent.setup();
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });

        try {
            renderReceive();

            const addressType = await screen.findByRole('combobox', { name: 'Address type' });
            const copy = await screen.findByRole('button', { name: 'Copy payment link' });
            await waitFor(() => expect(copy).not.toBeDisabled());
            addressType.focus();
            const expected = [
                screen.getByRole('textbox', { name: 'Deposits' }),
                screen.getByRole('button', { name: 'Choose receive address' }),
                copy,
                screen.getByRole('button', { name: 'Share QR payment link' }),
                screen.getByRole('link', { name: 'View address in block explorer' }),
                screen.getByRole('button', { name: 'Generate new address' }),
                screen.getByRole('textbox', { name: 'Address label' }),
                screen.getByRole('button', { name: /^Token:/ }),
                screen.getByRole('textbox', { name: 'Amount (BTC)' }),
            ];

            for (const control of expected) {
                await user.tab();
                expect(document.activeElement).toBe(control);
            }
        } finally {
            cleanup();
            if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
            else delete window.innerWidth;
        }
    });

    it('enters an amount and activates copy and share in visual order', async () => {
        const user = userEvent.setup();
        const write = vi.fn().mockResolvedValue(undefined);
        const writeText = vi.fn().mockResolvedValue(undefined);
        const share = vi.fn().mockResolvedValue(undefined);
        globalThis.ClipboardItem = class ClipboardItem {
            constructor(items) { this.items = items; }
        };
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { write, writeText, readText: vi.fn().mockResolvedValue('') },
        });
        Object.defineProperty(navigator, 'share', { configurable: true, value: share });
        renderReceive();

        const amount = await screen.findByRole('textbox', { name: 'Amount (BTC)' });
        const copy = await screen.findByRole('button', { name: 'Copy QR code' });
        await waitFor(() => expect(copy).not.toBeDisabled());
        fireEvent.change(amount, { target: { value: '1.25' } });
        amount.focus();
        await user.keyboard('{Enter}');
        expect(amount).toHaveValue('1.25');

        const expected = [
            screen.getByRole('button', { name: 'Paste from clipboard' }),
            screen.getByRole('button', { name: 'Switch input to USD' }),
        ];
        for (const control of expected) {
            await user.tab();
            expect(document.activeElement).toBe(control);
        }

        // The QR actions sit in the hero above the request fields.
        copy.focus();
        await user.keyboard('{Enter}');
        await waitFor(() => expect(write).toHaveBeenCalledOnce());
        expect(writeText).not.toHaveBeenCalled();
        await user.tab();
        const shareButton = screen.getByRole('button', { name: 'Share QR payment link' });
        expect(document.activeElement).toBe(shareButton);
        await user.keyboard('{Enter}');
        await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({
            url: expect.stringContaining('amount=1.25'),
        })));
    });

    it('uses the selected asset divisibility without changing the request amount', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({ tick: 'WHOLE', divisibility: 0 });
        renderReceive({ getTokenInfo }, {
            prefill: {
                chainId: 'bitcoin-regtest',
                tick: 'WHOLE',
                kind: 'token',
            },
        });

        const amount = await screen.findByRole('textbox', { name: 'Amount (WHOLE)' });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest',
            tick: 'WHOLE',
            demo: false,
        }));
        await act(async () => { await getTokenInfo.mock.results[0].value; });
        fireEvent.change(amount, { target: { value: '1.5' } });

        expect(amount).toHaveValue('');
        expect(screen.getByText('Amount can have at most 0 decimal places.')).toBeInTheDocument();

        fireEvent.change(amount, { target: { value: '15' } });
        expect(amount).toHaveValue('15');
        await waitFor(() => expect(qrToDataURL).toHaveBeenLastCalledWith(
            expect.stringContaining('amount=15'),
            expect.any(Object),
        ));
    });

    it('keeps a fractional request amount when the explorer omits divisibility', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({ tick: 'NODECIMALS', divisibility: null });
        renderReceive({ getTokenInfo }, {
            prefill: {
                chainId: 'bitcoin-regtest',
                tick: 'NODECIMALS',
                kind: 'token',
            },
        });

        const amount = await screen.findByRole('textbox', { name: 'Amount (NODECIMALS)' });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalled());
        await act(async () => { await getTokenInfo.mock.results[0].value; });
        fireEvent.change(amount, { target: { value: '0.5' } });

        expect(amount).toHaveValue('0.5');
        expect(screen.queryByText(/Amount can have at most/)).toBeNull();
        await waitFor(() => expect(qrToDataURL).toHaveBeenLastCalledWith(
            expect.stringContaining('amount=0.5'),
            expect.any(Object),
        ));
        await act(async () => {});
        expect(amount).toHaveValue('0.5');
    });

    it('saves a label with Enter and cancels a later draft with Escape', async () => {
        const user = userEvent.setup();
        const setAddressLabel = vi.fn().mockResolvedValue({ ok: true });
        renderReceive({ setAddressLabel });

        const label = await screen.findByRole('textbox', { name: 'Address label' });
        label.focus();
        fireEvent.change(label, { target: { value: 'Client invoices' } });
        await user.keyboard('{Enter}');
        await waitFor(() => expect(setAddressLabel).toHaveBeenCalledWith(
            ADDRESS.id,
            'Client invoices',
        ));
        expect(label).toHaveValue('Client invoices');

        fireEvent.change(label, { target: { value: 'Discard this draft' } });
        await user.keyboard('{Escape}');
        expect(label).toHaveValue('Client invoices');
        expect(setAddressLabel).toHaveBeenCalledTimes(1);
    });
});
