// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Operator ruling 2026-11-15: tapping a coin from Home and tapping a token
// from My Tokens open ONE page with one layout. Both draw the blue hero with
// its chart and range buttons, then the Actions, Details and History tabs;
// Details is one standard card 8px under the tabs; History is one flat list
// with no day headings, each row keeping its relative time. A token with no
// price history charts the balance this wallet's own rows prove.

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../packages/core/src/flows/demoMode.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isDemoWallet: () => false };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { balanceSeries, entryBalanceDelta } from '../../../packages/core/src/shared/utils/assetBalanceSeries.js';

const MAINNET = 'bitcoin-mainnet';
const REGTEST = 'bitcoin-regtest';
const MINE = 'bcrt1qminemineminemineminemineminemine00';
const OTHER = 'bcrt1qotherotherotherotherotherother000';
const HOUR = 3600;
const DAY = 24 * HOUR;

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function historyRows(nowSec) {
    // Newest first: received 2 hours ago, received 1 day ago, sent 3 days ago.
    return [
        { action_index: '300.1', action: 'SEND', tick: 'MYTOKEN', amount: '2', source: OTHER, destination: MINE, timestamp: nowSec - 2 * HOUR, block_index: 300 },
        { action_index: '200.1', action: 'SEND', tick: 'MYTOKEN', amount: '1', source: OTHER, destination: MINE, timestamp: nowSec - DAY - HOUR, block_index: 200 },
        { action_index: '100.1', action: 'SEND', tick: 'MYTOKEN', amount: '4', source: MINE, destination: OTHER, timestamp: nowSec - 3 * DAY, block_index: 100 },
    ];
}

function tokenMessaging({ rows = historyRows(Math.floor(Date.now() / 1000)) } = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            creator: MINE,
            displayName: 'MYTOKEN',
            description: 'A token of my own.',
            totalSupply: '10',
            maxSupply: '100',
            divisibility: 0,
            locks: {},
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [REGTEST]: [{ address: MINE }] }),
        getAddressHistory: vi.fn().mockResolvedValue(rows),
        getGenesisForToken: vi.fn().mockResolvedValue({ source: MINE, block_index: 50 }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({
            [REGTEST]: { [MINE]: { tokens: [{ tick: 'MYTOKEN', quantity: '5' }] } },
        }),
    };
}

function coinMessaging() {
    return {
        getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'USD' }),
        getNativePricesRequest: vi.fn().mockImplementation(async (request) => ({
            prices: {
                [MAINNET]: request.includeHistory ? { historyDaily: [] } : {
                    priceFiat: 40000,
                    marketCapFiat: 1200000000,
                    change24hPct: 1.5,
                    sparkline: Array.from({ length: 168 }, (_, i) => 39000 + i * 5),
                    fetchedAt: Date.now(),
                },
            },
        })),
        getAddressesByChain: vi.fn().mockResolvedValue({ [MAINNET]: [] }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
}

