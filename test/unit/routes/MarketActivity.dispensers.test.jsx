// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Marketplace kept only dispenser rows whose status was numerically 0,
// but the explorer sends the string 'valid', so every real offer was dropped;
// and both offers and recent dispenses read field names the explorer does not
// send. Rows here are shaped as the explorer's token lanes serve them.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketActivity } from '../../../packages/core/src/shared/routes/MarketActivity.jsx';
import { formatLocalDateTime } from '../../../packages/core/src/shared/utils/dateTime.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const ORACLE = 'bcrt1qoracleoracleoracleoracleoracleoracle';
const offer = (idx, extra) => ({
    action_index: idx, status: 'valid', current_status: 'open', give_tick: 'XCHAIN', get_tick: null,
    get_coin: 'BTC', escrow_remaining: '100', ...extra,
});
const OFFERS = [
    offer('20', { give_amount: '5', get_amount: '0.01' }),
    offer('21', { give_amount: '2', get_amount: '0', oracle_address: ORACLE }),
    offer('22', { give_amount: '7', get_amount: '0.03', current_status: 'cancelled' }),
];
const DISPENSES = [
    { action_index: '30', status: 'valid', give_tick: 'XCHAIN', give_amount: '15', get_coin: 'BTC', get_tick: null, get_amount: '0.03', timestamp: 1785186698 },
    { action_index: '31', status: 'invalid: no matching oracle price', give_tick: 'XCHAIN', give_amount: '2', get_coin: 'BTC', get_tick: null, get_amount: '0.5', timestamp: 1785186699 },
];

function renderMarket(extra = {}, props = {}) {
    // One chain answers; the rest of the fan-out is empty, so each row renders once.
    const once = (rows) => {
        let answered = false;
        return vi.fn().mockImplementation(() => {
            if (answered) return Promise.resolve({ data: [] });
            answered = true;
            return Promise.resolve({ data: rows });
        });
    };
    const messaging = {
        getDispensersForToken: once(OFFERS),
        getDispenses: once(DISPENSES),
        getOrdersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getSwapsForToken: vi.fn().mockResolvedValue({ data: [] }),
        getOrderDetail: vi.fn(async () => null),
        getSwapDetail: vi.fn(async () => null),
        oracleFeeds: vi.fn().mockResolvedValue([{ tick: 'XCHAIN', fiat: 'USD', live: { value: '0.5' } }]),
        ...extra,
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(MarketActivity, { walletId: 'w1', onBack() {}, ...props }),
    ));
    return messaging;
}

describe('Marketplace on explorer-shaped rows', () => {
    it('lists open offers with their terms and stock', async () => {
        renderMarket();
        expect(await screen.findByText('5 XCHAIN per 0.01 BTC')).toBeInTheDocument();
        expect(screen.getAllByText('100 XCHAIN remaining').length).toBe(2);
        expect(screen.queryByText(/7 XCHAIN per/)).toBeNull();
        expect(screen.queryByRole('button', { name: /5 XCHAIN per 0.01 BTC/ })).toBeNull();
        expect(screen.queryAllByRole('button').filter((button) => button.disabled)).toHaveLength(0);
    });

    it('makes an offer a button only when the route supplies a working action', async () => {
        const onOpenDispenser = vi.fn();
        renderMarket({}, { onOpenDispenser });
        const button = await screen.findByRole('button', { name: /5 XCHAIN per 0.01 BTC/ });
        fireEvent.click(button);
        expect(onOpenDispenser).toHaveBeenCalledWith(expect.any(String), '20');
    });

    it('prices a Mode B offer from its oracle, never as zero coin', async () => {
        renderMarket();
        expect(await screen.findByText(/2 XCHAIN per 1 USD \(oracle /)).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/per 0 BTC/);
    });

    it('shows when an open dispenser has no usable recent price', async () => {
        renderMarket({
            getDispensersForToken: (() => {
                let answered = false;
                return vi.fn().mockImplementation(() => {
                    if (answered) return Promise.resolve({ data: [] });
                    answered = true;
                    return Promise.resolve({ data: [{ ...OFFERS[1], price_stale: true }] });
                });
            })(),
        });
        expect(await screen.findByText('Not selling right now: no price in the last 24 hours'))
            .toBeInTheDocument();
    });

    it('shows a real dispense with what was paid, and leaves out a refused one', async () => {
        renderMarket();
        expect(await screen.findByText('Sold 15 XCHAIN for 0.03 BTC')).toBeInTheDocument();
        expect(screen.queryByText(/Sold 2 XCHAIN/)).toBeNull();
    });

    it('shows recent activity through the shared relative-time display', async () => {
        const timestamp = DISPENSES[0].timestamp;
        vi.spyOn(Date, 'now').mockReturnValue(timestamp * 1000 + 5 * 60_000);
        renderMarket();

        const sale = await screen.findByText('Sold 15 XCHAIN for 0.03 BTC');
        const time = within(sale.closest('li')).getByText('5 minutes ago');
        expect(time.tagName).toBe('TIME');
        expect(time).toHaveAttribute('title', formatLocalDateTime(timestamp));
    });

    it('shows open DEX orders using explorer amount and coin fields', async () => {
        const open = {
            action_index: '40', status: 'valid',
            give_tick: 'XCHAIN', give_coin: 'BTC', give_amount: '25',
            get_tick: null, get_coin: 'BTC', get_amount: '0.01',
        };
        const closed = { ...open, action_index: '41', give_amount: '99', order_status: 'cancelled' };
        renderMarket({
            getOrdersForToken: vi.fn()
                .mockResolvedValueOnce({ data: [open, closed] })
                .mockResolvedValue({ data: [] }),
            getOrderDetail: vi.fn(async ({ actionIndex }) => ({ state: actionIndex === '40'
                ? { status: 'open', give_remaining: '10', get_remaining: '0.004' }
                : { status: 'cancelled', give_remaining: '0', get_remaining: '0' } })),
        });
        expect(await screen.findByText('Sell 10 XCHAIN for 0.004 BTC')).toBeInTheDocument();
        expect(screen.queryByText(/Sell 99 XCHAIN/)).toBeNull();
    });

    it('shows DEX swaps using explorer amount and coin fields', async () => {
        const settled = {
            action_index: '50', status: 'valid', swap_status: 'complete',
            give_tick: null, give_coin: 'BTC', give_amount: '0.08',
            get_tick: 'XCHAIN', get_coin: 'BTC', get_amount: '3200', timestamp: 1785186698,
        };
        const cancelled = { ...settled, action_index: '51', swap_status: 'cancelled', get_amount: '9999' };
        renderMarket({
            getSwapsForToken: vi.fn()
                .mockResolvedValueOnce({ data: [settled, cancelled] })
                .mockResolvedValue({ data: [] }),
        });
        expect(await screen.findByText('Bought 3,200 XCHAIN for 0.08 BTC')).toBeInTheDocument();
        expect(screen.queryByText(/9,999 XCHAIN/)).toBeNull();
    });
});

