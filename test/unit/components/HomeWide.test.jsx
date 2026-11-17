// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Wide Home (G115): on a desktop-wide Home whose shell draws the detail
// panel, a collapsible top section (the wallet value card and the allocation
// donut) sits over a resizable split of the balances list and the selected
// item's detail. Phones and narrow widths keep the one-column Home.
//
// jsdom has no layout, so a width is stubbed onto getBoundingClientRect for
// the wide cases; without the stub every element measures 0 and Home stays
// one column, which is also what the narrow cases check.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    getNativePricesRequest: vi.fn(() => Promise.resolve({ prices: {} })),
    collectibleKeys: new Set(),
    collectibleRequests: [],
}));

vi.mock('../../../packages/core/src/shared/components/TotalBalanceHero.jsx', () => ({
    TotalBalanceHero: () => <section data-testid="wallet-value-card">Main Wallet</section>,
}));
vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: () => null,
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: mocks, shell: 'web' }),
}));
vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: {}, loading: false }),
}));
vi.mock('../../../packages/core/src/shared/hooks/useCollectibleKeys.js', () => ({
    useCollectibleKeys: (rows) => {
        mocks.collectibleRequests.push(Array.isArray(rows) ? rows.length : 0);
        return mocks.collectibleKeys;
    },
}));
vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useNativeFiatRates: () => ({}),
    useTokenFiatRates: () => ({}),
    priceNativeRows: (rows) => rows,
    priceTokenRows: (rows) => rows,
}));

import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { HOME_TOP_STORAGE_KEY } from '../../../packages/core/src/shared/hooks/useHomeTopCollapsed.js';
import { DISPLAY_PREFS_CACHE_KEY } from '../../../packages/core/src/shared/hooks/useSettingsRootAttributes.js';
import {
    HOME_LIST_MAX_PX,
    HOME_LIST_MIN_PX,
    HOME_LIST_WIDTH_KEY,
} from '../../../packages/core/src/shared/components/HomeWideLayout.jsx';
import { allocationSlices, liftForBlue } from '../../../packages/core/src/shared/components/AllocationCard.jsx';
import { clampPanelSplit, panelSplitMax } from '../../../packages/core/src/shared/components/PanelSplit.jsx';
import { showHomeBalances } from '../../helpers/homeBalances.js';

const descriptors = new Map([
    ['bitcoin-mainnet', { id: 'bitcoin-mainnet', coin: 'bitcoin', displayName: 'Bitcoin', color: '#F7931A', networkKind: 'mainnet' }],
    ['litecoin-mainnet', { id: 'litecoin-mainnet', coin: 'litecoin', displayName: 'Litecoin', color: '#345D9D', networkKind: 'mainnet' }],
]);
const chainRegistry = {
    get: (id) => descriptors.get(id) || null,
    byCoin: (coin) => [...descriptors.values()].filter((d) => d.coin === coin),
    all: () => [...descriptors.values()],
};

function balancesWith(tokenCount = 2) {
    const tokens = [
        { tick: 'XCP', displayName: 'Counterparty', quantity: '310', divisibility: 0, fiatRate: 6 },
        { tick: 'RAREPEPE', displayName: 'Rare Pepe', quantity: '1', divisibility: 0, fiatRate: 420 },
    ];
    for (let i = tokens.length; i < tokenCount; i += 1) {
        tokens.push({ tick: `TOK${i}`, displayName: `Token ${i}`, quantity: '5', divisibility: 0, fiatRate: 1 });
    }
    return {
        'bitcoin-mainnet': [{
            address: 'bc1-address',
            balances: { native: { tick: 'BTC', quantity: '2', divisibility: 0, fiatRate: 100 }, tokens: tokens.slice(0, tokenCount) },
        }],
        'litecoin-mainnet': [{
            address: 'ltc-address',
            balances: { native: { tick: 'LTC', quantity: '3', divisibility: 0, fiatRate: 10 }, tokens: [] },
        }],
    };
}

function stubWidth(width) {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON() { return {}; },
    });
}

