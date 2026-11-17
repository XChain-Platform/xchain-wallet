// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's blue balance box carries the currency swap first, then the eye, as
// two round buttons in the card.

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

// The unit swap is the card's first round button, then the eye; no menu holds them.
function cardButtons() {
    return screen.getAllByRole('button');
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

        const swap = screen.getByRole('button', { name: 'Show in BTC' });
        expect(swap).not.toBeDisabled();
        expect(cardButtons().map((button) => button.getAttribute('aria-label'))).toEqual(['Show in BTC', 'Hide balance']);
        expect(cardButtons()[0]).toBe(swap);
        expect(screen.queryByRole('button', { name: 'Balance actions' })).toBeNull();

        fireEvent.click(swap);
        await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
        expect(screen.getByText('BTC')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Show in USD' }));
        await waitFor(() => expect(screen.getByText(/100,000\.00/)).toBeTruthy());
        expect(screen.getByText('USD')).toBeTruthy();
    });

    it('disables the swap when the coin has no price', () => {
        mount({ nativePriceMap: {} });
        expect(screen.getByRole('button', { name: 'Show in BTC' })).toBeDisabled();
    });

    it('uses the filtered network coin when one network is chosen', () => {
        const ltc = { ...BTC_ROW, chainId: 'litecoin-mainnet', tick: 'LTC', fiatRate: 100 };
        mount({ rows: [ltc], networkFilter: 'litecoin-mainnet', nativePriceMap: { 'litecoin-mainnet': { priceFiat: 100, change24hPct: 0 } } });
        expect(screen.getByRole('button', { name: 'Show in LTC' })).not.toBeDisabled();
    });
});
