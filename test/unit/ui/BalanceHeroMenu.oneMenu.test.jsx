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
import { userEvent } from '../../helpers/userEvent.js';

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
    // The card is named by its caption: the asset, with the artwork's loading label ahead of it while it loads.
    return screen.getByRole('region', { name: new RegExp(`${TICK}$`) });
}

// The balance card holds two round buttons and nothing else: the unit swap
// ("Show wallet balance" or "Show value") and the eye (privacy). There is no three-dots menu and no
// chart toggle on a hero any more.
const swapButton = (scope, name) => within(scope).getByRole('button', { name });
const eyeButton = (scope, name = 'Hide balance') => within(scope).getByRole('button', { name });

function amountCodes(scope) {
    // The card shows only the preferred unit's code beside the amount.
    return Array.from(scope.querySelectorAll('span[class*="amountCode"]'))
        .map((span) => span.textContent);
}

describe.each(WIDTHS)('balance hero menu at %ipx', (width) => {
    beforeEach(() => setViewport(width));

    it('gives Home two round buttons, the swap and the eye, and no menu or chart toggle', () => {
        renderWith(homeHero());
        const hero = homeRegion();

        const buttons = within(hero).getAllByRole('button');
        expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Hide balance', 'Show wallet balance in BTC']);
        expect(within(hero).queryByRole('button', { name: 'Balance actions' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Hide chart' })).toBeNull();
        expect(eyeButton(hero)).toHaveAttribute('aria-pressed', 'true');
    });

    it('gives the token hero the swap and the eye, and the swap changes the primary unit', async () => {
        renderWith(tokenDetail());
        const hero = tokenRegion();
        await waitFor(() => expect(amountCodes(hero)).toEqual(['USD']));

        const buttons = within(hero).getAllByRole('button');
        const name = within(hero).getByTitle(TICK);
        const caption = within(hero).getByText('Value');
        expect(Array.from(name.parentElement.children)).toEqual([name, caption]);
        expect(name.parentElement.previousElementSibling?.className).toContain('cardCaptionIconWrap');
        expect(hero.className).not.toContain('cardNoCaption');
        expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Hide balance', `Show balance in ${TICK}`]);
        expect(within(hero).queryByRole('button', { name: 'Balance actions' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Swap primary unit' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Hide chart' })).toBeNull();
        expect(swapButton(hero, `Show balance in ${TICK}`)).toHaveAttribute('title', `Show balance in ${TICK}`);
        expect(swapButton(hero, `Show balance in ${TICK}`)).not.toBeDisabled();

        fireEvent.click(swapButton(hero, `Show balance in ${TICK}`));
        expect(amountCodes(hero)).toEqual([TICK]);
        expect(within(hero).getByText('Balance')).toBeInTheDocument();
        expect(swapButton(hero, 'Show value in USD')).toHaveAttribute('title', 'Show value in USD');
        fireEvent.click(swapButton(hero, 'Show value in USD'));
        expect(amountCodes(hero)).toEqual(['USD']);
        expect(within(hero).getByText('Value')).toBeInTheDocument();
    });

    it('keeps the swap button disabled without a price', async () => {
        renderWith(tokenDetail({ fiatRate: null }));
        const hero = tokenRegion();
        expect(within(hero).getByRole('button', { name: /^Show (balance|value) in / })).toBeDisabled();
    });

    it('keeps the swap disabled and the eye working where fiat is unsupported', async () => {
        renderWith(tokenDetail({ fiatRate: null, chainId: 'bitcoin-regtest' }), { activeNetwork: 'regtest' });
        const hero = tokenRegion();
        await act(async () => { await Promise.resolve(); });
        expect(within(hero).getByRole('button', { name: /^Show (balance|value) in / })).toBeDisabled();
        expect(eyeButton(hero)).toBeEnabled();
        expect(within(hero).queryByRole('button', { name: /chart/i })).toBeNull();
    });
});

describe('balance hero menu state shared across surfaces', () => {
    beforeEach(() => setViewport(1440));

    it('shows the chart with no toggle on either surface', async () => {
        renderWith(<>{homeHero()}{tokenDetail()}</>);
        await act(async () => { await Promise.resolve(); });

        expect(screen.queryByRole('button', { name: /chart/i })).toBeNull();
        expect(screen.queryByRole('menuitemcheckbox', { name: /chart/i })).toBeNull();
        expect(window.localStorage.getItem('xc:portfolioChartVisible')).toBeNull();
    });

    it('masks both amounts from either eye', async () => {
        renderWith(<>{homeHero()}{tokenDetail()}</>);
        expect(within(homeRegion()).queryByText('•••••')).toBeNull();
        expect(within(tokenRegion()).queryByText('•••••')).toBeNull();

        fireEvent.click(eyeButton(tokenRegion()));
        await act(async () => { await Promise.resolve(); });

        expect(within(homeRegion()).getByText('•••••')).toBeInTheDocument();
        expect(within(tokenRegion()).getByText('•••••')).toBeInTheDocument();
        expect(eyeButton(homeRegion(), 'Show balance')).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('balance hero buttons keyboard', () => {
    it.each(WIDTHS)('reach the swap then the eye by Tab and toggle on Enter at %ipx', async (width) => {
        setViewport(width);
        renderWith(homeHero());
        const hero = homeRegion();
        const user = userEvent.setup();
        const swap = within(hero).getByRole('button', { name: /^Show wallet balance in / });
        const eye = eyeButton(hero);

        swap.focus();
        await user.tab();
        expect(document.activeElement).toBe(eye);
        expect(eye).toHaveAttribute('aria-pressed', 'true');
        await user.keyboard('{Enter}');
        expect(eyeButton(hero, 'Show balance')).toHaveAttribute('aria-pressed', 'false');
        expect(within(hero).getByText('•••••')).toBeInTheDocument();
    });
});
