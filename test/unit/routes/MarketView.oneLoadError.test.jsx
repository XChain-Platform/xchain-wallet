// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The market, price and order-book loads share one page error that names what
// could not load, with one Try again that reloads all three.

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

vi.mock('lightweight-charts', () => {
    const stub = () => new Proxy(() => {}, {
        get: (_target, property) => (typeof property === 'symbol' || property === 'then' ? undefined : stub()),
        apply: () => stub(),
    });
    return { createChart: () => stub(), ColorType: { Solid: 'solid' }, CrosshairMode: {}, LineStyle: {}, PriceScaleMode: {} };
});

import { MarketView } from '../../../packages/core/src/shared/routes/MarketView.jsx';

const settle = () => act(() => new Promise((resolve) => { setTimeout(resolve, 50); }));
const errors = (container) => [...container.querySelectorAll('[data-variant="error"]')];

let saved;
beforeAll(() => {
    class Stub { observe() {} unobserve() {} disconnect() {} }
    saved = { ro: globalThis.ResizeObserver, io: globalThis.IntersectionObserver };
    globalThis.ResizeObserver = Stub;
    globalThis.IntersectionObserver = Stub;
});
afterAll(() => {
    globalThis.ResizeObserver = saved.ro;
    globalThis.IntersectionObserver = saved.io;
});
afterEach(cleanup);

function mount() {
    return render(<MarketView walletId="wallet-1" chainId="bitcoin-mainnet" tick1="XCP" tick2="BTC" onBack={() => {}} />);
}

describe('MarketView load failures', () => {
    it('shows one error naming what failed, and one Try again reloads all three', async () => {
        const down = () => Promise.reject(Object.assign(new Error('Explorer returned HTTP 500'), { status: 500 }));
        messaging = { getMarket: vi.fn(down), getMarketHistory: vi.fn(down), getOrderbook: vi.fn(down) };
        const { container } = mount();
        await settle();
        const shown = errors(container);
        expect(shown).toHaveLength(1);
        expect(shown[0]).toHaveTextContent("Couldn't load market details, prices and order book.");
        expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);

        const before = [messaging.getMarket, messaging.getMarketHistory, messaging.getOrderbook].map((fn) => fn.mock.calls.length);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await settle();
        const after = [messaging.getMarket, messaging.getMarketHistory, messaging.getOrderbook].map((fn) => fn.mock.calls.length);
        after.forEach((count, i) => expect(count).toBeGreaterThan(before[i]));
        expect(errors(container)).toHaveLength(1);
    });

    it('names only the load that failed', async () => {
        messaging = {
            getMarket: vi.fn(() => Promise.resolve({})),
            getMarketHistory: vi.fn(() => Promise.resolve([])),
            getOrderbook: vi.fn(() => Promise.reject(new Error('Failed to fetch'))),
        };
        const { container } = mount();
        await settle();
        const shown = errors(container);
        expect(shown).toHaveLength(1);
        expect(shown[0]).toHaveTextContent("Couldn't load order book.");
    });
});