function detailProbe() {
    const seen = [];
    const renderDetail = (item) => {
        seen.push(item);
        return (
            <div data-testid="detail">
                {item.type === 'asset' ? `${item.token.tick} ${item.token.quantity}` : `entry ${item.entry?.key}`}
            </div>
        );
    };
    return { seen, renderDetail };
}

function mount(props = {}, balances = balancesWith()) {
    return render(
        <HomeTabs
            chainRegistry={chainRegistry}
            balances={balances}
            walletId="wallet-wide"
            networkFilter="all"
            {...props}
        />,
    );
}

function rowButton(name) {
    return screen.getByRole('button', { name: new RegExp(`^Open ${name} details`) });
}

function savedPanelWidth(key) {
    return JSON.parse(localStorage.getItem(DISPLAY_PREFS_CACHE_KEY) || '{}').panelSplits?.[key];
}

beforeEach(() => {
    globalThis.localStorage?.clear();
    mocks.collectibleKeys = new Set();
    mocks.collectibleRequests = [];
    mocks.getNativePricesRequest.mockClear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('wide Home layout choice', () => {
    it('keeps the one-column Home when Home measures narrow, even with a detail renderer', () => {
        const { renderDetail } = detailProbe();
        const onSelectToken = vi.fn();
        const { container } = mount({ renderDetail, onSelectToken });
        expect(container.querySelector('[data-home-layout="wide"]')).toBeNull();
        expect(screen.queryByRole('tab', { name: /All/ })).toBeNull();
        // The same three tabs at every width (operator 2026-11-15).
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent.trim())).toEqual(['Balances', 'NFTs', 'DeFi']);
        // A row still opens its page.
        fireEvent.click(rowButton('Bitcoin'));
        expect(onSelectToken).toHaveBeenCalledWith(expect.objectContaining({ tick: 'BTC' }));
        expect(screen.queryByTestId('detail')).toBeNull();
    });

    it('keeps the one-column Home on a wide window when the shell draws no detail', () => {
        stubWidth(1200);
        const { container } = mount({ onSelectToken: vi.fn() });
        expect(container.querySelector('[data-home-layout="wide"]')).toBeNull();
        expect(screen.queryByRole('tab', { name: /All/ })).toBeNull();
    });

    it('lays out the top section, the divider and the split when wide', () => {
        stubWidth(1200);
        const { renderDetail } = detailProbe();
        const { container } = mount({ renderDetail, onSelectToken: vi.fn() });
        expect(container.querySelector('[data-home-layout="wide"]')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Collapse overview' })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('wallet-value-card')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Allocation' })).toBeInTheDocument();
        // Balances comes first and is chosen.
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent.trim())).toEqual(['Balances', 'NFTs', 'DeFi']);
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        const listScroller = screen.getByRole('region', { name: 'Balances list' });
        expect(listScroller).not.toContainElement(tabs[0]);
        // Balances lists coins first, then tokens and NFTs, each in the chosen
        // order (value by default: XCP 1,860 before RAREPEPE 420).
        const list = screen.getByRole('list', { name: 'Balances' });
        expect(listScroller).toContainElement(list);
        expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('data-balance-key'))).toEqual([
            'bitcoin-mainnet:BTC', 'litecoin-mainnet:LTC', 'bitcoin-mainnet:XCP', 'bitcoin-mainnet:RAREPEPE',
        ]);
    });

    it('draws the allocation table with shares that add to 100', () => {
        stubWidth(1200);
        const { renderDetail } = detailProbe();
        mount({ renderDetail });
        const table = screen.getByRole('table', { name: 'Share of the wallet value by asset' });
        const rows = within(table).getAllByRole('row').slice(1).map((tr) => (
            [...tr.querySelectorAll('th, td')].map((cell) => cell.textContent).filter(Boolean)
        ));
        // XCP 1,860, RAREPEPE 420, BTC 200 and LTC 30 of 2,510: largest first.
        expect(rows).toEqual([
            ['XCP', '74.1%', '$1,860'],
            ['RAREPEPE', '16.7%', '$420'],
            ['BTC', '8.0%', '$200'],
            ['LTC', '1.2%', '$30'],
        ]);
        const allocation = screen.getByRole('heading', { name: 'Allocation' }).closest('section');
        expect(within(allocation).getByText('4')).toBeInTheDocument();
        expect(within(allocation).getByText('2 chains')).toBeInTheDocument();
    });
});

