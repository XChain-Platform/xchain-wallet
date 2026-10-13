// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §45.4: a real wallet's portfolio chart draws only recorded prices. With
// no recorded history it says so instead of drawing a synthesized walk, and
// it offers only the ranges recorded history can fill. The demo wallet
// keeps its synthesized chart and every range.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PortfolioChart } from '../../../packages/core/src/shared/components/PortfolioChart.jsx';
import { markDemoWallet, clearDemoWalletId } from '../../../packages/core/src/flows/demoMode.js';

// 0.5 BTC at $80,000: a valued row, so the chart has something to draw.
const ROWS = [{ kind: 'native', chainId: 'bitcoin-mainnet', tick: 'BTC', quantity: '50000000', divisibility: 8, fiatRate: 80000 }];

function mount(walletId, prices) {
    const messaging = {
        getSettings: vi.fn(async () => ({})),
        getNativePricesRequest: vi.fn(async () => prices),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PortfolioChart rows={ROWS} walletId={walletId} />
        </MessagingProvider>,
    );
    return messaging;
}

function rangeLabels() {
    return screen.getAllByRole('tab').map((t) => t.textContent);
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
});

describe('PortfolioChart on a real wallet', () => {
    it('says there is no history instead of drawing a synthesized line', async () => {
        const messaging = mount('real-wallet-1', {});
        await waitFor(() => expect(messaging.getNativePricesRequest).toHaveBeenCalled());
        expect(await screen.findByText(/No price history/)).toBeTruthy();
        expect(document.querySelector('svg polyline')).toBeNull();
    });

    it('offers only the ranges recorded history covers, opening on 7d', async () => {
        mount('real-wallet-1', {});
        await screen.findByText(/No price history/);
        expect(rangeLabels()).toEqual(['24h', '7d']);
        const selected = screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true');
        expect(selected.textContent).toBe('7d');
    });

    it('draws the recorded sparkline when the price service has one', async () => {
        const sparkline = Array.from({ length: 168 }, (_, i) => 70000 + i * 50);
        mount('real-wallet-1', { prices: { 'bitcoin-mainnet': { sparkline } } });
        await waitFor(() => expect(document.querySelector('svg polyline')).not.toBeNull());
        expect(screen.queryByText(/No price history/)).toBeNull();

        const chart = screen.getByRole('img');
        expect(chart).toHaveAccessibleName(expect.stringMatching(
            /^Portfolio performance chart\. Range 7d\. Values range from .* Start .* End \$40,000\.00\. Change \+/,
        ));

        const tablist = screen.getByRole('tablist', { name: 'Chart range' });
        const panel = screen.getByRole('tabpanel');
        const selected = screen.getByRole('tab', { name: '7d' });
        const unselected = screen.getByRole('tab', { name: '24h' });
        expect(tablist).toContainElement(selected);
        expect(selected).toHaveAttribute('tabindex', '0');
        expect(selected).toHaveAttribute('aria-controls', panel.id);
        expect(panel).toHaveAttribute('aria-labelledby', selected.id);
        expect(unselected).toHaveAttribute('tabindex', '-1');
    });
});

describe('PortfolioChart on the demo wallet', () => {
    it('keeps the synthesized chart and every range', async () => {
        markDemoWallet('demo-wallet-1');
        mount('demo-wallet-1', {});
        await waitFor(() => expect(document.querySelector('svg polyline')).not.toBeNull());
        expect(rangeLabels()).toEqual(['24h', '7d', '30d', '90d', 'All']);
    });
});
