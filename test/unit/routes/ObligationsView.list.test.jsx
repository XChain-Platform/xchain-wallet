// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Payments due is a quick glance at what is due right now (operator
// 2026-11-13): one list card, one row per payment whose window is open, each
// row a time ring, what it buys, what it pays and a chevron; a tap opens the
// payment's detail. Expired payments fall off the list (paid ones never reach
// it: the scan keeps pending rows only). What each row buys comes from one
// bulk read for the whole list, however many rows there are.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const hookState = vi.hoisted(() => ({ obligations: [], incomplete: false }));

vi.mock('../../../packages/core/src/shared/hooks/useCoinpayObligations.js', async (importOriginal) => ({
    scanCoinpayObligations: (await importOriginal()).scanCoinpayObligations,
    useCoinpayObligations: () => ({
        obligations: hookState.obligations,
        incomplete: hookState.incomplete,
        scanning: false,
        error: null,
        refresh: vi.fn(),
    }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useNetworkOffline.js', () => ({
    useNetworkOffline: () => ({ offline: false, recheck: vi.fn() }),
}));

import { ObligationsView, shortTimeLeft } from '../../../packages/core/src/shared/routes/ObligationsView.jsx';
import { scanCoinpayObligations } from '../../../packages/core/src/shared/hooks/useCoinpayObligations.js';
import viewStyles from '../../../packages/core/src/shared/routes/ObligationsView.module.css';

const PAYEE = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const PAYER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const now = () => Math.floor(Date.now() / 1000);

function row(index, overrides = {}) {
    return {
        chainId: 'bitcoin-mainnet',
        address: PAYER,
        payeeAddress: PAYEE,
        orderMatchActionIndex: String(index),
        coinAmount: '0.0015',
        expiration: now() + 47 * 3600 + 59 * 60,
        ...overrides,
    };
}

// Answers every listed payment with a bought side, in one call.
function sidesFor(rows) {
    const out = {};
    for (const r of rows) {
        out[`${r.chainId}:${r.orderMatchActionIndex}`] = { tick: 'XCHAIN', amount: '600', matchedAt: null };
    }
    return out;
}

function renderView({ onPay = vi.fn(), getCoinpayMatchSides } = {}) {
    const messaging = {
        getAutopayStatus: vi.fn().mockResolvedValue(null),
        getCoinpayMatchSides: getCoinpayMatchSides
            || vi.fn(async ({ obligations }) => sidesFor(obligations)),
        getActionByIndex: vi.fn(),
    };
    const utils = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ObligationsView walletId="w1" onPay={onPay} onBack={() => {}} />
        </MessagingProvider>,
    );
    return { onPay, messaging, utils };
}

afterEach(() => {
    cleanup();
    hookState.obligations = [];
    hookState.incomplete = false;
    vi.useRealTimers();
});