describe('wide Home selection drives the detail panel', () => {
    it('opens on the first asset and marks its row current', () => {
        stubWidth(1200);
        const { seen, renderDetail } = detailProbe();
        mount({ renderDetail, onSelectToken: vi.fn() });
        expect(screen.getByTestId('detail')).toHaveTextContent('BTC 2');
        expect(seen.at(-1)).toMatchObject({ type: 'asset', key: 'bitcoin-mainnet:BTC' });
        expect(rowButton('Bitcoin')).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('region', { name: 'Bitcoin' })).toContainElement(screen.getByTestId('detail'));
    });

    it('shows a picked coin in the panel instead of opening its page', () => {
        stubWidth(1200);
        const { renderDetail } = detailProbe();
        const onSelectToken = vi.fn();
        mount({ renderDetail, onSelectToken });
        fireEvent.click(rowButton('Litecoin'));
        expect(onSelectToken).not.toHaveBeenCalled();
        expect(screen.getByTestId('detail')).toHaveTextContent('LTC 3');
        expect(rowButton('Litecoin')).toHaveAttribute('aria-current', 'true');
        expect(rowButton('Bitcoin')).not.toHaveAttribute('aria-current');
    });

    it('shows a picked token from Balances narrowed to Tokens, with the shell holding the selection', () => {
        stubWidth(1200);
        const { seen, renderDetail } = detailProbe();
        const onDetailSelect = vi.fn();
        const { rerender } = mount({ renderDetail, onDetailSelect, onSelectToken: vi.fn() });
        showHomeBalances('tokens');
        fireEvent.click(rowButton('Counterparty'));
        expect(onDetailSelect).toHaveBeenCalledWith({ type: 'asset', key: 'bitcoin-mainnet:XCP' });
        rerender(
            <HomeTabs
                chainRegistry={chainRegistry}
                balances={balancesWith()}
                walletId="wallet-wide"
                networkFilter="all"
                renderDetail={renderDetail}
                onDetailSelect={onDetailSelect}
                detailSelection={{ type: 'asset', key: 'bitcoin-mainnet:XCP' }}
            />,
        );
        expect(screen.getByTestId('detail')).toHaveTextContent('XCP 310');
        expect(seen.at(-1).token).toMatchObject({ chainId: 'bitcoin-mainnet', tick: 'XCP', fiatRate: 6 });
    });

    it('shows a picked NFT from the NFTs tab', () => {
        stubWidth(1200);
        mocks.collectibleKeys = new Set(['bitcoin-mainnet:RAREPEPE']);
        const { seen, renderDetail } = detailProbe();
        mount({ renderDetail, onSelectToken: vi.fn() });
        fireEvent.click(screen.getByRole('tab', { name: /NFTs/ }));
        fireEvent.click(screen.getByRole('button', { name: /Rare Pepe/ }));
        expect(screen.getByTestId('detail')).toHaveTextContent('RAREPEPE 1');
        expect(seen.at(-1)).toMatchObject({ type: 'asset', key: 'bitcoin-mainnet:RAREPEPE' });
        expect(screen.getByRole('button', { name: /Rare Pepe/ })).toHaveAttribute('aria-current', 'true');
    });
});

