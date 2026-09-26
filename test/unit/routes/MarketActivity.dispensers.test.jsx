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
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketActivity } from '../../../packages/core/src/shared/routes/MarketActivity.jsx';

afterEach(() => cleanup());

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

function renderMarket(extra = {}) {
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
        oracleFeeds: vi.fn().mockResolvedValue([{ tick: 'XCHAIN', fiat: 'USD', live: { value: '0.5' } }]),
        ...extra,
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(MarketActivity, { walletId: 'w1', onBack() {} }),
    ));
    return messaging;
}

describe('Marketplace on explorer-shaped rows', () => {
    it('lists open offers with their terms and stock', async () => {
        renderMarket();
        expect(await screen.findByText('5 XCHAIN per 0.01 BTC')).toBeInTheDocument();
        expect(screen.getAllByText('100 XCHAIN remaining').length).toBe(2);
        expect(screen.queryByText(/7 XCHAIN per/)).toBeNull();
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

    it('shows open DEX orders using explorer amount and coin fields', async () => {
        const open = {
            action_index: '40', status: 'valid', order_status: 'open',
            give_tick: 'XCHAIN', give_coin: 'BTC', give_amount: '25',
            get_tick: null, get_coin: 'BTC', get_amount: '0.01',
        };
        const closed = { ...open, action_index: '41', give_amount: '99', order_status: 'cancelled' };
        renderMarket({
            getOrdersForToken: vi.fn()
                .mockResolvedValueOnce({ data: [open, closed] })
                .mockResolvedValue({ data: [] }),
        });
        expect(await screen.findByText('Sell 25 XCHAIN for 0.01 BTC')).toBeInTheDocument();
        expect(screen.queryByText(/Sell 99 XCHAIN/)).toBeNull();
    });

    it('shows DEX swaps using explorer amount and coin fields', async () => {
        const settled = {
            action_index: '50', status: 'valid', swap_status: 'settled',
            give_tick: null, give_coin: 'BTC', give_amount: '0.08',
            get_tick: 'XCHAIN', get_coin: 'BTC', get_amount: '3200', timestamp: 1785186698,
        };
        renderMarket({
            getSwapsForToken: vi.fn()
                .mockResolvedValueOnce({ data: [settled] })
                .mockResolvedValue({ data: [] }),
        });
        expect(await screen.findByText('Bought 3,200 XCHAIN for 0.08 BTC')).toBeInTheDocument();
    });
});

describe('demo Marketplace feed', () => {
    it('is shaped like the explorer, so the demo drives the real render path', async () => {
        const { synthesizeDemoMarketActivity } = await import('../../../packages/core/src/flows/demoFixtures.js');
        const { dispenserRateLabel, isOpenDispenserSelling } = await import('../../../packages/core/src/shared/utils/dispenserPricing.js');
        const { dispenseIsValid } = await import('../../../packages/core/src/flows/dispenserQueries.js');
        const demo = synthesizeDemoMarketActivity('XCHAIN', { now: 1785186698000 });
        expect(demo.offers.map(({ row }) => isOpenDispenserSelling(row, 'XCHAIN'))).toEqual([true, true]);
        expect(demo.offers.map(({ row }) => dispenserRateLabel(row))).toEqual([
            '1,000 XCHAIN per 0.02 BTC', '500 XCHAIN per 0.01 BTC',
        ]);
        expect(demo.sales.every(({ row }) => dispenseIsValid(row) && Number(row.get_amount) > 0)).toBe(true);
        expect(demo.dexOrders.every(({ row }) => row.status === 'valid'
            && row.give_amount != null && row.get_amount != null
            && row.give_quantity === undefined && row.get_quantity === undefined)).toBe(true);
        expect(demo.dexSwaps.every(({ row }) => row.status === 'valid'
            && row.swap_status === 'settled'
            && row.give_amount != null && row.get_amount != null
            && row.give_quantity === undefined && row.get_quantity === undefined)).toBe(true);
    });
});
