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

describe('PlaceOrderPanel validation', () => {
    it('gates order review while wallet balances are loading', async () => {
        const balanceRequest = deferred();
        mount({}, { getWalletBalances: vi.fn(() => balanceRequest.promise) });

        expect(screen.getByRole('status')).toHaveTextContent('Loading wallet balances…');
        expect(screen.getByRole('button', { name: 'Loading wallet…' })).toBeDisabled();

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

    it('accepts grouped decimal entry and uses theme tokens for side controls', async () => {
        mount();
        const price = await screen.findByLabelText('Price (BTC)');
        fireEvent.change(price, { target: { value: '1,234.5' } });
        expect(price.value).toBe('1234.5');
        expect(price.style.textAlign).toBe('right');
        expect(price.style.fontVariantNumeric).toBe('tabular-nums');

        const buy = screen.getByRole('button', { name: 'Buy XCHAIN' });
        const sell = screen.getByRole('button', { name: 'Sell XCHAIN' });
        expect(buy.parentElement.style.flexWrap).toBe('wrap');
        expect(buy.style.background).toBe('var(--xc-success)');
        expect(sell.style.background).toBe('var(--xc-danger)');
        expect(buy.style.color).toBe('var(--xc-on-accent)');
    });

    it('renders the 360px layout hooks for stacked fields and a visible side toggle', async () => {
        mount({}, {}, 360);

        await screen.findByLabelText('Price (BTC)');
        expect(screen.getByRole('group', { name: 'Order side' }).className).toMatch(/sideToggle/);
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
        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create unsigned transaction' }));

        expect(await screen.findByLabelText('Unsigned transaction hex')).toHaveValue('aa00');
        expect(buildActionPsbtRequest).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN,
            actionData: expect.objectContaining({ action: 'ORDER' }),
        }));
        expect(onOrderPlaced).not.toHaveBeenCalled();
    });
});
