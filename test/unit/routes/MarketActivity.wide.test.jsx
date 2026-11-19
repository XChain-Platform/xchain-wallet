// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MarketActivity } from '../../../packages/core/src/shared/routes/MarketActivity.jsx';
import { readFileSync } from 'node:fs';

const token = (tick, displayName) => ({
    tick,
    displayName,
    quantity: '25',
    divisibility: 0,
});

function messagingStub() {
    const balances = {
        'bitcoin-mainnet': [{
            address: 'bc1qmarketplace',
            balances: {
                native: token('BTC', 'Bitcoin'),
                tokens: [token('XCHAIN', 'XChain')],
            },
        }],
    };
    return {
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [{ address: 'bc1qmarketplace' }],
        }),
        getWalletBalances: vi.fn().mockResolvedValue(balances),
        searchTokens: vi.fn().mockResolvedValue([]),
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getOrdersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getSwapsForToken: vi.fn().mockResolvedValue({ data: [] }),
        oracleFeeds: vi.fn().mockResolvedValue([]),
    };
}

function mount(width) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width,
        height: 800,
        top: 0,
        right: width,
        bottom: 800,
        left: 0,
        x: 0,
        y: 0,
        toJSON() {},
    });
    const messaging = messagingStub();
    const onBack = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MarketActivity walletId="wallet-1" onBack={onBack} />
        </MessagingProvider>,
    );
    return { messaging, onBack };
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('Marketplace list-detail layout', () => {
    it('shows the picker and first market in two panels at wide widths', async () => {
        mount(900);

        const split = await waitFor(() => document.querySelector('[data-list-detail="marketplace"]'));
        expect(split).not.toBeNull();
        expect(screen.getByRole('region', { name: 'Marketplace markets' })).toBeInTheDocument();
        expect(await screen.findByRole('region', { name: 'BTC marketplace' })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'BTC market' })).toBeInTheDocument();

        const heading = screen.getByRole('heading', { name: 'Marketplace' });
        const pageHeader = heading.parentElement?.parentElement;
        const filter = within(pageHeader).getByRole('button', { name: 'Filter markets' });
        expect(screen.queryByText('Markets', { selector: 'span' })).toBeNull();
        expect(split.querySelector('[class*="listHeader"]')).toBeNull();

        fireEvent.click(filter);
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search coins or tokens' }), {
            target: { value: 'bit' },
        });
        expect(filter).toHaveAttribute('data-active', 'true');

        const bitcoin = screen.getByRole('button', { name: /^Select Bitcoin\b/ });
        expect(bitcoin).toHaveAttribute('aria-current', 'true');
        expect(screen.queryByRole('button', { name: /Change market/ })).toBeNull();

        const resize = screen.getByRole('separator', { name: 'Resize the marketplace list' });
        const startingWidth = Number(resize.getAttribute('aria-valuenow'));
        fireEvent.keyDown(resize, { key: 'ArrowRight' });
        expect(Number(resize.getAttribute('aria-valuenow'))).toBeGreaterThan(startingWidth);
    });

    it('swaps the selected market in place without navigation', async () => {
        const { onBack } = mount(900);
        await screen.findByRole('region', { name: 'BTC market' });
        const historyLength = window.history.length;
        const list = screen.getByRole('region', { name: 'Marketplace markets' });
        const xchain = within(list).getByRole('button', { name: /^Select XChain\b/ });

        fireEvent.click(xchain);

        expect(await screen.findByRole('region', { name: 'XCHAIN market' })).toBeInTheDocument();
        expect(xchain).toHaveAttribute('aria-current', 'true');
        expect(screen.queryByRole('region', { name: 'BTC market' })).toBeNull();
        expect(window.history.length).toBe(historyLength);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('keeps the existing picker navigation at narrow widths', async () => {
        mount(600);

        const selector = await screen.findByRole('button', { name: /Change market/ });
        const heading = screen.getByRole('heading', { name: 'Marketplace' });
        expect(within(heading.parentElement?.parentElement).getByRole('button', { name: 'Filter markets' }))
            .toBeInTheDocument();
        expect(document.querySelector('[data-list-detail="marketplace"]')).toBeNull();
        expect(screen.queryByRole('region', { name: 'Marketplace markets' })).toBeNull();

        fireEvent.click(selector);

        expect(await screen.findByRole('heading', { name: 'Select a Market' })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Marketplace markets' })).toBeNull();
    });

    it('lets the right-panel detail fill its available width without a centred cap', async () => {
        mount(900);

        const detail = await waitFor(() => document.querySelector('[data-marketplace-detail]'));
        expect(detail).not.toBeNull();
        const css = readFileSync('packages/core/src/shared/routes/MarketActivity.module.css', 'utf8');
        const layoutRule = css.match(/\.layout\s*\{([^}]*)\}/)?.[1] || '';
        expect(layoutRule).toMatch(/width:\s*100%/);
        expect(layoutRule).not.toMatch(/max-width|margin-inline/);
    });
});
