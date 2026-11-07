// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Home's total and a token's balance hero carry one shared "Balance actions"
// menu at every width: swap, chart and privacy toggles live inside it, never
// as a row of loose icon buttons beside the number.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TotalBalanceHero } from '../../../packages/core/src/shared/components/TotalBalanceHero.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const WIDTHS = [1440, 375];
const TICK = 'MENUPROBE';

let savedResizeObserver;
let savedInnerWidth;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
    savedInnerWidth = window.innerWidth;
});
afterAll(() => {
    globalThis.ResizeObserver = savedResizeObserver;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: savedInnerWidth });
});

function setViewport(width) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    vi.stubGlobal('matchMedia', vi.fn((query) => {
        const max = /max-width:\s*(\d+)px/.exec(query);
        const min = /min-width:\s*(\d+)px/.exec(query);
        let matches = true;
        if (max) matches = matches && width <= Number(max[1]);
        if (min) matches = matches && width >= Number(min[1]);
        if (!max && !min) matches = false;
        return {
            matches,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
        };
    }));
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    window.localStorage.clear();
    vi.unstubAllGlobals();
});

function messagingFor({ activeNetwork = 'mainnet' } = {}) {
    return {
        getSettings: vi.fn(async () => ({ walletMode: 'full', activeNetwork, fiatCurrency: 'USD' })),
        getNativePricesRequest: vi.fn(async () => ({ prices: {} })),
        getTokenInfo: vi.fn(async () => ({ creator: 'bc1qnotmine', divisibility: 0 })),
        getAddressesByChain: vi.fn(async () => ({})),
        getHoldersForToken: vi.fn(async () => ({ data: [] })),
        listGatedContent: vi.fn(async () => []),
        getSupplyHistory: vi.fn(async () => []),
    };
}

function homeHero() {
    return (
        <TotalBalanceHero
            rows={[{ kind: 'token', chainId: 'bitcoin-mainnet', tick: 'XCP', quantity: '123456', divisibility: 2, fiatRate: 1 }]}
            walletId="w1"
            networkFilter="all"
        />
    );
}

function tokenDetail({ fiatRate = 2, chainId = 'bitcoin-mainnet' } = {}) {
    return (
        <TokenDetail
            walletId="w1"
            chainId={chainId}
            tick={TICK}
            kind="token"
            quantity="100"
            divisibility={0}
            fiatRate={fiatRate}
            onBack={() => {}}
        />
    );
}

function renderWith(children, options) {
    return render(
        <MessagingProvider shell="web" messaging={messagingFor(options)}>
            {children}
        </MessagingProvider>,
    );
}

function homeRegion() {
    return screen.getByRole('region', { name: 'Active address balance' });
}

function tokenRegion() {
    return screen.getByRole('region', { name: `${TICK} balance` });
}

function openMenu(scope) {
    const trigger = within(scope).getByRole('button', { name: 'Balance actions' });
    fireEvent.click(trigger);
    return { trigger, menu: within(scope).getByRole('menu', { name: 'Balance actions' }) };
}

function amountCodes(scope) {
    return Array.from(scope.querySelectorAll('span'))
        .filter((span) => span.children.length === 0 && (span.textContent === 'USD' || span.textContent === TICK))
        .map((span) => span.textContent);
}