describe('ObligationsView list', () => {
    it('shows the standard empty state when nothing is due, with no Refresh or Pay Now button', () => {
        renderView();
        expect(screen.getByText('No payments due')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Refresh Payments|Pay Now/ })).toBeNull();
    });

    it('shows an incomplete-read notice instead of claiming no payments are due', () => {
        hookState.incomplete = true;
        renderView();
        expect(screen.getByText(/Couldn't load every payment due/)).toBeTruthy();
        expect(screen.queryByText('No payments due')).toBeNull();
    });

    it('draws each row as ring, title, pay line and chevron, and nothing else', async () => {
        hookState.obligations = [row(700210, { coinAmount: '0.0024', expiration: now() + 24 * 60 + 10 })];
        renderView();
        const button = await screen.findByRole('button', { name: /^Buying 600 XCHAIN, Pay 0\.0024 BTC, 24m left$/ });
        expect(button).toHaveTextContent('Buying 600 XCHAIN');
        expect(button).toHaveTextContent('Pay 0.0024 BTC');
        // The ring shows the window left with the time under it, red under 30 minutes, green otherwise.
        const ring = button.querySelector('[data-fill-ring]');
        expect(ring).toBeTruthy();
        expect(ring.getAttribute('data-mark')).toBe('clock');
        expect(ring.getAttribute('data-tone')).toBe('danger');
        expect(within(ring).getByText('24m')).toBeTruthy();
        expect(within(button).getByRole('img', { name: '24m left to pay' })).toBeTruthy();
        // The chevron is the row's directional icon; no order or match number,
        // no address and no auto pay chip on the row.
        expect(button.querySelectorAll('svg[data-xc-directional]')).toHaveLength(1);
        expect(button).not.toHaveTextContent(/#?700210|Match|Order|bc1q|Auto pay/i);
    });

    it('highlights an owed row that auto pay cannot sign, opens pay, and clears after payment', async () => {
        hookState.obligations = [row(700210, { attention: 'autopay-cannot-sign' })];
        const { onPay, messaging, utils } = renderView();
        const button = await screen.findByRole('button', { name: /Auto Pay can't sign this address\. Tap to pay\./ });

        expect(button).toHaveAttribute('data-autopay-cannot-sign');
        expect(button).toHaveClass(viewStyles.attentionRow);
        expect(button).toHaveTextContent("Auto Pay can't sign this address. Tap to pay.");
        const css = readFileSync('packages/core/src/shared/routes/ObligationsView.module.css', 'utf8');
        const attentionRule = css.match(/\.attentionRow\s*\{([^}]*)\}/)?.[1] || '';
        expect(attentionRule).not.toMatch(/border-inline-start/);
        expect(css).toMatch(/\.attentionRow::before\s*\{[^}]*inset-inline-start:\s*0;[^}]*width:\s*3px;/s);
        fireEvent.click(button);
        expect(onPay).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            address: PAYER,
            orderMatchActionIndex: '700210',
        });

        hookState.obligations = [];
        utils.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <ObligationsView walletId="w1" onPay={onPay} onBack={() => {}} />
            </MessagingProvider>,
        );
        expect(screen.queryByText("Auto Pay can't sign this address. Tap to pay.")).toBeNull();
        expect(utils.container.querySelector('[data-autopay-cannot-sign]')).toBeNull();
    });

    it('shows Buying with a loading placeholder until the bought side is known, never a guess', async () => {
        let answer;
        const pending = new Promise((resolve) => { answer = resolve; });
        hookState.obligations = [row(700210)];
        renderView({ getCoinpayMatchSides: vi.fn(() => pending) });
        const button = screen.getByRole('button', { name: /^Buying, Pay 0\.0015 BTC, / });
        expect(button).toHaveTextContent(/^Buying/);
        expect(button).not.toHaveTextContent(/XCHAIN|\d+ [A-Z]{3,} Pay/);
        const placeholder = button.querySelector('[data-loading="bought-side"]');
        expect(placeholder).toBeTruthy();
        expect(placeholder.querySelector('span[aria-hidden="true"]')).toBeTruthy();
        await act(async () => { answer(sidesFor(hookState.obligations)); });
        expect(screen.getByRole('button', { name: /^Buying 600 XCHAIN, / })).toBeTruthy();
    });

    it('leaves paid payments off the list: the scan keeps pending rows only', async () => {
        const rows = [
            { action_index: '700210', coinpay_status: 'pending_coinpay', payer_address: PAYER, payee_address: PAYEE, coin_amount: '0.0015', expiration: now() + 3600 },
            { action_index: '700211', coinpay_status: 'fulfilled', payer_address: PAYER, payee_address: PAYEE, coin_amount: '0.0016', expiration: now() + 3600 },
        ];
        hookState.obligations = (await scanCoinpayObligations({
            messaging: {
                getAddressesByChain: async () => ({ 'bitcoin-mainnet': [{ address: PAYER }] }),
                getCoinpayObligationsForAddress: async () => ({ data: rows }),
            },
            walletId: 'w1',
        })).obligations;
        renderView();
        await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
        expect(screen.getByRole('button', { name: /Pay 0\.0015 BTC/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Pay 0\.0016 BTC/ })).toBeNull();
    });

    it('tries a failed bulk read again on the next scan, not on every tick', async () => {
        hookState.obligations = [row(700210)];
        const getCoinpayMatchSides = vi.fn()
            .mockRejectedValueOnce(new Error('explorer down'))
            .mockImplementation(async ({ obligations }) => sidesFor(obligations));
        const { messaging, utils } = renderView({ getCoinpayMatchSides });
        await screen.findByRole('button', { name: /^Buying tokens, Pay 0\.0015 BTC/ });
        expect(messaging.getCoinpayMatchSides).toHaveBeenCalledTimes(1);
        // The next poll hands a new rows array with the same payments.
        hookState.obligations = [...hookState.obligations];
        utils.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <ObligationsView walletId="w1" onPay={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByRole('button', { name: /^Buying 600 XCHAIN, / });
        expect(messaging.getCoinpayMatchSides).toHaveBeenCalledTimes(2);
    });

    it('leaves expired payments off the list', async () => {
        hookState.obligations = [
            row(700210),
            row(700211, { expiration: now() - 5 }),
        ];
        renderView();
        await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
        expect(screen.queryByText(/Expired|Do not pay|window closed/i)).toBeNull();
    });

    it('shows the empty state when every payment has expired', () => {
        hookState.obligations = [row(700211, { expiration: now() - 5 })];
        renderView();
        expect(screen.getByText('No payments due')).toBeTruthy();
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });

    it('reads the bought side once for the whole list, at any row count', async () => {
        for (const count of [2, 9]) {
            hookState.obligations = Array.from({ length: count }, (_, i) => row(700300 + i));
            const { messaging } = renderView();
            await waitFor(() => expect(screen.getAllByRole('button', { name: /^Buying 600 XCHAIN, / })).toHaveLength(count));
            expect(messaging.getCoinpayMatchSides).toHaveBeenCalledTimes(1);
            expect(messaging.getCoinpayMatchSides.mock.calls[0][0].obligations).toHaveLength(count);
            expect(messaging.getActionByIndex).not.toHaveBeenCalled();
            cleanup();
        }
    });

    it('does not read again as the countdown ticks', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        hookState.obligations = [row(700210), row(700211)];
        const { messaging } = renderView();
        await waitFor(() => expect(messaging.getCoinpayMatchSides).toHaveBeenCalledTimes(1));
        await act(async () => { vi.advanceTimersByTime(5_000); });
        expect(messaging.getCoinpayMatchSides).toHaveBeenCalledTimes(1);
    });

    it('opens the payment detail from a tap on the row', async () => {
        hookState.obligations = [row(700210), row(700211, { coinAmount: '2' })];
        const { onPay } = renderView();
        const second = await screen.findByRole('button', { name: /Pay 2 BTC/ });
        fireEvent.click(second);
        expect(onPay).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            address: PAYER,
            orderMatchActionIndex: '700211',
        });
    });

    it('narrows by what is bought or paid', async () => {
        hookState.obligations = [row(700210), row(700211, { coinAmount: '2' })];
        renderView();
        await screen.findAllByRole('button', { name: /^Buying 600 XCHAIN, / });
        fireEvent.click(screen.getByRole('button', { name: 'Filter payments due' }));
        const search = screen.getByRole('searchbox');
        const count = () => screen.queryAllByRole('button', { name: /^Buying/ }).length;
        fireEvent.change(search, { target: { value: '0.0015' } });
        expect(count()).toBe(1);
        fireEvent.change(search, { target: { value: 'xchain' } });
        expect(count()).toBe(2);
        fireEvent.change(search, { target: { value: 'btc' } });
        expect(count()).toBe(2);
        fireEvent.change(search, { target: { value: 'nomatch' } });
        expect(count()).toBe(0);
    });
});

describe('shortTimeLeft', () => {
    it('says the time left in a few characters', () => {
        expect(shortTimeLeft(3900)).toBe('1h 5m');
        expect(shortTimeLeft(7200)).toBe('2h');
        expect(shortTimeLeft(24 * 60 + 10)).toBe('24m');
        expect(shortTimeLeft(40)).toBe('40s');
        expect(shortTimeLeft(0)).toBeNull();
        expect(shortTimeLeft(null)).toBeNull();
    });
});