function renderCoin() {
    render(
        <MessagingProvider shell="web" messaging={coinMessaging()}>
            <TokenDetail
                walletId="w1"
                chainId={MAINNET}
                tick="BTC"
                kind="native"
                displayName="Bitcoin"
                quantity="200000000"
                divisibility={8}
                fiatRate={40000}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

function renderManagedToken(messaging = tokenMessaging()) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ManageToken
                walletId="w1"
                chainId={REGTEST}
                tick="MYTOKEN"
                quantity="5"
                onBack={() => {}}
                onMint={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

function renderHeldToken(messaging = tokenMessaging()) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail
                walletId="w1"
                chainId={REGTEST}
                tick="MYTOKEN"
                quantity="5"
                divisibility={0}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

/** The page's structure, named so a coin and a token can be compared. */
async function layoutOf(heading) {
    const hero = await screen.findByRole('region', { name: heading });
    const stack = hero.closest('[class*="heroStack"]');
    const chart = await waitFor(() => {
        const found = stack?.querySelector('[data-chart-behind="true"]');
        expect(found).not.toBeNull();
        return found;
    });
    await waitFor(() => expect(within(chart).getByRole('img')).toBeTruthy());
    const ranges = within(screen.getByRole('tablist', { name: 'Chart range' })).getAllByRole('tab');
    const pageTabs = within(screen.getByRole('tablist', { name: 'Coin or token view' })).getAllByRole('tab');
    return {
        heroInStack: Boolean(stack),
        stackHasChart: /heroStackWithChart/.test(stack?.className || ''),
        chartInHero: stack?.contains(chart) === true,
        rangeButtons: ranges.map((tab) => tab.textContent),
        rangesShown: !/rangesIdle/.test(screen.getByRole('tablist', { name: 'Chart range' }).className),
        pageTabs: pageTabs.map((tab) => tab.textContent),
        firstTabChosen: pageTabs[0].getAttribute('aria-selected'),
        actionsIsOneList: Boolean(screen.getByRole('list', { name: new RegExp(`^Actions for `) })),
        guidePositions: [...chart.querySelectorAll('[data-chart-guide]')].map((guide) => guide.getAttribute('y1')),
        guideKinds: [...chart.querySelectorAll('[data-chart-guide]')].map((guide) => guide.getAttribute('data-chart-guide-kind')),
        labelPositions: [...chart.querySelectorAll('[data-chart-scale]')].map((label) => label.style.top),
        labelsHaveCollisionShift: [...chart.querySelectorAll('[data-chart-scale]')]
            .some((label) => label.hasAttribute('data-scale-collision')),
    };
}

describe('asset and token-management pages', () => {
    it('keeps the same value-chart hero on detail and Manage Token', async () => {
        renderCoin();
        const coin = await layoutOf('Bitcoin');
        cleanup();
        __clearTokenInfoCache();
        renderManagedToken();
        const managedToken = await layoutOf('MYTOKEN');

        const expected = {
            heroInStack: true,
            stackHasChart: true,
            chartInHero: true,
            rangeButtons: ['24h', '1W', '1M', '3M', '6M', '1Y', 'YTD', 'All'],
            rangesShown: true,
            pageTabs: ['Actions', 'Details', 'History'],
            firstTabChosen: 'true',
            actionsIsOneList: true,
            guidePositions: ['4', '15.5', '27', '38.5', '50', '61.5', '73', '84.5', '96'],
            guideKinds: ['labelled', 'halfway', 'labelled', 'halfway', 'labelled', 'halfway', 'labelled', 'halfway', 'labelled'],
            labelPositions: ['4%', '27%', '50%', '73%', '96%'],
            labelsHaveCollisionShift: false,
        };
        expect(coin).toEqual(expected);
        expect(managedToken).toEqual({
            ...expected,
            pageTabs: ['Actions', 'Details', 'Files', 'History'],
        });
        expect(document.querySelector('[data-nft-identity]')).toBeNull();
    });

    it('gives a token with no price history its balance line from the wallet rows', async () => {
        renderHeldToken();
        await screen.findByRole('region', { name: 'MYTOKEN' });
        const chart = await screen.findByRole('region', { name: 'Balance chart' });
        const line = await within(chart).findByRole('img', { name: /^Balance over 1W/ });
        // 1W: 4 sent 3 days ago (from 6), then 1 and 2 received; the line ends at 5.
        expect(line.getAttribute('aria-label') || line.textContent).toMatch(/End 5\b/);
        fireEvent.click(screen.getByRole('tab', { name: '24h' }));
        expect(await within(chart).findByRole('img', { name: /^Balance over 24h/ })).toBeTruthy();
    });

    it('puts the Details facts in the standard card, 8px under the tab row', async () => {
        renderManagedToken();
        fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
        const region = await screen.findByRole('region', { name: 'Token details' });
        const card = region.closest('[data-details-card]');
        expect(card).not.toBeNull();
        expect(card.className).toMatch(/detailsCard/);
        // The card is the tab panel's first block, and the panel follows the tab row.
        const panel = card.parentElement;
        expect(panel.getAttribute('role')).toBe('tabpanel');
        expect(panel.firstElementChild).toBe(card);
        const tablist = screen.getByRole('tablist', { name: 'Coin or token view' });
        expect(panel.previousElementSibling).toBe(tablist.closest('[class*="tabs"]') || tablist);

        // jsdom draws no layout, so the 8px is read from the rules that make it.
        const css = readFileSync(join(process.cwd(), 'packages/core/src/shared/routes/TokenDetail.module.css'), 'utf8');
        const tokens = readFileSync(join(process.cwd(), 'packages/core/src/ui/tokens.css'), 'utf8');
        expect(css).toMatch(/\.detailsCard\s*\{[^}]*composes:\s*card from '\.\.\/\.\.\/ui\/Card\.module\.css'/s);
        expect(css).toMatch(/\.detailsCard\s*\{[^}]*margin:\s*0;/s);
        expect(css).toMatch(/\.tabPanel\s*\{[^}]*margin:\s*0;[^}]*padding:\s*0;/s);
        expect(css).toMatch(/\.detailPage\.detailPage\s*\{[^}]*gap:\s*var\(--xc-space-2\)/s);
        expect(tokens).toMatch(/--xc-space-2:\s*8px;/);
    });

    it('lists History as one flat list with no day headings, each row with its relative time', async () => {
        renderManagedToken();
        fireEvent.click(await screen.findByRole('tab', { name: 'History' }));
        const list = await screen.findByRole('list', { name: 'MYTOKEN history' });
        expect(list.hasAttribute('data-history-flat')).toBe(true);
        const rows = within(list).getAllByRole('listitem');
        expect(rows).toHaveLength(3);
        const panel = list.closest('[role="tabpanel"]');
        expect(within(panel).queryAllByRole('heading')).toHaveLength(0);
        expect(panel.textContent).not.toMatch(/\b(Today|Yesterday)\b/);
        const times = rows.map((row) => row.querySelector('time')?.textContent);
        expect(times[0]).toMatch(/hours? ago$/);
        expect(times[1]).toMatch(/days? ago$/);
        expect(times[2]).toMatch(/days? ago$/);
    });

    it('reads the token rows once for the hero line and the History tab, the same reads at 3 and 30 rows', async () => {
        const readsAt = async (count) => {
            const nowSec = Math.floor(Date.now() / 1000);
            const rows = Array.from({ length: count }, (_, i) => ({
                action_index: `${1000 - i}.1`,
                action: 'SEND',
                tick: 'MYTOKEN',
                amount: '1',
                source: OTHER,
                destination: MINE,
                timestamp: nowSec - (i + 1) * HOUR,
                block_index: 1000 - i,
            }));
            const messaging = renderHeldToken(tokenMessaging({ rows }));
            await screen.findByRole('region', { name: 'Balance chart' });
            fireEvent.click(screen.getByRole('tab', { name: 'History' }));
            const list = await screen.findByRole('list', { name: 'MYTOKEN history' });
            expect(within(list).getAllByRole('listitem')).toHaveLength(count);
            // One history read per own address, shared by the line and the tab.
            expect(messaging.getAddressHistory).toHaveBeenCalledTimes(1);
            const reads = Object.fromEntries(Object.entries(messaging).map(([name, fn]) => [name, fn.mock.calls.length]));
            cleanup();
            __clearTokenInfoCache();
            return reads;
        };
        const few = await readsAt(3);
        const many = await readsAt(30);
        expect(many).toEqual(few);
    });
});

describe('routes and deep links still resolve', () => {
    const shells = [
        'packages/web/src/App.jsx',
        'packages/desktop/renderer/App.jsx',
        'packages/extension/src/popup/App.jsx',
    ];

    it('keeps both route ids, each pointing at a component that renders the one page', () => {
        expect(ROUTE_REGISTRY['token-detail'].component).toBe('TokenDetail');
        expect(ROUTE_REGISTRY['manage-token'].component).toBe('ManageToken');
        expect(typeof TokenDetail).toBe('function');
        expect(typeof ManageToken).toBe('function');
        const alias = readFileSync(join(process.cwd(), 'packages/core/src/shared/routes/ManageToken.jsx'), 'utf8');
        expect(alias).toMatch(/<TokenDetail[\s\S]*ownerView/);
    });

    it('routes token-detail and manage-token through the same page in every shell', () => {
        for (const file of shells) {
            const app = readFileSync(join(process.cwd(), file), 'utf8');
            expect(app, file).toMatch(/unlockedView === 'token-detail' && activeWalletId && tokenDetailRef\) \{\s*return renderTokenDetail\(/);
            expect(app, file).toMatch(/unlockedView === 'manage-token' && activeWalletId && tokenDetailRef\) \{[\s\S]{0,300}?return renderTokenDetail\([^)]*ownerView: true/);
            expect(app, file).not.toContain('<ManageToken');
            // My Tokens still opens the manage-token route for a tapped token.
            expect(app, file).toMatch(/onSelectTick=\{\(tick, chainId, row\) => \{[\s\S]{0,800}?setUnlockedView\('manage-token'\)/);
        }
        const myTokens = readFileSync(join(process.cwd(), 'packages/core/src/shared/routes/MyTokens.jsx'), 'utf8');
        expect(myTokens).toContain('aria-label={`Open ${row.tick} token details`}');
        // A restored deep link names the token by chain and tick.
        const nav = readFileSync(join(process.cwd(), 'packages/core/src/ui/navHistory.js'), 'utf8');
        expect(nav).toContain("'token-detail': ['tokenDetailRef', ['chainId', 'tick']]");
    });
});

describe('the balance line', () => {
    const now = Date.UTC(2026, 10, 15, 12);
    const nowSec = Math.floor(now / 1000);
    const own = new Set([MINE.toLowerCase()]);
    const entries = historyRows(nowSec).map((row) => ({
        action: row.action,
        address: MINE,
        timestamp: row.timestamp,
        raw: row,
    }));

    it('reads a receive, a send and a send between own addresses', () => {
        expect(entryBalanceDelta(entries[0], { tick: 'MYTOKEN', divisibility: 0, walletAddresses: own })).toBe(2n);
        expect(entryBalanceDelta(entries[2], { tick: 'MYTOKEN', divisibility: 0, walletAddresses: own })).toBe(-4n);
        const internal = { ...entries[0], raw: { ...entries[0].raw, source: MINE, destination: MINE } };
        expect(entryBalanceDelta(internal, { tick: 'MYTOKEN', divisibility: 0, walletAddresses: own })).toBe(0n);
        expect(entryBalanceDelta(entries[0], { tick: 'OTHER', divisibility: 0, walletAddresses: own })).toBe(0n);
    });

    it('steps back from the balance held now and never draws past the oldest row', () => {
        const series = balanceSeries({
            entries,
            currentAtomic: 5n,
            tick: 'MYTOKEN',
            divisibility: 0,
            walletAddresses: own,
            points: 5,
            windowStart: -Infinity,
            nowMs: now,
        });
        // Opens just before the oldest row (6 held), ends at the 5 held now.
        expect(series[0]).toBe(6);
        expect(series[series.length - 1]).toBe(5);
        expect(Math.min(...series)).toBe(2);
    });

    it('is flat at the balance when the wallet has no rows, so the hero still draws', () => {
        expect(balanceSeries({ entries: [], currentAtomic: 7n, tick: 'MYTOKEN', divisibility: 0, points: 3, windowStart: 0, nowMs: now }))
            .toEqual([7, 7, 7]);
        expect(balanceSeries({ entries: [], currentAtomic: null, tick: 'MYTOKEN', divisibility: 0, points: 3, windowStart: 0, nowMs: now }))
            .toBeNull();
    });
});
