// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';
import { synthesizeDemoMarketDispensers } from '../../../packages/core/src/flows/demoFixtures.js';

const CHAIN = 'bitcoin-mainnet';
const MARKET = { chainId: CHAIN, tick: 'PEPECASH', displayName: 'PEPECASH', kind: 'token' };
const SELLER_A = 'bc1qmarketselleralpha000000000000000000001';
const SELLER_B = 'bc1qmarketsellerbravo000000000000000000002';
const ROWS = [
    {
        action_index: '101', block_index: 500, source: SELLER_A,
        give_tick: 'PEPECASH', give_amount: '500', get_tick: 'XCP', get_amount: '5',
        current_status: 'open', escrow_remaining: '12500',
    },
    {
        action_index: '102', block_index: 490, source: SELLER_B,
        give_tick: 'RAREPEPE', give_amount: '1', get_tick: 'PEPECASH', get_amount: '2500',
        current_status: 'open', escrow_remaining: '18',
    },
    {
        action_index: '103', block_index: 480, source: SELLER_B,
        give_tick: 'OTHER', give_amount: '2', get_tick: 'XCP', get_amount: '1',
        current_status: 'open', escrow_remaining: '20',
    },
];

let layoutWidth = 0;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        if (this.hasAttribute('data-list-detail')) {
            return {
                width: layoutWidth, height: 800, top: 0, left: 0,
                right: layoutWidth, bottom: 800, x: 0, y: 0, toJSON() {},
            };
        }
        return realRect.call(this);
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    layoutWidth = 0;
});

function makeMessaging(rows = ROWS) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getDispensersForSource: vi.fn().mockResolvedValue({ data: [] }),
        getDispensersForToken: vi.fn().mockResolvedValue({ data: rows }),
    };
}

function renderMarket(messaging, {
    width = 1046,
    marketAsset = MARKET,
    onOpenDispenser = vi.fn(),
    onChangeMarket = vi.fn(),
} = {}) {
    layoutWidth = width;
    const result = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DispensersList
                walletId="wallet-market"
                onBack={() => {}}
                onOpenDispenser={onOpenDispenser}
                onChangeMarket={onChangeMarket}
                marketAsset={marketAsset}
                renderDispenser={(ref) => <h2>{`Detail ${ref.actionIndex}`}</h2>}
            />
        </MessagingProvider>,
    );
    return { ...result, onOpenDispenser, onChangeMarket };
}

describe('Dispensers market view', () => {
    it('shows both toggles, bulk-loads Buy, and preselects the first matching row', async () => {
        const messaging = makeMessaging();
        renderMarket(messaging);

        expect(screen.getByRole('heading', { level: 1, name: 'Dispensers' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: 'Buy' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('button', { name: 'Change market (currently PEPECASH)' })).toBeInTheDocument();

        const detail = await screen.findByRole('region', { name: 'PEPECASH dispenser #101' });
        expect(within(detail).getByRole('heading', { name: 'Detail 101' })).toBeInTheDocument();
        expect(screen.getByText('Get 500 PEPECASH')).toBeInTheDocument();
        expect(screen.getByText('Pay 5 XCP per dispense')).toBeInTheDocument();
        expect(screen.getByText('12,500 PEPECASH left')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Open OTHER dispenser #103' })).toBeNull();
        expect(messaging.getDispensersForToken).toHaveBeenCalledOnce();
        expect(messaging.getDispensersForToken).toHaveBeenCalledWith({ chainId: CHAIN, token: 'PEPECASH' });
        expect(messaging.getAddressesByChain).not.toHaveBeenCalled();
        expect(messaging.getDispensersForSource).not.toHaveBeenCalled();
    });

    it('switches to Sell locally and swaps the detail without navigation or another read', async () => {
        const messaging = makeMessaging();
        const { onOpenDispenser } = renderMarket(messaging);
        await screen.findByRole('button', { name: 'Open PEPECASH dispenser #101' });

        fireEvent.click(screen.getByRole('radio', { name: 'Sell' }));

        const row = await screen.findByRole('button', { name: 'Open RAREPEPE dispenser #102' });
        expect(row).toHaveAttribute('aria-current', 'true');
        expect(screen.queryByRole('button', { name: 'Open PEPECASH dispenser #101' })).toBeNull();
        expect(await screen.findByRole('region', { name: 'RAREPEPE dispenser #102' })).toHaveTextContent('Detail 102');
        expect(screen.getByText('Pay 2,500 PEPECASH per dispense')).toBeInTheDocument();
        expect(messaging.getDispensersForToken).toHaveBeenCalledOnce();
        expect(onOpenDispenser).not.toHaveBeenCalled();
    });

    it('opens the shared picker and reloads once when the market changes', async () => {
        const messaging = makeMessaging();
        const onChangeMarket = vi.fn();
        const result = renderMarket(messaging, { onChangeMarket });
        await screen.findByRole('button', { name: 'Open PEPECASH dispenser #101' });

        fireEvent.click(screen.getByRole('button', { name: 'Change market (currently PEPECASH)' }));
        expect(onChangeMarket).toHaveBeenCalledOnce();

        const xcp = { chainId: CHAIN, tick: 'XCP', displayName: 'XCP', kind: 'token' };
        result.rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <DispensersList
                    walletId="wallet-market"
                    onBack={() => {}}
                    onOpenDispenser={() => {}}
                    onChangeMarket={onChangeMarket}
                    marketAsset={xcp}
                    renderDispenser={(ref) => <h2>{`Detail ${ref.actionIndex}`}</h2>}
                />
            </MessagingProvider>,
        );
        await waitFor(() => expect(messaging.getDispensersForToken).toHaveBeenCalledTimes(2));
        expect(messaging.getDispensersForToken).toHaveBeenLastCalledWith({ chainId: CHAIN, token: 'XCP' });
    });

    it('keeps narrow row navigation unchanged', async () => {
        const messaging = makeMessaging();
        const { onOpenDispenser } = renderMarket(messaging, { width: 640 });
        const row = await screen.findByRole('button', { name: 'Open PEPECASH dispenser #101' });
        expect(screen.queryByRole('separator')).toBeNull();
        fireEvent.click(row);
        expect(onOpenDispenser).toHaveBeenCalledWith(CHAIN, '101');
    });

    it.each([1, 25])('uses one market read for %i returned rows', async (count) => {
        const rows = Array.from({ length: count }, (_, index) => ({
            ...ROWS[0], action_index: String(200 + index), block_index: 800 - index,
        }));
        const messaging = makeMessaging(rows);
        renderMarket(messaging, { width: 640 });
        await screen.findByRole('button', { name: 'Open PEPECASH dispenser #200' });
        expect(messaging.getDispensersForToken).toHaveBeenCalledOnce();
    });

    it('shows an honest native market empty state without an unsupported read', () => {
        const messaging = makeMessaging();
        renderMarket(messaging, {
            width: 640,
            marketAsset: { chainId: CHAIN, tick: 'BTC', displayName: 'Bitcoin', kind: 'native' },
        });
        expect(screen.getByRole('heading', { name: 'Market unavailable' })).toBeInTheDocument();
        expect(messaging.getDispensersForToken).not.toHaveBeenCalled();
    });

    it('ships demo fixtures for both PEPECASH directions', () => {
        const rows = synthesizeDemoMarketDispensers(CHAIN, 'PEPECASH');
        expect(rows.some((row) => row.give_tick === 'PEPECASH')).toBe(true);
        expect(rows.some((row) => row.get_tick === 'PEPECASH')).toBe(true);
        expect(rows.every((row) => row.source && row.action_index)).toBe(true);
    });
});
