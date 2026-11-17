// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Trade page in the Form Standard (Layout 1 of wallet-trade-layouts.png):
// no price tiles, From first, one open Trade Details section holding the
// Swap | Limit | Market toggle, the Fees section, and a green Buy beside a
// red Sell in Limit and Market. The pressed button is the order's side.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

const state = vi.hoisted(() => ({ runs: [] }));

// The confirm flow records what the form composes; the confirm screen itself
// has its own suites.
vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useActionConfirmFlow: () => ({
        open: false,
        composing: false,
        run: (args) => { state.runs.push(args); return new Promise(() => {}); },
        confirmAction: { phase: 'idle' },
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { MarketTrade } from '../../../packages/core/src/shared/routes/MarketTrade.jsx';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'a1', address: 'bc1qexampleaddress7c1c', publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's1',
};

function makeMessaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS.id }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({}),
        listWallets: vi.fn().mockResolvedValue([{ id: 'w', name: 'W', walletMode: 'full' }]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getAutopayExposure: vi.fn().mockResolvedValue({}),
        getOrderbook: vi.fn().mockResolvedValue({ asks: [['0.6', '10']], bids: [['0.5', '10']] }),
        getMarketHistory: vi.fn().mockResolvedValue([]),
    };
}

function mountPage(props = {}, walletId = 'w') {
    const messaging = makeMessaging();
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MarketTrade walletId={walletId} chainId={CHAIN} tick1="XCHAIN" tick2="BTC" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
    return { messaging, view };
}

function mountPanel(props = {}) {
    const messaging = makeMessaging();
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PlaceOrderPanel
                walletId="w"
                chainId={CHAIN}
                tick1="XCHAIN"
                tick2="BTC"
                layout="trade"
                view="market"
                bestBid="0.5"
                bestAsk="0.6"
                lastPrice="0.55"
                {...props}
            />
        </MessagingProvider>,
    );
}

const sectionIds = (container) => [...container.querySelectorAll('[data-form-section]')]
    .map((node) => node.getAttribute('data-form-section'));
const header = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const modeRadio = (name) => screen.getByRole('radio', { name });
// G99: the From summary's address is the fitting AddressText, named by the full address.
const waitForAddress = () => waitFor(() => expect(header('From').querySelector('[aria-label="bc1qexampleaddress7c1c"]')).not.toBeNull());

beforeEach(() => {
    state.runs = [];
    localStorage.clear();
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'full' }], activeWalletId: 'w' });
});

afterEach(() => {
    cleanup();
    resetWalletModes();
    clearDemoWalletId();
});

