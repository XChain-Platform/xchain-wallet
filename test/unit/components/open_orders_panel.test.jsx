// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OpenOrdersPanel } from '../../../packages/core/src/shared/components/OpenOrdersPanel.jsx';

const lane = vi.hoisted(() => ({
    open: false,
    composing: false,
    isWatcherMode: false,
    run: vi.fn(),
    hook: vi.fn(),
    resolve: null,
    openOnRun: true,
}));

vi.mock('../../../packages/core/src/shared/hooks/useOwnerActionLane.js', () => ({
    useOwnerActionLane: (args) => {
        lane.hook(args);
        return {
            open: lane.open,
            composing: lane.composing,
            isWatcherMode: lane.isWatcherMode,
            run: lane.run,
            confirmProps: {
                confirmAction: {
                    phase: 'ready',
                    composed: {
                        chainId: 'bitcoin-mainnet',
                        networkFeeSats: 1234,
                        decoded: {
                            summary: 'Cancel order (#17)',
                            details: [{ label: 'Order action index', value: '17' }],
                            warnings: [],
                        },
                    },
                    report: { verdict: 'pass', findings: [] },
                    acknowledged: new Set(),
                    acknowledge: vi.fn(),
                    canApprove: true,
                    approve: vi.fn(),
                    reject: vi.fn(),
                },
                password: '',
                onPasswordChange: vi.fn(),
            },
        };
    },
}));

vi.mock('../../../packages/core/src/shared/hooks/useSignerReady.js', () => ({
    useSignerReady: () => true,
}));

vi.mock('../../../packages/core/src/shared/hooks/useNativeFee.js', () => ({
    useNativeFee: () => ({ flag: false, mandatory: false }),
}));

const OWNER = {
    id: 'address-1',
    address: 'bc1qownerexampleexampleexampleexampleexample',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

const FUTURE = 1893456000;

function orderRow(extra = {}) {
    return {
        action_index: 17,
        type: 'sell',
        price: '2.00000000',
        amount: '10.00000000',
        timestamp: 1760000000,
        expiration: FUTURE,
        ...extra,
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function mountPanel(rows = [orderRow()], overrides = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [OWNER] }),
        getMarketOrders: vi.fn().mockResolvedValue(rows),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        cancelOrder: vi.fn(),
        cancelOrderHw: vi.fn(),
        ...overrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <OpenOrdersPanel
                walletId="wallet-1"
                chainId="bitcoin-mainnet"
                tick1="XCP"
                tick2="PEPE"
            />
        </MessagingProvider>,
    );
    return messaging;
}

beforeEach(() => {
    lane.open = false;
    lane.composing = false;
    lane.isWatcherMode = false;
    lane.resolve = null;
    lane.openOnRun = true;
    lane.hook.mockClear();
    lane.run.mockReset();
    lane.run.mockImplementation(() => {
        lane.open = lane.openOnRun;
        return new Promise((resolve) => { lane.resolve = resolve; });
    });
});

afterEach(() => cleanup());