describe('wide Home top section collapse', () => {
    it('collapses and expands from the handle on the divider and remembers it on this device', async () => {
        stubWidth(1200);
        const { renderDetail } = detailProbe();
        const { container, unmount } = mount({ renderDetail });
        const handle = screen.getByRole('button', { name: 'Collapse overview' });
        // The handle is the shared collapse handle, on the divider line,
        // outside the body it collapses.
        const divider = container.querySelector('[data-home-divider]');
        expect(divider).toContainElement(handle);
        expect(handle).toHaveAttribute('data-orientation', 'horizontal');
        expect(handle).toHaveAttribute('title', 'Collapse overview');
        const body = document.getElementById(handle.getAttribute('aria-controls'));
        expect(body).not.toBeNull();
        expect(body).not.toContainElement(handle);
        expect(body).not.toHaveAttribute('inert');

        await act(async () => { fireEvent.click(handle); });
        expect(handle).toHaveAttribute('aria-expanded', 'false');
        expect(handle).toHaveAccessibleName('Expand overview');
        expect(handle).toHaveAttribute('data-collapsed', 'true');
        expect(body).toHaveAttribute('inert');
        expect(container.querySelector('[data-collapsed="true"]')).not.toBeNull();
        expect(container.querySelector('[data-home-layout="wide"]')).toHaveAttribute('data-top-collapsed', 'true');
        expect(divider).toHaveAttribute('data-collapsed', 'true');
        expect(JSON.parse(localStorage.getItem(HOME_TOP_STORAGE_KEY))).toEqual({ collapsed: true });

        // A fresh mount (a reload) paints it collapsed.
        unmount();
        mount({ renderDetail });
        const again = screen.getByRole('button', { name: 'Expand overview' });
        expect(again).toHaveAttribute('aria-expanded', 'false');

        await act(async () => { fireEvent.click(again); });
        expect(again).toHaveAttribute('aria-expanded', 'true');
        expect(again).toHaveAccessibleName('Collapse overview');
        expect(JSON.parse(localStorage.getItem(HOME_TOP_STORAGE_KEY))).toEqual({ collapsed: false });
    });

    it('takes keyboard focus and toggles from the keyboard', async () => {
        stubWidth(1200);
        const { renderDetail } = detailProbe();
        mount({ renderDetail });
        const handle = screen.getByRole('button', { name: 'Collapse overview' });
        handle.focus();
        expect(handle).toHaveFocus();
        expect(handle.tagName).toBe('BUTTON');
        expect(handle).not.toHaveAttribute('tabindex', '-1');
        // A native button turns Enter and Space into a click.
        await act(async () => { fireEvent.click(handle); });
        expect(handle).toHaveAttribute('aria-expanded', 'false');
        expect(handle).toHaveFocus();
    });

    it('has no Overview heading and no collapse arrow over the allocation card', () => {
        stubWidth(1200);
        const { renderDetail } = detailProbe();
        const { container } = mount({ renderDetail });
        expect(screen.queryByRole('heading', { name: 'Overview' })).toBeNull();
        expect(screen.queryByText('Overview')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull();
        // The section keeps a name for assistive tech only.
        const top = screen.getByRole('region', { name: 'Overview' });
        // Nothing in the top section is a control of the layout's own: the
        // one collapse control is the handle on the divider below it.
        const allocation = container.querySelector('[data-home-allocation]');
        expect(top).toContainElement(allocation);
        expect(within(top).queryAllByRole('button', { name: /overview/i })).toEqual([]);
        expect(top.querySelectorAll('[aria-expanded]')).toHaveLength(0);
        expect(within(top).getByRole('heading', { name: 'Allocation' })).toBeInTheDocument();
    });

    it('keeps the one-column phone Home free of the divider and its handle', () => {
        const { renderDetail } = detailProbe();
        const { container } = mount({ renderDetail });
        expect(container.querySelector('[data-home-layout="wide"]')).toBeNull();
        expect(container.querySelector('[data-home-divider]')).toBeNull();
        expect(screen.queryByRole('button', { name: /overview/i })).toBeNull();
        expect(screen.queryByRole('region', { name: 'Overview' })).toBeNull();
    });
});

describe('wide Home divider and split line CSS contract', () => {
    // Vitest blanks CSS modules, so the layout contract is pinned on the
    // sheets themselves (measured live in headless Chromium at 1280 and
    // 1920 on 2026-11-15: divider edges equal the scroll body's content
    // edges, the handle's tab centred along the divider with its top on the
    // divider's bottom edge, split line from the
    // divider to the content area's bottom).
    const wideCss = readFileSync('packages/core/src/shared/components/HomeWideLayout.module.css', 'utf8');
    const splitCss = readFileSync('packages/core/src/shared/components/PanelSplit.module.css', 'utf8');
    const screenCss = readFileSync('packages/core/src/ui/Screen.module.css', 'utf8');
    const handleCss = readFileSync('packages/core/src/shared/components/CollapseHandle.module.css', 'utf8');
    const rule = (css, selector) => {
        const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]='()]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
        return match ? match[1] : '';
    };

    it('runs the divider through the Screen body padding on both sides', () => {
        const body = rule(screenCss, '.body');
        // The two sides it cancels, as Screen pads them.
        expect(body).toMatch(/padding: var\(--xc-page-top\) var\(--xc-page-gutter\);/);
        expect(body).toMatch(/padding-inline-end: max\(0px, calc\(var\(--xc-page-gutter\) - 2px - var\(--xc-frame-scrollbar, 0px\)\)\);/);
        const wide = rule(wideCss, '.wide');
        expect(wide).toMatch(/--xc-home-bleed-start: var\(--xc-page-gutter\);/);
        expect(wide).toMatch(/--xc-home-bleed-end: max\(0px, calc\(var\(--xc-page-gutter\) - 2px - var\(--xc-frame-scrollbar, 0px\)\)\);/);
        const divider = rule(wideCss, '.sectionDivider');
        expect(divider).toMatch(/margin-inline-start: calc\(-1 \* var\(--xc-home-bleed-start\)\);/);
        expect(divider).toMatch(/margin-inline-end: calc\(-1 \* var\(--xc-home-bleed-end\)\);/);
        expect(divider).toMatch(/height: 1px;/);
        expect(divider).toMatch(/position: relative;/);
    });

    it('hangs the handle under the line, centred along it, as the side tab hangs off the menu', () => {
        // Operator 2026-11-15: the side menu's tab, rotated. The drawn tab
        // starts at the line's bottom edge (touching, never over it): the
        // button's top is the line's bottom (100% of the 1px divider) less
        // the tab's inset inside the 24px hit area, the side tab's own offset
        // (LeftNav .sideMenuHandle) turned a quarter. Measured in headless
        // Chromium at 1280 and 1920, expanded and collapsed: tab top minus
        // line bottom 0px, tab centre minus line centre 0px.
        const handle = rule(wideCss, '.topHandle.topHandle');
        expect(handle).toMatch(/position: absolute;/);
        expect(handle).toMatch(/inset-block-start: calc\(100% \+ \(var\(--xc-collapse-handle-tab\) - var\(--xc-tap-min\)\) \/ 2\);/);
        expect(handle).toMatch(/inset-inline-start: calc\(50% - \(var\(--xc-collapse-handle-length\) \/ 2\)\);/);
        const leftNavCss = readFileSync('packages/core/src/shared/components/LeftNav.module.css', 'utf8');
        expect(rule(leftNavCss, '.sideMenuHandle.sideMenuHandle')).toMatch(
            /inset-inline-start: calc\(\(var\(--xc-collapse-handle-tab\) - var\(--xc-tap-min\)\) \/ 2\);/,
        );
        // The tab sits (tap minimum - tab) / 2 into the hit area, so that
        // offset lands the tab's top edge exactly on the line's bottom.
        const tab = rule(handleCss, ".handle.handle[data-orientation='horizontal']::before");
        expect(tab).toMatch(/inset-block-start: calc\(\(var\(--xc-tap-min\) - var\(--xc-collapse-handle-tab\)\) \/ 2\);/);
        // The horizontal handle is the tab length wide and the tap minimum tall.
        const horizontal = rule(handleCss, ".handle.handle[data-orientation='horizontal']");
        expect(horizontal).toMatch(/width: var\(--xc-collapse-handle-length\);/);
        expect(horizontal).toMatch(/height: var\(--xc-tap-min\);/);
    });

    it('collapses the overview and divider to zero height with no second border', () => {
        // The body, spacing and extra divider line all disappear. The root
        // cancels the body inset so the handle hangs from the toolbar line.
        expect(rule(wideCss, ".top[data-collapsed='true'] .topBody")).toMatch(/grid-template-rows: 0fr;/);
        const clip = rule(wideCss, '.topClip');
        expect(clip).toMatch(/min-height: 0;/);
        expect(clip).toMatch(/overflow: hidden;/);
        expect(rule(wideCss, '.topRow')).toMatch(/padding-block-end: var\(--xc-space-2\);/);
        const collapsedRoot = rule(wideCss, ".wide[data-top-collapsed='true']");
        expect(collapsedRoot).toMatch(/margin-block-start: calc\(-1 \* var\(--xc-page-top\)\);/);
        const collapsedDivider = rule(wideCss, ".wide[data-top-collapsed='true'] .sectionDivider");
        expect(collapsedDivider).toMatch(/height: 0;/);
        expect(collapsedDivider).toMatch(/background: transparent;/);
        expect(collapsedDivider).toMatch(/border: 0;/);
        // No spacing outside the clip: not on the section, its body or the line.
        expect(rule(wideCss, '.sectionDivider')).not.toMatch(/margin-block|margin:/);
        for (const selector of ['.top', '.topBody']) {
            expect(rule(wideCss, selector)).not.toMatch(/padding|margin|gap|min-height|border/);
        }
    });

    it('lets the split line meet the divider: no gap above the split, the panels pad instead', () => {
        expect(rule(wideCss, '.wide')).not.toMatch(/gap:/);
        expect(rule(wideCss, '.listPanel')).toMatch(/padding-block-start: var\(--xc-space-2\);/);
        expect(rule(wideCss, '.detailPanel')).toMatch(/padding-block-start: var\(--xc-space-2\);/);
        // G128: the split fills the room under the divider by flex (the
        // Screen body pays no bottom inset under it), so it no longer bleeds
        // through that inset or reads a fill height from script; each panel
        // pads its own end instead (measured live at 1280 and 1920 on
        // 2026-11-16: split bottom equal to the window bottom).
        expect(rule(wideCss, '.listPanel')).toMatch(/padding-block-end: 0;/);
        expect(rule(splitCss, '.listBody')).toMatch(/padding-block-end: var\(--xc-page-top\);/);
        expect(rule(wideCss, '.detailPanel')).toMatch(/padding-block-end: var\(--xc-page-top\);/);
        expect(wideCss).not.toMatch(/--xc-home-split-bleed/);
        // The old header row and its arrow are gone.
        expect(wideCss).not.toMatch(/topChevron|topHeader|topTitle|topHeading/);
    });
});