describe('demo Marketplace feed', () => {
    it('is shaped like the explorer, so the demo drives the real render path', async () => {
        const { synthesizeDemoMarketActivity } = await import('../../../packages/core/src/flows/demoFixtures.js');
        const { dispenserRateLabel, isOpenDispenserSelling } = await import('../../../packages/core/src/shared/utils/dispenserPricing.js');
        const { dispenseIsValid } = await import('../../../packages/core/src/flows/dispenserQueries.js');
        const demo = synthesizeDemoMarketActivity('XCHAIN', { now: 1785186698000 });
        const rare = synthesizeDemoMarketActivity('RAREPEPE', { now: 1785186698000 });
        const pepecash = synthesizeDemoMarketActivity('PEPECASH', { now: 1785186698000 });
        expect(rare.offers.map(({ row }) => isOpenDispenserSelling(row, 'RAREPEPE'))).toEqual([true]);
        expect(rare.offers.map(({ row }) => dispenserRateLabel(row))).toEqual(['1 RAREPEPE per 0.005 BTC']);
        expect(pepecash.offers.map(({ row }) => dispenserRateLabel(row))).toEqual(['500 PEPECASH per 5 XCP']);
        expect(demo.sales.every(({ row }) => dispenseIsValid(row) && Number(row.get_amount) > 0)).toBe(true);
        expect(demo.dexOrders.every(({ row }) => row.status === 'valid'
            && row.give_amount != null && row.get_amount != null
            && row.give_quantity === undefined && row.get_quantity === undefined)).toBe(true);
        expect(demo.dexSwaps.every(({ row }) => row.status === 'valid'
            && row.swap_status === 'complete'
            && row.give_amount != null && row.get_amount != null
            && row.give_quantity === undefined && row.get_quantity === undefined)).toBe(true);
    });

    // Demo listings used ids no demo dispenser had, so every tap opened
    // "Dispenser not found". Each listing must be a demo dispenser the detail
    // page resolves on the same chain.
    it('lists only demo dispensers the detail page resolves', async () => {
        const { synthesizeDemoMarketActivity, synthesizeDemoDispensers } = await import('../../../packages/core/src/flows/demoFixtures.js');
        const networks = [
            ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'],
            ['bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest'],
        ];
        const ticks = ['XCHAIN', 'RAREPEPE', 'PEPECASH', 'BANANE', 'EXAMPLE', 'MWEB', 'DOGI', 'WOW', 'NOSUCHTOKEN'];
        let listed = 0;
        for (const chainIds of networks) {
            for (const tick of ticks) {
                const { offers } = synthesizeDemoMarketActivity(tick, { chainIds });
                for (const { chainId, row } of offers) {
                    listed += 1;
                    expect(chainIds).toContain(chainId);
                    const resolved = synthesizeDemoDispensers(chainId, 'demo-owner')
                        .find((r) => String(r.action_index) === String(row.action_index));
                    expect(resolved, `${tick} #${row.action_index} on ${chainId}`).toBeTruthy();
                    expect(resolved.give_tick).toBe(tick);
                    expect(resolved.status).toBe('open');
                }
            }
            // Every open demo dispenser shows on its token's market.
            expect(synthesizeDemoMarketActivity('RAREPEPE', { chainIds }).offers.map(({ row }) => row.action_index)).toEqual(['4200981']);
            expect(synthesizeDemoMarketActivity('MWEB', { chainIds }).offers.map(({ row }) => row.action_index)).toEqual(['2107744']);
            expect(synthesizeDemoMarketActivity('DOGI', { chainIds }).offers.map(({ row }) => row.action_index)).toEqual(['7301556']);
        }
        expect(listed).toBeGreaterThan(0);
    });
});

describe('Marketplace network scope', () => {
    it('queries and badges only the active network', async () => {
        const messaging = renderMarket({
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest' }),
        });
        expect(await screen.findByText('5 XCHAIN per 0.01 BTC')).toBeInTheDocument();
        const asked = messaging.getDispensersForToken.mock.calls.map(([args]) => args.chainId);
        expect(asked.length).toBeGreaterThan(0);
        expect(asked.every((chainId) => chainId.endsWith('-regtest'))).toBe(true);
        const selector = screen.getByRole('button', { name: /Change market/ });
        const marks = [...selector.querySelectorAll('img')].map((img) => img.getAttribute('src'));
        expect(marks.length).toBeGreaterThan(0);
        expect(marks.every((src) => /regtest/.test(src))).toBe(true);
    });
});