describe('OpenOrdersPanel cancellation confirmation', () => {
    it('distinguishes loading from empty and contains wide rows on narrow screens', async () => {
        const addressRequest = deferred();
        mountPanel([], { getAddressesByChain: vi.fn(() => addressRequest.promise) });

        expect(screen.getByRole('status')).toHaveTextContent('Loading open orders…');
        expect(screen.queryByText('No open orders on this market.')).toBeNull();
        expect(screen.getByRole('region', { name: 'Open orders' })).toHaveAttribute('aria-busy', 'true');

        await act(async () => addressRequest.resolve({ 'bitcoin-mainnet': [OWNER] }));

        expect(await screen.findByText('No open orders on this market.')).toBeInTheDocument();
        expect(screen.queryByText('Loading open orders…')).toBeNull();
    });

    it('renders the summarized market-orders response', async () => {
        mountPanel();
        const side = await screen.findByText('Sell');
        const price = screen.getByText('2.00000000');
        expect(screen.getByText('10.00000000')).toBeInTheDocument();
        expect(side.style.color).toBe('var(--xc-danger)');
        expect(price.style.textAlign).toBe('right');
        expect(price.style.fontVariantNumeric).toBe('tabular-nums');
        expect(screen.getByText('Price').parentElement.parentElement.style.overflowX).toBe('auto');
    });

    it('does not let an older poll overwrite newer open orders', async () => {
        const older = deferred();
        const newer = deferred();
        const getMarketOrders = vi.fn()
            .mockImplementationOnce(() => older.promise)
            .mockImplementationOnce(() => newer.promise);
        mountPanel([], { getMarketOrders });

        await waitFor(() => expect(getMarketOrders).toHaveBeenCalledTimes(1));
        fireEvent(document, new Event('visibilitychange'));
        expect(getMarketOrders).toHaveBeenCalledTimes(2);

        await act(async () => newer.resolve([orderRow({ price: '3.00000000' })]));
        expect(await screen.findByText('3.00000000')).toBeInTheDocument();

        await act(async () => older.resolve([orderRow({ price: '1.00000000' })]));
        expect(screen.getByText('3.00000000')).toBeInTheDocument();
        expect(screen.queryByText('1.00000000')).toBeNull();
    });

    it('ignores an autopay response from the previous wallet', async () => {
        const oldWallet = deferred();
        const newWallet = deferred();
        const listAutopayOrders = vi.fn()
            .mockImplementationOnce(() => oldWallet.promise)
            .mockImplementationOnce(() => newWallet.promise);
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [OWNER] }),
            getMarketOrders: vi.fn().mockResolvedValue([orderRow()]),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            listAutopayOrders,
        };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <OpenOrdersPanel walletId="wallet-old" chainId="bitcoin-mainnet" tick1="XCP" tick2="PEPE" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(listAutopayOrders).toHaveBeenCalledTimes(1));

        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <OpenOrdersPanel walletId="wallet-new" chainId="bitcoin-mainnet" tick1="XCP" tick2="PEPE" />
            </MessagingProvider>,
        );
        await waitFor(() => expect(listAutopayOrders).toHaveBeenCalledTimes(2));
        await act(async () => newWallet.resolve([{
            id: 'new-consent', orderActionIndex: 17, autopay: true,
        }]));
        expect(await screen.findByText('CoinPay auto-pay on')).toBeInTheDocument();

        await act(async () => oldWallet.resolve([]));
        expect(screen.getByText('CoinPay auto-pay on')).toBeInTheDocument();
    });

    it('gives duplicate order responses distinct React keys', async () => {
        const secondOwner = { ...OWNER, id: 'address-2', address: 'bc1qsecondowner' };
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            mountPanel([orderRow()], {
                getAddressesByChain: vi.fn().mockResolvedValue({
                    'bitcoin-mainnet': [OWNER, secondOwner],
                }),
            });

            expect(await screen.findAllByRole('button', { name: 'Cancel' })).toHaveLength(2);
            expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key/i);
        } finally {
            consoleError.mockRestore();
        }
    });

    it('does not apply a cancel result after the market changes', async () => {
        lane.openOnRun = false;
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [OWNER] }),
            getMarketOrders: vi.fn(({ tick2 }) => Promise.resolve([
                orderRow({ price: tick2 === 'NEXT' ? '9.00000000' : '2.00000000' }),
            ])),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        };
        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <OpenOrdersPanel walletId="wallet-1" chainId="bitcoin-mainnet" tick1="XCP" tick2="PEPE" />
            </MessagingProvider>,
        );
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));

        view.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <OpenOrdersPanel walletId="wallet-1" chainId="bitcoin-mainnet" tick1="XCP" tick2="NEXT" />
            </MessagingProvider>,
        );
        expect(await screen.findByText('9.00000000')).toBeInTheDocument();
        await act(async () => lane.resolve({ txid: 'stale-cancel' }));

        expect(screen.getByText('9.00000000')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('composes through the owner-action lane and replaces the panel while confirming', async () => {
        const messaging = mountPanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
        expect(screen.getByText(/Cancel order #17\?/)).toBeTruthy();
        expect(screen.getByText('This submits a cancellation transaction for the remaining order. Once confirmed, it cannot be undone.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));

        expect(await screen.findByLabelText('Confirm Cancel order (#17)')).toBeTruthy();
        expect(screen.getByTestId('confirm-fee')).toHaveTextContent('Network fee: 0.00001234 BTC');
        expect(lane.hook).toHaveBeenLastCalledWith(expect.objectContaining({
            walletId: 'wallet-1',
            chainId: 'bitcoin-mainnet',
            owner: OWNER,
            software: 'cancelOrder',
            hardware: 'cancelOrderHw',
        }));
        expect(lane.run).toHaveBeenCalledWith({
            actionData: {
                action: 'ORDER',
                params: { VERSION: '1', ORDER_ACTION_INDEX: '17' },
            },
            encoderOpts: {},
            submitExtra: { orderActionIndex: '17' },
        });
        expect(messaging.cancelOrder).not.toHaveBeenCalled();
        expect(messaging.cancelOrderHw).not.toHaveBeenCalled();

        lane.open = false;
        await act(async () => lane.resolve({ txid: 'cancel-txid' }));
        await waitFor(() => {
            expect(screen.getByText('No open orders on this market.')).toBeTruthy();
        });
    });

    it('keeps the cancel action busy while composition is pending', async () => {
        lane.openOnRun = false;
        mountPanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
        const submit = screen.getByRole('button', { name: 'Cancel order' });
        fireEvent.click(submit);

        expect(submit).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

        await act(async () => lane.resolve({ txid: 'cancel-txid' }));
    });

    it('does not offer cancel for stale filled or expired rows', async () => {
        mountPanel([
            orderRow({ action_index: 18, current_status: 'filled' }),
            orderRow({ action_index: 19, current_status: 'open', give_remaining: '0' }),
            orderRow({ action_index: 20, expiration: 1 }),
        ]);

        expect(await screen.findByText('No open orders on this market.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    });

    it('keeps the order open and shows the unsigned transaction in watcher mode', async () => {
        lane.isWatcherMode = true;
        lane.run.mockResolvedValue({ psbtHex: 'aa00', encoding: 'psbt' });
        mountPanel();

        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));

        expect(await screen.findByRole('heading', {
            name: 'Unsigned transaction, ready for signing',
        })).toBeTruthy();
        expect(screen.getByLabelText('Unsigned transaction hex').value).toBe('aa00');
        expect(screen.queryByText('No open orders on this market.')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy();
    });
});