describe('wide Home backup reminder placement', () => {
    // The split's line runs to the content area's bottom edge only while the
    // split is the page's last block (HomeWideLayout's fill). The backup
    // reminder used to follow HomeTabs, so the line stopped above it; it now
    // rides in as HomeTabs' footer and closes the list column instead.
    const footer = <section data-testid="backup-reminder" aria-label="Back up your wallet">Back up now</section>;

    it('ends the list column with the footer, leaving the split as the last block', () => {
        stubWidth(1200);
        const { renderDetail } = detailProbe();
        const { container } = mount({ renderDetail, footer });
        const wide = container.querySelector('[data-home-layout="wide"]');
        const card = screen.getByTestId('backup-reminder');
        const separator = screen.getByRole('separator', { name: 'Resize the balances list' });
        const split = separator.parentElement;
        const listPanel = document.getElementById(separator.getAttribute('aria-controls'));
        // In the list column, after the list, and nothing after the split.
        expect(listPanel).toContainElement(card);
        expect(listPanel.lastElementChild).toBe(card);
        expect(wide.lastElementChild).toBe(split);
        expect(container.firstElementChild.lastElementChild).toBe(wide);
        expect(screen.getByTestId('detail')).not.toContainElement(card);
    });

    it('keeps the footer under the list in the one-column Home', () => {
        const { container } = mount({ footer, onSelectToken: vi.fn() });
        const wrap = container.firstElementChild;
        expect(container.querySelector('[data-home-layout="wide"]')).toBeNull();
        expect(wrap.lastElementChild).toBe(screen.getByTestId('backup-reminder'));
        expect(wrap.lastElementChild.previousElementSibling).toHaveAttribute('role', 'tabpanel');
    });

    it('is wired from Home as the footer, and outside HomeTabs only while no balances show', () => {
        const home = readFileSync('packages/core/src/shared/routes/Home.jsx', 'utf8');
        expect(home).toMatch(/footer=\{backupReminder\}/);
        expect(home).toMatch(/\{balances \? null : backupReminder\}/);
        // One card element: the reminder is built once and placed in one spot.
        expect(home.match(/<BackupReminderCard\b/g)).toHaveLength(1);
    });
});

