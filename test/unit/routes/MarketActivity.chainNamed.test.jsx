// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The same dispenser, order, dispense and swap on several chains share
// title and subtitle text, so only the chain icon tells them apart. A
// section that spans chains names each row's chain in the row's own text.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

describe('Marketplace rows spanning several chains', () => {
    it('gives every identical row distinct title and subtitle text that names its chain', async () => {
        renderMarket();
        await screen.findByRole('region', { name: 'Marketplace activity' });
        await screen.findByRole('region', { name: 'Open dispensers' });
        await vi.waitFor(() => {
            expect(document.querySelectorAll('section[aria-label="Recent DEX swaps"] li').length).toBeGreaterThan(1);
        });
        for (const label of ['Open dispensers', 'Open DEX orders', 'Recent dispenses', 'Recent DEX swaps']) {
            const section = screen.getByRole('region', { name: label });
            const rows = [...section.querySelectorAll('li')];
            expect(rows.length, label).toBeGreaterThan(1);
            const titles = rows.map((li) => li.querySelector('[class*="title"]')?.textContent);
            const subtitles = rows.map((li) => li.querySelector('[class*="subtitle"]')?.textContent);
            expect(new Set(titles).size, `${label} titles`).toBe(rows.length);
            // An order row carries no subtitle; its title names the chain.
            const shown = subtitles.filter((text) => text != null);
            expect(new Set(shown).size, `${label} subtitles`).toBe(shown.length);
            for (const li of rows) {
                expect(li.textContent).toMatch(/Bitcoin|Litecoin|Dogecoin/);
            }
        }
    });
});