describe.each(WIDTHS)('balance hero menu at %ipx', (width) => {
    beforeEach(() => setViewport(width));

    it('gives Home one menu trigger and no loose hero buttons', () => {
        renderWith(homeHero());
        const hero = homeRegion();

        const triggers = within(hero).getAllByRole('button', { name: 'Balance actions' });
        expect(triggers).toHaveLength(1);
        expect(triggers[0]).toHaveAttribute('aria-haspopup', 'menu');
        expect(within(hero).getAllByRole('button')).toEqual(triggers);
        expect(screen.queryByRole('button', { name: 'Hide chart' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Hide balance' })).toBeNull();

        const { menu } = openMenu(hero);
        expect(within(menu).getByRole('menuitemcheckbox', { name: 'Hide chart' }))
            .toHaveAttribute('aria-checked', 'true');
        expect(within(menu).getByRole('menuitemcheckbox', { name: 'Hide balance' })).toBeInTheDocument();
    });

    it('gives the token hero one menu trigger that swaps the primary unit', async () => {
        renderWith(tokenDetail());
        const hero = tokenRegion();
        await waitFor(() => expect(amountCodes(hero)).toEqual([TICK, 'USD']));

        const triggers = within(hero).getAllByRole('button', { name: 'Balance actions' });
        expect(triggers).toHaveLength(1);
        expect(triggers[0]).toHaveAttribute('aria-haspopup', 'menu');
        expect(within(hero).getAllByRole('button')).toEqual(triggers);
        expect(screen.queryByRole('button', { name: 'Swap primary unit' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Hide chart' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Hide balance' })).toBeNull();

        const { menu } = openMenu(hero);
        const swap = within(menu).getByRole('menuitem', { name: 'Swap primary unit' });
        expect(swap).not.toBeDisabled();
        expect(within(menu).getByRole('menuitemcheckbox', { name: 'Hide chart' }))
            .toHaveAttribute('aria-checked', 'true');
        expect(within(menu).getByRole('menuitemcheckbox', { name: 'Hide balance' })).toBeInTheDocument();

        fireEvent.click(swap);
        expect(amountCodes(hero)).toEqual(['USD', TICK]);
        fireEvent.click(within(openMenu(hero).menu).getByRole('menuitem', { name: 'Swap primary unit' }));
        expect(amountCodes(hero)).toEqual([TICK, 'USD']);
    });

    it('keeps the swap row disabled without a price', async () => {
        renderWith(tokenDetail({ fiatRate: null }));
        const hero = tokenRegion();
        const { menu } = openMenu(hero);
        expect(within(menu).getByRole('menuitem', { name: 'Swap primary unit' })).toBeDisabled();
    });

    it('leaves the chart row out where fiat is unsupported', async () => {
        renderWith(tokenDetail({ fiatRate: null, chainId: 'bitcoin-regtest' }), { activeNetwork: 'regtest' });
        const hero = tokenRegion();
        await act(async () => { await Promise.resolve(); });
        const { menu } = openMenu(hero);
        expect(within(menu).queryByRole('menuitemcheckbox', { name: /chart/ })).toBeNull();
        expect(within(menu).getByRole('menuitem', { name: 'Swap primary unit' })).toBeInTheDocument();
        expect(within(menu).getByRole('menuitemcheckbox', { name: 'Hide balance' })).toBeInTheDocument();
    });
});

describe('balance hero menu state shared across surfaces', () => {
    beforeEach(() => setViewport(1440));

    it('hides the chart for both surfaces from either menu', async () => {
        renderWith(<>{homeHero()}{tokenDetail()}</>);

        fireEvent.click(within(openMenu(homeRegion()).menu).getByRole('menuitemcheckbox', { name: 'Hide chart' }));
        expect(window.localStorage.getItem('xc:portfolioChartVisible')).toBe('0');
        await act(async () => { await Promise.resolve(); });

        const tokenMenu = openMenu(tokenRegion()).menu;
        expect(within(tokenMenu).getByRole('menuitemcheckbox', { name: 'Show chart' }))
            .toHaveAttribute('aria-checked', 'false');
        fireEvent.click(within(tokenMenu).getByRole('menuitemcheckbox', { name: 'Show chart' }));
        expect(window.localStorage.getItem('xc:portfolioChartVisible')).toBe('1');
        await act(async () => { await Promise.resolve(); });

        expect(within(openMenu(homeRegion()).menu).getByRole('menuitemcheckbox', { name: 'Hide chart' }))
            .toHaveAttribute('aria-checked', 'true');
    });

    it('masks both amounts from either menu', async () => {
        renderWith(<>{homeHero()}{tokenDetail()}</>);
        expect(within(homeRegion()).queryByText('•••••')).toBeNull();
        expect(within(tokenRegion()).queryByText('•••••')).toBeNull();

        fireEvent.click(within(openMenu(tokenRegion()).menu).getByRole('menuitemcheckbox', { name: 'Hide balance' }));
        await act(async () => { await Promise.resolve(); });

        expect(within(homeRegion()).getByText('•••••')).toBeInTheDocument();
        expect(within(tokenRegion()).getByText('•••••')).toBeInTheDocument();
        expect(within(openMenu(homeRegion()).menu).getByRole('menuitemcheckbox', { name: 'Show balance' }))
            .toBeInTheDocument();
    });
});

describe('balance hero menu keyboard', () => {
    it.each(WIDTHS)('moves with the arrows and closes on Escape at %ipx', (width) => {
        setViewport(width);
        renderWith(homeHero());
        const { trigger, menu } = openMenu(homeRegion());
        const items = within(menu).getAllByRole('menuitemcheckbox');
        expect(document.activeElement).toBe(items[0]);

        fireEvent.keyDown(items[0], { key: 'ArrowDown' });
        expect(document.activeElement).toBe(items[1]);
        fireEvent.keyDown(items[1], { key: 'Home' });
        expect(document.activeElement).toBe(items[0]);
        fireEvent.keyDown(items[0], { key: 'End' });
        expect(document.activeElement).toBe(items[items.length - 1]);

        fireEvent.keyDown(document.activeElement, { key: 'Escape' });
        expect(screen.queryByRole('menu', { name: 'Balance actions' })).toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
});