describe('wide Home list and detail split', () => {
    it('resizes from the keyboard within its clamp and remembers the width', () => {
        stubWidth(1200);
        const { renderDetail } = detailProbe();
        mount({ renderDetail });
        const separator = screen.getByRole('separator', { name: 'Resize the balances list' });
        expect(separator).toHaveAttribute('aria-orientation', 'vertical');
        expect(separator).toHaveAttribute('aria-valuemin', String(HOME_LIST_MIN_PX));
        expect(separator).toHaveAttribute('aria-valuemax', String(HOME_LIST_MAX_PX));
        // The default is 40 percent of the split.
        expect(separator).toHaveAttribute('aria-valuenow', '480');

        fireEvent.keyDown(separator, { key: 'ArrowRight' });
        expect(separator).toHaveAttribute('aria-valuenow', '488');
        fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true });
        expect(separator).toHaveAttribute('aria-valuenow', '456');
        expect(savedPanelWidth(HOME_LIST_WIDTH_KEY)).toBe(456);

        fireEvent.keyDown(separator, { key: 'End' });
        expect(separator).toHaveAttribute('aria-valuenow', String(HOME_LIST_MAX_PX));
        fireEvent.keyDown(separator, { key: 'ArrowRight' });
        expect(separator).toHaveAttribute('aria-valuenow', String(HOME_LIST_MAX_PX));

        fireEvent.keyDown(separator, { key: 'Home' });
        expect(separator).toHaveAttribute('aria-valuenow', String(HOME_LIST_MIN_PX));
        fireEvent.keyDown(separator, { key: 'ArrowLeft' });
        expect(separator).toHaveAttribute('aria-valuenow', String(HOME_LIST_MIN_PX));

        // Enter returns to the default and forgets the saved width.
        fireEvent.keyDown(separator, { key: 'Enter' });
        expect(separator).toHaveAttribute('aria-valuenow', '480');
        expect(savedPanelWidth(HOME_LIST_WIDTH_KEY)).toBeUndefined();
    });

    it('opens at the width remembered on this device', () => {
        stubWidth(1200);
        localStorage.setItem(DISPLAY_PREFS_CACHE_KEY, JSON.stringify({
            panelSplits: { [HOME_LIST_WIDTH_KEY]: 600 },
        }));
        const { renderDetail } = detailProbe();
        mount({ renderDetail });
        expect(screen.getByRole('separator', { name: 'Resize the balances list' })).toHaveAttribute('aria-valuenow', '600');
    });

    it('never squeezes the detail under its minimum', () => {
        // 1,000px leaves the list at most 1000 - 420 - 17 = 563px.
        const limits = { min: HOME_LIST_MIN_PX, max: HOME_LIST_MAX_PX, minOther: 420 };
        expect(panelSplitMax(limits, 1000)).toBe(563);
        expect(clampPanelSplit(900, limits, 1000)).toBe(563);
        expect(clampPanelSplit(100, limits, 1000)).toBe(HOME_LIST_MIN_PX);
        expect(clampPanelSplit(Number.NaN, limits, 1000)).toBe(HOME_LIST_MIN_PX);
    });
});

