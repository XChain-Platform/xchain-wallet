// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';
import { OpenOrdersPanel } from '../../../packages/core/src/shared/components/OpenOrdersPanel.jsx';
import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';
import { OrderDetail } from '../../../packages/core/src/shared/routes/OrderDetail.jsx';

const flow = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useActionConfirmFlow: () => ({
        open: false,
        composing: false,
        run: flow.run,
        confirmAction: { phase: 'idle' },
    }),
    useConfirmSubmit: () => vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/hooks/useActionForm.js', () => ({
    useActionForm: () => {
        const fromAddress = {
            id: 'address-1', address: 'mSourceAddress', publicKey: '02abcd',
            derivationPath: "m/84'/1'/0'/0/0", signerId: 'signer-1', source: 'hd',
        };
        return {
            addressesByChain: { 'bitcoin-regtest': [fromAddress] },
            loadError: null,
            chainId: 'bitcoin-regtest',
            setChainId: vi.fn(),
            chainsWithAddresses: ['bitcoin-regtest'],
            fromAddress,
            setFromAddressId: vi.fn(),
            descriptor: {
                id: 'bitcoin-regtest', coin: 'bitcoin', displayName: 'Bitcoin Regtest',
                networkKind: 'regtest', ticker: 'BTC',
            },
            signerReady: true,
            isHwSource: false,
            hwStatus: 'available',
            onHwStatusChange: vi.fn(),
            buildFrom: () => fromAddress,
            submit: vi.fn(),
        };
    },
}));

vi.mock('../../../packages/core/src/shared/hooks/useWalletMode.js', () => ({
    useWalletMode: () => ({ isWatcherMode: false }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useNativeFee.js', () => ({
    useNativeFee: () => ({
        flag: undefined,
        payFeeInNativeCoin: false,
        setPayFeeInNativeCoin: vi.fn(),
        mandatory: false,
        toggleProps: { checked: false, onChange: vi.fn(), mandatory: false },
    }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useSignerReady.js', () => ({
    useSignerReady: () => true,
}));

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1', address: 'bc1qowner', publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
};
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

const messaging = (overrides = {}) => ({
    getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
    getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS.id }),
    getWalletBalances: vi.fn().mockResolvedValue({}),
    getSettings: vi.fn().mockResolvedValue({}),
    listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', walletMode: 'full' }]),
    getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
    getAutopayExposure: vi.fn().mockResolvedValue({}),
    ...overrides,
});

const owner = (node, methods) => (
    <MessagingProvider shell="web" messaging={methods}>{node}</MessagingProvider>
);

const expectNotice = (visible) => {
    const notices = screen.queryAllByTestId('mobile-autopay-notice');
    expect(notices).toHaveLength(visible ? 1 : 0);
    return notices[0] || null;
};

async function renderPlaceOrder(visible) {
    render(owner(
        <PlaceOrderPanel walletId="wallet-1" chainId={CHAIN} tick1="XCHAIN" tick2="BTC" prefillPrice="2" />,
        messaging(),
    ));
    const toggle = await screen.findByRole('switch', { name: 'Auto pay' });
    const cardNotice = expectNotice(visible);
    if (cardNotice) {
        expect(toggle.closest('[data-autopay-card]')).toContainElement(cardNotice);
        expect(cardNotice.previousElementSibling?.tagName).toBe('UL');
    }
    fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place Buy Order' }));
    await screen.findByText('Order placed');
    const armedNotice = expectNotice(visible);
    if (armedNotice) expect(armedNotice.previousElementSibling).toHaveTextContent('Auto pay is armed');
}

async function renderOpenOrders(visible) {
    const row = {
        action_index: 17, source: ADDRESS.address, type: 'sell', price: '2', amount: '10',
        timestamp: 1760000000, expiration: FUTURE,
    };
    render(owner(
        <OpenOrdersPanel walletId="wallet-1" chainId={CHAIN} tick1="XCP" tick2="PEPE" />,
        messaging({
            getMarketOrders: vi.fn().mockResolvedValue([row]),
            listAutopayOrders: vi.fn().mockResolvedValue([{
                id: 'autopay-17', chainId: CHAIN, orderActionIndex: 17, autopay: true,
            }]),
            resolveAutopayIndexes: vi.fn().mockResolvedValue({}),
        }),
    ));
    const toggle = await screen.findByRole('switch', { name: 'Auto pay on' });
    const notice = expectNotice(visible);
    if (notice) expect(notice.previousElementSibling).toBe(toggle.closest('label'));
}

async function renderCreateOrder(visible) {
    render(owner(
        <CreateOrderForm walletId="wallet-1" onBack={vi.fn()} />,
        messaging({ getAutopayExposure: vi.fn().mockResolvedValue({ total: 0 }) }),
    ));
    await screen.findAllByDisplayValue('mSourceAddress');
    fireEvent.click(screen.getByRole('button', { name: 'Flip give and get' }));
    fireEvent.click(screen.getByRole('button', { name: /Order Terms/ }));
    const toggle = await screen.findByRole('switch', { name: 'Auto pay' });
    const notice = expectNotice(visible);
    if (notice) expect(notice.previousElementSibling).toBe(toggle.closest('label'));
}

async function renderOrderDetail(visible) {
    const row = {
        action_index: 17, source: ADDRESS.address, give_tick: '', give_coin: 'BTC',
        give_amount: '1', get_tick: 'XCHAIN', get_coin: 'BTC', get_amount: '50',
        expiration: FUTURE, status: 'valid', block_index: '100',
    };
    render(owner(
        <OrderDetail walletId="wallet-1" chainId={CHAIN} actionIndex="17" onBack={vi.fn()} />,
        messaging({
            getOrderDetail: vi.fn().mockResolvedValue(row),
            getOrderCancelsForAddress: vi.fn().mockResolvedValue({ data: [] }),
            resolveAutopayIndexes: vi.fn().mockResolvedValue({}),
            listAutopayOrders: vi.fn().mockResolvedValue([{
                id: 'autopay-17', chainId: CHAIN, orderActionIndex: 17, autopay: false,
            }]),
        }),
    ));
    fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
    const toggle = await screen.findByRole('switch', { name: /Auto-pay off/ });
    const notice = expectNotice(visible);
    if (notice) expect(notice.previousElementSibling).toBe(toggle.closest('label'));
}

beforeEach(() => {
    flow.run.mockReset().mockResolvedValue({ txid: 'placed-order', autopayArmed: true });
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('MobileAutopayNotice auto-pay surfaces', () => {
    it.each(['ios', 'android', 'web'])('renders all owning surfaces on %s', async (platform) => {
        const native = platform !== 'web';
        vi.stubGlobal('Capacitor', {
            isNativePlatform: () => native,
            getPlatform: () => platform,
        });
        for (const renderSurface of [renderPlaceOrder, renderOpenOrders, renderCreateOrder, renderOrderDetail]) {
            await renderSurface(native);
            cleanup();
        }
    });
});
