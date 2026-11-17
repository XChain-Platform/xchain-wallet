// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Operator ruling 2026-11-14: each Market activity tab shows just its list.
// No "Offers, cheapest first" / "Recent swaps" / "Recent trades" title row and
// no "N open" / "N recent" count sits above the rows.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketActivity } from '../../../packages/core/src/shared/routes/MarketActivity.jsx';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const NOW = 1785186698;
const dispenser = { action_index: '20', status: 'valid', current_status: 'open', give_tick: 'XCHAIN', get_coin: 'BTC', give_amount: '5', get_amount: '0.01', escrow_remaining: '100' };
const dispense = { action_index: '30', status: 'valid', give_tick: 'XCHAIN', give_amount: '15', get_coin: 'BTC', get_amount: '0.03', timestamp: NOW };
const order = { action_index: '40', status: 'valid', give_tick: 'XCHAIN', give_coin: 'BTC', give_amount: '25', get_tick: null, get_coin: 'BTC', get_amount: '0.01' };
const swap = { action_index: '50', status: 'valid', swap_status: 'complete', give_tick: 'XCHAIN', give_amount: '8', get_tick: null, get_coin: 'BTC', get_amount: '0.02', timestamp: NOW };

function renderMarket() {
    const messaging = {
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [dispenser] }),
        getDispenses: vi.fn().mockResolvedValue({ data: [dispense] }),
        getOrdersForToken: vi.fn().mockResolvedValue({ data: [order] }),
        getSwapsForToken: vi.fn().mockResolvedValue({ data: [swap] }),
        getOrderDetail: vi.fn(async () => null),
        getSwapDetail: vi.fn(async () => null),
        oracleFeeds: vi.fn().mockResolvedValue([]),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest' }),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(MarketActivity, { walletId: 'w1', onBack() {} }),
    ));
}

describe('Marketplace tab lists carry no title or count row', () => {
    it('puts the rows first in each tab card, with no heading and no count text', async () => {
        renderMarket();
        await screen.findByRole('region', { name: 'Marketplace activity' });
        for (const [tab, label] of [
            ['Offers', 'Offers'],
            ['Swaps', 'Recent DEX swaps'],
            ['Trades', 'Recent trades'],
        ]) {
            fireEvent.click(await screen.findByRole('tab', { name: tab }));
            await vi.waitFor(() => {
                expect(document.querySelectorAll(`section[aria-label="${label}"] li`).length).toBeGreaterThan(0);
            });
            const section = screen.getByRole('region', { name: label });
            expect(section.querySelector('h1, h2, h3, h4, h5, h6'), label).toBeNull();
            // The list is the section's first element child: nothing sits above it.
            expect(section.firstElementChild?.tagName, label).toBe('UL');
            expect(section.textContent, label).not.toMatch(/cheapest first|\d+ open\b|\d+ recent\b/i);
            expect(section.textContent, label).not.toMatch(/^\s*Recent (swaps|trades)/);
        }
    });
});