describe('wide Home panels scroll on their own (G128)', () => {
    it('makes each panel a named scroll region the keyboard can reach', () => {
        stubWidth(1200);
        const { renderDetail } = detailProbe();
        mount({ renderDetail });
        const list = screen.getByRole('region', { name: 'Balances list' });
        expect(list).toHaveAttribute('tabindex', '0');
        const separator = screen.getByRole('separator', { name: 'Resize the balances list' });
        expect(separator.getAttribute('aria-controls')).toBe(list.id);
        const detail = list.parentElement.parentElement.querySelector('[data-home-detail]');
        expect(detail).toHaveAttribute('role', 'region');
        expect(detail).toHaveAttribute('tabindex', '0');
    });

    it('tells the host while the split shows, so only then its body stops scrolling', () => {
        const { renderDetail } = detailProbe();
        const narrow = vi.fn();
        const one = mount({ renderDetail, onWideChange: narrow });
        expect(narrow).toHaveBeenLastCalledWith(false);
        expect(narrow).not.toHaveBeenCalledWith(true);
        one.unmount();

        stubWidth(1200);
        const wide = vi.fn();
        const two = mount({ renderDetail, onWideChange: wide });
        expect(wide).toHaveBeenLastCalledWith(true);
        // Leaving Home (or losing the balances) hands the body back.
        two.unmount();
        expect(wide).toHaveBeenLastCalledWith(false);
    });

    it('is wired from Home: the split body and the page column follow the wide flag', () => {
        const home = readFileSync('packages/core/src/shared/routes/Home.jsx', 'utf8');
        expect(home).toMatch(/onWideChange=\{setHomeWide\}/);
        expect(home).toMatch(/const splitShown = homeWide && Boolean\(balances\);/);
        expect(home).toMatch(/<Screen variant=\{variant\} bodyClassName=\{splitShown \? listDetailStyles\.splitBody : undefined\}>/);
        expect(home).toMatch(/<ListPage className=\{splitShown \? listDetailStyles\.splitFill : undefined\}>/);
    });
});