describe('Trade page layout', () => {
    it('shows no Last, Best bid or Best ask boxes above the form', async () => {
        const { messaging } = mountPage();
        await waitFor(() => expect(messaging.getOrderbook).toHaveBeenCalled());
        await waitForAddress();
        expect(screen.queryByRole('region', { name: 'Prices' })).toBeNull();
        expect(screen.queryByText('Best bid')).toBeNull();
        expect(screen.queryByText('Best ask')).toBeNull();
        expect(screen.queryByText('Last')).toBeNull();
        // The old Swap | Market tab row is gone too.
        expect(screen.queryByRole('tablist')).toBeNull();
    });

    it('puts From first, then Trade Details, then Advanced and Fees, with the action last', async () => {
        const { view } = mountPage();
        await waitForAddress();
        // G98: the shared Advanced section sits directly above Speed and Fees.
        expect(sectionIds(view.container)).toEqual(['from', 'trade', 'advanced', 'fee']);
        expect(header('From')).toHaveAttribute('aria-expanded', 'false');
        expect(header('Speed and Fees')).toHaveAttribute('aria-expanded', 'false');
        // The status slot sits after the sections and before the action row.
        const sections = view.container.querySelector('[data-form-sections]');
        const slot = view.container.querySelector('[data-form-status-slot]');
        const place = screen.getByRole('button', { name: 'Place Order' });
        expect(sections.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(slot.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('opens Trade Details by default and lets the user collapse it and open Fees', async () => {
        const { view } = mountPage();
        await waitForAddress();
        const trade = header('Trade Details');
        expect(trade).toHaveAttribute('aria-expanded', 'true');
        expect(view.container.querySelector('[data-form-section="trade"]')).toHaveAttribute('data-form-main', '');
        expect(screen.getByRole('radiogroup', { name: 'Order type' })).toBeVisible();

        fireEvent.click(trade);
        expect(header('Trade Details')).toHaveAttribute('aria-expanded', 'false');
        expect(document.getElementById(trade.getAttribute('aria-controls'))).not.toBeVisible();

        fireEvent.click(header('Speed and Fees'));
        expect(header('Speed and Fees')).toHaveAttribute('aria-expanded', 'true');
    });

    it('holds one Swap | Limit | Market toggle inside Trade Details', async () => {
        const { view } = mountPage();
        await waitForAddress();
        const group = screen.getByRole('radiogroup', { name: 'Order type' });
        expect(within(group).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Swap', 'Limit', 'Market']);
        expect(view.container.querySelector('[data-form-section="trade"]').contains(group)).toBe(true);
        expect(modeRadio('Swap')).toHaveAttribute('aria-checked', 'true');
        // A page opened in Market mode starts the toggle at Limit.
        cleanup();
        mountPage({ mode: 'market' });
        await waitForAddress();
        expect(modeRadio('Limit')).toHaveAttribute('aria-checked', 'true');
    });

    it('puts a full-width Buy | Sell toggle first in Trade Details, above the mode toggle, in every mode', async () => {
        const { view } = mountPage();
        await waitForAddress();
        const body = view.container.querySelector('[data-form-section="trade"]');
        for (const mode of ['Swap', 'Limit', 'Market']) {
            fireEvent.click(modeRadio(mode));
            const groups = within(body).getAllByRole('radiogroup');
            expect(groups.map((group) => group.getAttribute('aria-label')).slice(0, 2)).toEqual(['Order side', 'Order type']);
            const sides = within(groups[0]).getAllByRole('radio');
            expect(sides.map((radio) => radio.textContent)).toEqual(['Buy', 'Sell']);
            // Each side carries its icon; Buy fills green and Sell red, only when active.
            for (const radio of sides) expect(radio.querySelector('svg')).not.toBeNull();
            expect(sides[0]).toHaveAttribute('data-tone', 'success');
            expect(sides[1]).toHaveAttribute('data-tone', 'danger');
            expect(sides[0]).toHaveAttribute('aria-checked', 'true');
        }
    });

    it('has one Place Order button in all three modes, and no Review, Buy or Sell buttons', async () => {
        mountPage();
        await waitForAddress();
        for (const mode of ['Swap', 'Limit', 'Market']) {
            fireEvent.click(modeRadio(mode));
            const submits = screen.getAllByRole('button').filter((button) => button.getAttribute('type') === 'submit');
            expect(submits.map((button) => button.textContent)).toEqual(['Place Order']);
            for (const name of ['Review', 'Buy', 'Sell', 'Buy Now', 'Sell Now']) {
                expect(screen.queryByRole('button', { name })).toBeNull();
            }
        }
    });

    it('keeps Place Order the same green button with the same icon for Buy and Sell in every mode', async () => {
        mountPage();
        await waitForAddress();
        const looks = new Set();
        for (const mode of ['Swap', 'Limit', 'Market']) {
            fireEvent.click(modeRadio(mode));
            for (const sideName of ['Buy', 'Sell']) {
                fireEvent.click(screen.getByRole('radio', { name: sideName }));
                const place = screen.getByRole('button', { name: 'Place Order' });
                expect(place.className).toMatch(/success/);
                expect(place.className).not.toMatch(/danger/);
                const icon = place.querySelector('svg');
                expect(icon).not.toBeNull();
                looks.add(`${place.className}|${icon.outerHTML}`);
            }
        }
        expect(looks.size).toBe(1);
    });

    it('prices a Market order at the side\'s best quote', async () => {
        mountPage();
        await waitForAddress();
        fireEvent.click(modeRadio('Market'));
        await waitFor(() => expect(screen.getByLabelText('Price')).toHaveValue('0.6'));
        expect(screen.getByText('Best ask, fills now')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('radio', { name: 'Sell' }));
        expect(screen.getByLabelText('Price')).toHaveValue('0.5');
        expect(screen.getByText('Best bid, fills now')).toBeInTheDocument();
    });

    it('puts 25, 50, 75 and 100 chips under Amount and Max inside the field', async () => {
        mountPage({ mode: 'market' });
        await waitForAddress();
        const chips = screen.getByRole('group', { name: 'Amount presets' });
        expect(within(chips).getAllByRole('button').map((chip) => chip.textContent)).toEqual(['25%', '50%', '75%', '100%']);
        expect(screen.getByRole('button', { name: 'Use the maximum amount' })).toBeInTheDocument();
    });

    it('shows no standing demo notice and keeps Place Order enabled in a demo wallet (G92)', async () => {
        markDemoWallet('demo-w');
        const { messaging } = mountPage({ mode: 'market' }, 'demo-w');
        await waitFor(() => expect(messaging.getOrderbook).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByRole('button', { name: 'Place Order' })).toBeEnabled());
        expect(screen.queryByText(/Demo wallets can't move funds/)).toBeNull();
        expect(screen.queryByTestId('demo-guard-refusal')).toBeNull();
    });

    it('refuses a demo submit only once Place Order is pressed, and never composes', async () => {
        markDemoWallet('demo-w');
        mountPage({ mode: 'market' }, 'demo-w');
        const place = await screen.findByRole('button', { name: 'Place Order' });
        await waitFor(() => expect(place).toBeEnabled());
        fireEvent.change(screen.getByLabelText('Price'), { target: { value: '0.4' } });
        fireEvent.change(screen.getByLabelText('Amount (XCHAIN)'), { target: { value: '2' } });
        await act(async () => { fireEvent.click(place); });
        expect(await screen.findByTestId('demo-guard-refusal')).toHaveTextContent(/Demo wallets can't move funds/);
        expect(state.runs).toEqual([]);
        expect(screen.getByRole('button', { name: 'Place Order' })).toBeEnabled();
        // The refusal's exit opens the demo exit confirmation.
        fireEvent.click(within(screen.getByTestId('demo-guard-refusal')).getByRole('button', { name: 'Create a Real Wallet' }));
        expect(await screen.findByText('Exit demo and delete its data?')).toBeInTheDocument();
    });
});

describe('Trade page summary line', () => {
    const summary = (container) => container.querySelector('[data-trade-summary]');

    it('stays hidden until an amount is entered', async () => {
        const { view } = mountPage({ mode: 'market' });
        await waitForAddress();
        expect(summary(view.container)).toBeNull();
    });

    it('reads Buying ... at ... each, for ... in Limit, with a BUY pill just above Place Order', async () => {
        const { view } = mountPage({ mode: 'market' });
        await waitForAddress();
        fireEvent.change(screen.getByLabelText('Price'), { target: { value: '0.4' } });
        fireEvent.change(screen.getByLabelText('Amount (XCHAIN)'), { target: { value: '1000' } });
        const line = summary(view.container);
        expect(line).toHaveTextContent('BUYBuying 1,000 XCHAIN at 0.4 each, for 400 BTC');
        expect(line).toHaveAttribute('data-side', 'buy');
        const place = screen.getByRole('button', { name: 'Place Order' });
        expect(line.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('reads Selling ... now at the best bid, for about ... in Market, with a SELL pill', async () => {
        const { view } = mountPage({ mode: 'market', side: 'sell' });
        await waitForAddress();
        fireEvent.click(modeRadio('Market'));
        fireEvent.change(screen.getByLabelText('Amount (XCHAIN)'), { target: { value: '500' } });
        await waitFor(() => expect(summary(view.container)).toHaveTextContent(
            'SELLSelling 500 XCHAIN now at the best bid, for about 250 BTC',
        ));
        expect(summary(view.container)).toHaveAttribute('data-side', 'sell');
    });

    it('reads Buying ... for ... in Swap', async () => {
        const { view } = mountPage({ price: '0.4' });
        await waitForAddress();
        fireEvent.click(modeRadio('Swap'));
        fireEvent.change(screen.getByLabelText('You get (XCHAIN)'), { target: { value: '1000' } });
        expect(summary(view.container)).toHaveTextContent('BUYBuying 1,000 XCHAIN for 400 BTC');
    });
});

describe('Trade page Swap: the side toggle and the flip arrow are one setting', () => {
    it('flipping switches Buy and Sell, and choosing a side sets the pay and get direction', async () => {
        mountPage();
        await waitForAddress();
        const sideRadio = (name) => screen.getByRole('radio', { name });
        expect(sideRadio('Buy')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByLabelText('You pay (BTC)')).toBeInTheDocument();
        expect(screen.getByLabelText('You get (XCHAIN)')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Flip to sell' }));
        expect(sideRadio('Sell')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByLabelText('You pay (XCHAIN)')).toBeInTheDocument();
        expect(screen.getByLabelText('You get (BTC)')).toBeInTheDocument();

        fireEvent.click(sideRadio('Buy'));
        expect(sideRadio('Buy')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByLabelText('You pay (BTC)')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Flip to sell' })).toBeInTheDocument();
    });
});

describe('Trade page: the Buy | Sell toggle picks the side Place Order sends', () => {
    async function fillLimit() {
        await waitForAddress();
        fireEvent.change(screen.getByLabelText('Price'), { target: { value: '0.4' } });
        fireEvent.change(screen.getByLabelText('Amount (XCHAIN)'), { target: { value: '2' } });
    }
    const pickSide = (name) => fireEvent.click(screen.getByRole('radio', { name }));
    const placeOrder = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Place Order' })); });

    it('composes a sell when Sell is chosen on a page opened to buy (Limit)', async () => {
        mountPanel({ side: undefined });
        await fillLimit();
        pickSide('Sell');
        await placeOrder();
        await waitFor(() => expect(state.runs).toHaveLength(1));
        expect(state.runs[0].actionData.params).toMatchObject({
            GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '2', GET_TICK: '', GET_AMOUNT: '0.8',
        });
    });

    it('composes a sell through the Trade page, which owns the side', async () => {
        mountPage({ mode: 'market', side: 'buy' });
        await fillLimit();
        pickSide('Sell');
        await placeOrder();
        await waitFor(() => expect(state.runs).toHaveLength(1));
        expect(state.runs[0].actionData.params).toMatchObject({
            GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '2', GET_TICK: '', GET_AMOUNT: '0.8',
        });
    });

    it('states a Market buy exposure at the best ask', async () => {
        mountPanel({ side: undefined, initialOrderType: 'market' });
        await waitForAddress();
        fireEvent.change(screen.getByLabelText('Amount (XCHAIN)'), { target: { value: '2' } });
        await waitFor(() => expect(screen.getByRole('switch', { name: 'Auto pay' }).closest('[data-autopay-card]'))
            .toHaveTextContent('Sends no more than 1.2 BTC for this order'));
    });

    it('composes a buy with Buy chosen (Limit)', async () => {
        mountPanel({ side: 'buy' });
        await fillLimit();
        await placeOrder();
        await waitFor(() => expect(state.runs).toHaveLength(1));
        expect(state.runs[0].actionData.params).toMatchObject({
            GIVE_TICK: '', GIVE_AMOUNT: '0.8', GET_TICK: 'XCHAIN', GET_AMOUNT: '2',
        });
    });

    it('prices a Market sell at the best bid even when the page opened to buy', async () => {
        mountPanel({ side: undefined, initialOrderType: 'market' });
        await waitForAddress();
        fireEvent.change(screen.getByLabelText('Amount (XCHAIN)'), { target: { value: '2' } });
        pickSide('Sell');
        await waitFor(() => expect(screen.getByLabelText('Price')).toHaveValue('0.5'));
        await placeOrder();
        await waitFor(() => expect(state.runs).toHaveLength(1));
        expect(state.runs[0].actionData.params).toMatchObject({
            GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '2', GET_TICK: '', GET_AMOUNT: '1',
        });
    });

    it('prices a Market buy at the best ask', async () => {
        mountPanel({ side: undefined, initialOrderType: 'market' });
        await waitForAddress();
        fireEvent.change(screen.getByLabelText('Amount (XCHAIN)'), { target: { value: '2' } });
        await placeOrder();
        await waitFor(() => expect(state.runs).toHaveLength(1));
        expect(state.runs[0].actionData.params).toMatchObject({
            GIVE_TICK: '', GIVE_AMOUNT: '1.2', GET_TICK: 'XCHAIN', GET_AMOUNT: '2',
        });
    });

    it('runs Place Order through the guard: an empty order stops before any compose', async () => {
        mountPanel({ side: 'sell' });
        await waitForAddress();
        await placeOrder();
        await waitFor(() => expect(screen.getByText('Price and size are required.')).toBeInTheDocument());
        expect(state.runs).toEqual([]);
    });

    it('shows the CoinPay notice when the chosen side gives the coin, and not otherwise', async () => {
        mountPanel({ side: 'sell' });
        await waitForAddress();
        expect(screen.queryByRole('switch', { name: 'Auto pay' })).toBeNull();
        pickSide('Buy');
        const autopay = screen.getByRole('switch', { name: 'Auto pay' });
        expect(autopay).toBeChecked();
        expect(autopay.closest('[data-autopay-card]')).toHaveTextContent("Pays each match's BTC before its window (about 2 hours) closes");
    });
});
