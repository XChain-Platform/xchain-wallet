// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's Balance actions menu holds the currency swap first, then the chart
// and balance toggles, as every blue balance box does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TotalBalanceHero } from '../../../packages/core/src/shared/components/TotalBalanceHero.jsx';

const BTC_ROW = {
    kind: 'native',
    chainId: 'bitcoin-mainnet',
    tick: 'BTC',
    quantity: '200000000',
    divisibility: 8,
    fiatRate: 50000,
};

function mount({ rows = [BTC_ROW], nativePriceMap, networkFilter = 'all' } = {}) {
    const messaging = {
        getSettings: vi.fn(async () => ({})),
        getNativePricesRequest: vi.fn(async () => ({ prices: {} })),
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TotalBalanceHero rows={rows} walletId="w1" networkFilter={networkFilter} nativePriceMap={nativePriceMap} />
        </MessagingProvider>,
    );
}

function menuRows() {
    fireEvent.click(screen.getByRole('button', { name: 'Balance actions' }));
    return screen.getAllByRole('menuitem').concat(screen.queryAllByRole('menuitemcheckbox'));
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

describe('TotalBalanceHero currency swap', () => {
    it('lists the swap first and shows the total in BTC and back', async () => {
        mount({ nativePriceMap: { 'bitcoin-mainnet': { priceFiat: 50000, change24hPct: 0 } } });
        await waitFor(() => expect(screen.getByText(/100,000\.00/)).toBeTruthy());

        const rows = menuRows();
        const swap = screen.getByRole('menuitem', { name: 'Show in BTC' });
        expect(swap).not.toHaveAttribute('aria-disabled', 'true');
        const order = [...document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')];
        expect(order[0]).toBe(swap);
        expect(rows.length).toBeGreaterThan(2);

        fireEvent.click(swap);
        await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
        expect(screen.getByText('BTC')).toBeTruthy();

        menuRows();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Show in USD' }));
        await waitFor(() => expect(screen.getByText(/100,000\.00/)).toBeTruthy());
        expect(screen.getByText('USD')).toBeTruthy();
    });

    it('disables the swap when the coin has no price', () => {
        mount({ nativePriceMap: {} });
        menuRows();
        expect(screen.getByRole('menuitem', { name: 'Show in BTC' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('uses the filtered network coin when one network is chosen', () => {
        const ltc = { ...BTC_ROW, chainId: 'litecoin-mainnet', tick: 'LTC', fiatRate: 100 };
        mount({ rows: [ltc], networkFilter: 'litecoin-mainnet', nativePriceMap: { 'litecoin-mainnet': { priceFiat: 100, change24hPct: 0 } } });
        menuRows();
        expect(screen.getByRole('menuitem', { name: 'Show in LTC' })).not.toHaveAttribute('aria-disabled', 'true');
    });
});