describe('wide Home reads', () => {
    it('adds no read that grows with the rows: one price read and no per-row lookups at 3 and 30 rows', () => {
        stubWidth(1200);
        const counts = [];
        for (const tokenCount of [2, 29]) {
            mocks.getNativePricesRequest.mockClear();
            mocks.collectibleRequests = [];
            const { seen, renderDetail } = detailProbe();
            const { unmount } = mount({ renderDetail }, balancesWith(tokenCount));
            const askedItems = new Set(seen.map((item) => item.key));
            counts.push({
                priceReads: mocks.getNativePricesRequest.mock.calls.length,
                // The All tab classifies no rows (NFT lookups run only on the NFTs tab).
                classified: Math.max(0, ...mocks.collectibleRequests),
                detailItems: askedItems.size,
            });
            unmount();
        }
        expect(counts[0]).toEqual({ priceReads: 1, classified: 0, detailItems: 1 });
        expect(counts[1]).toEqual(counts[0]);
    });
});

describe('allocationSlices', () => {
    it('keeps the top five, folds the rest into Other and keeps the shares at 100', () => {
        const rows = Array.from({ length: 12 }, (_, i) => ({
            chainId: 'bitcoin-mainnet', tick: `T${i}`, kind: 'token', quantity: String(12 - i), divisibility: 0, fiatRate: 1,
        }));
        const { slices, assets, chains, other } = allocationSlices(rows, chainRegistry);
        expect(assets).toBe(12);
        expect(chains).toBe(1);
        expect(slices).toHaveLength(6);
        expect(slices.at(-1).label).toBe('Other');
        expect(other).toEqual({ lead: 'T5', more: 6 });
        const sum = slices.reduce((total, s) => total + Math.round(s.percent * 10), 0);
        expect(sum).toBe(1000);
    });

    it('gives a coin its chain colour, lifted to read on the blue, and leaves out unpriced and empty rows', () => {
        const { slices } = allocationSlices([
            { chainId: 'bitcoin-mainnet', tick: 'BTC', kind: 'native', quantity: '1', divisibility: 0, fiatRate: 5 },
            { chainId: 'bitcoin-mainnet', tick: 'NOPRICE', kind: 'token', quantity: '9', divisibility: 0, fiatRate: null },
            { chainId: 'bitcoin-mainnet', tick: 'ZERO', kind: 'token', quantity: '0', divisibility: 0, fiatRate: 3 },
        ], chainRegistry);
        expect(slices).toEqual([expect.objectContaining({ label: 'BTC', color: liftForBlue('#F7931A'), percent: 100 })]);
    });
});
