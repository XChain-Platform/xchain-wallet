// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'a1', address: 'bc1qexample', publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's1',
};

afterEach(() => cleanup());

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function balances({ xchain = '1000', xchainDivisibility = 2, btc = '500000000' } = {}) {
    return {
        [CHAIN]: [{
            address: ADDRESS.address,
            balances: {
                native: { tick: 'BTC', quantity: btc, divisibility: 8 },
                tokens: [{ tick: 'XCHAIN', quantity: xchain, divisibility: xchainDivisibility }],
            },
        }],
    };
}

function mount(props = {}, overrides = {}, viewportWidth = null) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS.id }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        composeForConfirm: vi.fn(),
        ...overrides,
    };
    const panel = (
        <MessagingProvider shell="desktop" messaging={messaging}>
            <PlaceOrderPanel walletId="w" chainId={CHAIN} tick1="XCHAIN" tick2="BTC" {...props} />
        </MessagingProvider>
    );
    render(viewportWidth ? <div style={{ width: viewportWidth }}>{panel}</div> : panel);
    return messaging;
}

function pressEnter(button) {
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' });
    button.click();
    fireEvent.keyUp(button, { key: 'Enter', code: 'Enter' });
}

describe('PlaceOrderPanel validation', () => {
    it('gates order review while wallet balances are loading', async () => {
        const balanceRequest = deferred();
        mount({}, { getWalletBalances: vi.fn(() => balanceRequest.promise) });

        expect(screen.getByRole('status')).toHaveTextContent('Loading wallet balances…');
        const loadingSubmit = screen.getByRole('button', { name: 'Place buy order' });
        expect(loadingSubmit).toBeDisabled();
        expect(loadingSubmit).toHaveAttribute('aria-busy', 'true');

        await act(async () => balanceRequest.resolve({}));

        await waitFor(() => {
            expect(screen.queryByText('Loading wallet balances…')).toBeNull();
        });
        expect(screen.getByRole('button', { name: 'Place buy order' })).toBeEnabled();
    });

    it('rejects numeric syntax that cannot be serialized as a protocol decimal', async () => {
        const messaging = mount({ prefillPrice: '1e3' });
        await waitFor(() => expect(screen.getByLabelText('Price (BTC)').value).toBe('1e3'));
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place buy order' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Price and size must be positive numbers.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('uses a consent checkbox for CoinPay auto-pay', async () => {
        mount();

        const consent = await screen.findByRole('checkbox', {
            name: /Enable CoinPay auto-pay/,
        });
        expect(consent).toBeChecked();
        fireEvent.click(consent);
        expect(consent).not.toBeChecked();
    });

    it('rejects wire amounts with more precision than either market asset supports', async () => {
        const messaging = mount({}, {
            getWalletBalances: vi.fn().mockResolvedValue(balances()),
        });
        fireEvent.click(await screen.findByRole('radio', { name: 'Sell XCHAIN' }));
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '1.001' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place sell order' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Size can have at most 2 decimal places for XCHAIN.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '0.000000001' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place sell order' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Price and size total can have at most 8 decimal places for BTC.',
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects a give amount above the funding address balance before review', async () => {
        const messaging = mount({}, {
            getWalletBalances: vi.fn().mockResolvedValue(balances({ xchain: '1000' })),
        });
        fireEvent.click(await screen.findByRole('radio', { name: 'Sell XCHAIN' }));
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '10.01' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place sell order' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Give amount exceeds your available XCHAIN balance of 10.',
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('uses token metadata to validate a receive-side asset absent from wallet balances', async () => {
        const messaging = mount({ tick2: 'OTHER' }, {
            getWalletBalances: vi.fn().mockResolvedValue(balances()),
            getTokenInfo: vi.fn(async ({ tick }) => ({ divisibility: tick === 'OTHER' ? 1 : 2 })),
        });
        fireEvent.click(await screen.findByRole('radio', { name: 'Sell XCHAIN' }));
        fireEvent.change(screen.getByLabelText('Price (OTHER)'), { target: { value: '0.01' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '1' } });
        await waitFor(() => expect(messaging.getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'OTHER' })));
        fireEvent.click(screen.getByRole('button', { name: 'Place sell order' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Price and size total can have at most 1 decimal place for OTHER.',
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('accepts grouped decimal entry and selects the order side as a radio group', async () => {
        mount();
        const price = await screen.findByLabelText('Price (BTC)');
        fireEvent.change(price, { target: { value: '1,234.5' } });
        expect(price.value).toBe('1234.5');
        expect(price.style.textAlign).toBe('right');
        expect(price.style.fontVariantNumeric).toBe('tabular-nums');

        const buy = screen.getByRole('radio', { name: 'Buy XCHAIN' });
        const sell = screen.getByRole('radio', { name: 'Sell XCHAIN' });
        expect(buy.parentElement.className).toMatch(/sideToggle/);
        expect(buy).toHaveAttribute('aria-checked', 'true');
        expect(buy).toHaveAttribute('data-tone', 'success');
        expect(sell).toHaveAttribute('data-tone', 'danger');
        fireEvent.keyDown(buy, { key: 'ArrowRight' });
        expect(sell).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('button', { name: 'Place sell order' })).toBeEnabled();

        const expiration = screen.getByRole('combobox', { name: 'Expiration' });
        fireEvent.change(expiration, { target: { value: 'custom' } });
        expect(screen.getByLabelText('Custom expiration')).toBeInTheDocument();
    });

    it('renders the 360px layout hooks for stacked fields and a visible side toggle', async () => {
        mount({}, {}, 360);

        await screen.findByLabelText('Price (BTC)');
        expect(screen.getByRole('radiogroup', { name: 'Order side' }).className).toMatch(/sideToggle/);
        expect(screen.getByRole('group', { name: 'Price and amount' }).className).toMatch(/priceAmountFields/);

        const tradingCss = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/MarketTrading.module.css',
        ), 'utf8');
        expect(tradingCss).toMatch(/\.levelsScroller\s*\{[^}]*overflow-x:\s*auto/s);
        expect(tradingCss).toMatch(
            /@media \(max-width: 420px\)[\s\S]*?\.orderBookGrid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
        );
        expect(tradingCss).toMatch(
            /@media \(max-width: 420px\)[\s\S]*?\.priceAmountFields\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
        );
        expect(tradingCss).toMatch(
            /@media \(max-width: 420px\)[\s\S]*?\.sideToggle\s*\{[^}]*position:\s*sticky/,
        );

        const ordersCss = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/routes/ObligationsView.module.css',
        ), 'utf8');
        expect(ordersCss).toMatch(
            /@media \(max-width: 420px\)[\s\S]*?\.row\s*\{[^}]*flex-direction:\s*column/,
        );
        expect(ordersCss).toMatch(/\.rowActions\s*\{[^}]*flex-wrap:\s*wrap/s);
    });

    it('builds an unsigned order from a watch-only address', async () => {
        const watchAddress = { ...ADDRESS, source: 'watch' };
        const onOrderPlaced = vi.fn();
        const buildActionPsbtRequest = vi.fn().mockResolvedValue({
            psbtHex: 'aa00', encoding: 'psbt', fromAddress: watchAddress.address, chainId: CHAIN,
        });
        mount({ onOrderPlaced }, {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [watchAddress] }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            buildActionPsbtRequest,
        });

        fireEvent.change(await screen.findByLabelText('Price (BTC)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '3' } });
        pressEnter(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create unsigned transaction' }));

        expect(await screen.findByLabelText('Unsigned transaction hex')).toHaveValue('aa00');
        expect(buildActionPsbtRequest).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN,
            actionData: expect.objectContaining({ action: 'ORDER' }),
        }));
        expect(onOrderPlaced).not.toHaveBeenCalled();
    });

    it('keeps a rejected order retryable without exposing the raw error', async () => {
        const watchAddress = { ...ADDRESS, source: 'watch' };
        const buildActionPsbtRequest = vi.fn()
            .mockRejectedValueOnce(new Error('orderAction: POST https://node.invalid/api/order returned 500'))
            .mockResolvedValue({
                psbtHex: 'aa00', encoding: 'psbt', fromAddress: watchAddress.address, chainId: CHAIN,
            });
        mount({}, {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [watchAddress] }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            buildActionPsbtRequest,
        });

        fireEvent.change(await screen.findByLabelText('Price (BTC)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '3' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create unsigned transaction' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Couldn't place this order. Something went wrong. Try again.",
        );
        expect(document.body).not.toHaveTextContent('node.invalid');
        expect(screen.getByText('Give 6 BTC, get 3 XCHAIN')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Create unsigned transaction' }));

        expect(await screen.findByLabelText('Unsigned transaction hex')).toHaveValue('aa00');
        expect(buildActionPsbtRequest).toHaveBeenCalledTimes(2);
    });

    it('closes the watch-only review with Escape and preserves the order fields', async () => {
        const watchAddress = { ...ADDRESS, source: 'watch' };
        mount({}, {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [watchAddress] }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
        });

        fireEvent.change(await screen.findByLabelText('Price (BTC)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '3' } });
        pressEnter(await screen.findByRole('button', { name: 'Review' }));
        expect(await screen.findByRole('button', { name: 'Edit order' })).toBeInTheDocument();
        expect(screen.getAllByText(ADDRESS.address)).toHaveLength(2);
        expect(screen.getByText('Settlement address')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(await screen.findByLabelText('Price (BTC)')).toHaveValue('2');
        expect(screen.getByLabelText('Size (XCHAIN)')).toHaveValue('3');
        expect(screen.queryByRole('button', { name: 'Edit order' })).toBeNull();
    });

    it('clears the review focus timer on unmount', async () => {
        const watchAddress = { ...ADDRESS, source: 'watch' };
        mount({}, {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [watchAddress] }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
        });
        fireEvent.change(await screen.findByLabelText('Price (BTC)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '3' } });
        const setTimer = vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce(() => 424242);
        const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
        try {
            fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
            expect(setTimer).toHaveBeenCalled();
            cleanup();
            expect(clearTimer).toHaveBeenCalledWith(424242);
        } finally {
            setTimer.mockRestore();
            clearTimer.mockRestore();
        }
    });

    it('ignores a watcher result after the wallet changes', async () => {
        const watchAddress = { ...ADDRESS, source: 'watch' };
        const request = deferred();
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [watchAddress] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: watchAddress.id }),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
            composeForConfirm: vi.fn(),
            buildActionPsbtRequest: vi.fn(() => request.promise),
        };
        const view = render(
            <MessagingProvider shell="desktop" messaging={messaging}>
                <PlaceOrderPanel walletId="wallet-old" chainId={CHAIN} tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );
        fireEvent.change(await screen.findByLabelText('Price (BTC)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '3' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create unsigned transaction' }));

        view.rerender(
            <MessagingProvider shell="desktop" messaging={messaging}>
                <PlaceOrderPanel walletId="wallet-new" chainId={CHAIN} tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );
        await act(async () => request.resolve({ psbtHex: 'stale', encoding: 'psbt' }));

        expect(screen.queryByDisplayValue('stale')).toBeNull();
        expect(await screen.findByLabelText('Price (BTC)')).toBeInTheDocument();
    });

    it('clears autopay exposure while a different wallet loads', async () => {
        const nextExposure = deferred();
        const getAutopayExposure = vi.fn()
            .mockResolvedValueOnce({ [CHAIN]: '100000000' })
            .mockImplementationOnce(() => nextExposure.promise);
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS.id }),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
            composeForConfirm: vi.fn(),
            getAutopayExposure,
        };
        const view = render(
            <MessagingProvider shell="desktop" messaging={messaging}>
                <PlaceOrderPanel walletId="wallet-old" chainId={CHAIN} tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );
        expect(await screen.findByText(/Outstanding auto-pay exposure on this chain/)).toBeInTheDocument();

        view.rerender(
            <MessagingProvider shell="desktop" messaging={messaging}>
                <PlaceOrderPanel walletId="wallet-new" chainId={CHAIN} tick1="XCHAIN" tick2="BTC" />
            </MessagingProvider>,
        );

        expect(screen.queryByText(/Outstanding auto-pay exposure on this chain/)).toBeNull();
        expect(getAutopayExposure).toHaveBeenLastCalledWith({ walletId: 'wallet-new' });
    });
});
