// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { FullLayoutWithNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import formStyles from '../../../packages/core/src/ui/FormPage.module.css';
import listStyles from '../../../packages/core/src/ui/ListPage.module.css';

const VIEWPORT = { width: 768, height: 1024 };
const WALLET_ID = 'tablet-demo-wallet';
const ACCOUNT_ID = 'tablet-account';
const CHAIN_ID = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'tablet-address',
    address: 'bc1qtabletportraitaddress000000000000000000',
    publicKey: `02${'a'.repeat(64)}`,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8');
const formCss = read('packages/core/src/ui/FormPage.module.css');
const listCss = read('packages/core/src/ui/ListPage.module.css');
const screenCss = read('packages/core/src/ui/Screen.module.css');
const navCss = read('packages/core/src/shared/components/LeftNav.module.css');
const homeCss = read('packages/core/src/shared/routes/Home.module.css');
const collectibleCss = read('packages/core/src/shared/components/CollectiblesView.module.css');

const originalViewport = { width: window.innerWidth, height: window.innerHeight };
let originalResizeObserver;

function messaging(overrides = {}) {
    const base = {
        getSettings: vi.fn().mockResolvedValue({}),
        updateSettings: vi.fn().mockResolvedValue({}),
        listConnectedSites: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[property] = stub;
            return stub;
        },
    });
}

function renderTablet(route, routeKey, hostMessaging) {
    return render(
        <MessagingContext.Provider value={{ shell: 'web', messaging: hostMessaging }}>
            <FullLayoutWithNav
                routeKey={routeKey}
                nav={<nav aria-label="Primary navigation" />}
                bottomBar={<nav aria-label="Bottom navigation" />}
            >
                {route}
            </FullLayoutWithNav>
        </MessagingContext.Provider>,
    );
}

function expectRailNavigation(container) {
    expect(container.firstChild).toHaveAttribute('data-xc-tier', 'rail');
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Bottom navigation' })).toBeNull();
}

function expectListPage(container) {
    expect(container.querySelector(`.${listStyles.page}`)).not.toBeNull();
}

beforeAll(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT.width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT.height });
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
});

afterAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalViewport.width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalViewport.height });
    globalThis.ResizeObserver = originalResizeObserver;
});

describe('primary routes at 768x1024', () => {
    it('renders Home as a full-width list with rail navigation and a bounded lone card', async () => {
        markDemoWallet(WALLET_ID);
        const hostMessaging = messaging({
            listWallets: vi.fn().mockResolvedValue([{ id: WALLET_ID, name: 'Tablet demo' }]),
            listAccounts: vi.fn().mockResolvedValue([{ id: ACCOUNT_ID, index: 0, walletId: WALLET_ID }]),
            getWalletBalances: vi.fn().mockResolvedValue({}),
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            listPendingAirdropsForWallet: vi.fn().mockResolvedValue([]),
            listConfirmSessions: vi.fn().mockResolvedValue({ sessions: [] }),
            getNativePricesRequest: vi.fn().mockResolvedValue({ prices: {} }),
        });
        const view = renderTablet(
            <Home
                activeWalletId={WALLET_ID}
                activeAccountId={ACCOUNT_ID}
                onExchange={() => {}}
            />,
            'home',
            hostMessaging,
        );

        const actions = await screen.findByRole('group', { name: 'Quick actions' });
        expectRailNavigation(view.container);
        expectListPage(view.container);
        expect(actions.className).toMatch(/quickActionsSingle/);
        expect(within(actions).getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Exchange' })).toBeInTheDocument();
    });

    it('renders Send in the shared form card with rail navigation', async () => {
        const hostMessaging = messaging({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [ADDRESS] }),
            getAddressBalances: vi.fn().mockResolvedValue({
                native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                tokens: [],
            }),
            listContacts: vi.fn().mockResolvedValue([]),
            getRecentDestinations: vi.fn().mockResolvedValue([]),
        });
        const view = renderTablet(
            <Send walletId={WALLET_ID} accountId={ACCOUNT_ID} onBack={() => {}} />,
            'send',
            hostMessaging,
        );

        await waitFor(() => expect(view.container.querySelector(`form.${formStyles.form}`)).not.toBeNull());
        expectRailNavigation(view.container);
    });

    it('renders Receive in the shared form card with rail navigation', async () => {
        const hostMessaging = messaging({
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getNewestAddress: vi.fn().mockResolvedValue(null),
        });
        const view = renderTablet(
            <Receive walletId={WALLET_ID} accountId={ACCOUNT_ID} onBack={() => {}} />,
            'receive',
            hostMessaging,
        );

        await screen.findByText('No addresses yet');
        expect(view.container.querySelector(`form.${formStyles.form}`)).not.toBeNull();
        expectRailNavigation(view.container);
    });

    it('renders History as a full-width list with rail navigation', async () => {
        const hostMessaging = messaging({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [ADDRESS] }),
            getAddressHistory: vi.fn().mockResolvedValue([]),
            getAddressMempool: vi.fn().mockResolvedValue([]),
            getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
            getLinksForAddress: vi.fn().mockResolvedValue([]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
            listContacts: vi.fn().mockResolvedValue([]),
        });
        const view = renderTablet(
            <History walletId={WALLET_ID} accountId={ACCOUNT_ID} onBack={() => {}} />,
            'history',
            hostMessaging,
        );

        await screen.findByRole('searchbox', { name: 'Search history' });
        expectRailNavigation(view.container);
        expectListPage(view.container);
    });

    it('renders Settings as a full-width list with rail navigation', () => {
        const view = renderTablet(
            <Settings onBack={() => {}} />,
            'settings',
            messaging(),
        );

        expectRailNavigation(view.container);
        expectListPage(view.container);
        expect(screen.getByRole('searchbox', { name: 'Search settings' })).toBeInTheDocument();
    });

    it('locks the portrait sizing rules to cards, list lanes, and the scrollbar gutter', () => {
        expect(formCss).toMatch(/@media \(min-width: 600px\)[\s\S]*?\.form\s*\{[^}]*max-width:\s*560px[^}]*margin:[^;]*auto/s);
        expect(formCss).toMatch(/@media \(min-width: 600px\)[\s\S]*?\.form:not\(\.sectioned\)\s*\{[^}]*background:\s*var\(--xc-surface-raised\)[^}]*border:/s);
        expect(listCss).toMatch(/\.page\s*\{[^}]*width:\s*100%[^}]*max-width:\s*48rem[^}]*margin-inline:\s*auto/s);
        expect(screenCss).toMatch(/\.body\s*\{[^}]*overflow-y:\s*auto[^}]*scrollbar-gutter:\s*stable/s);
        expect(navCss).toMatch(/\.layout\[data-xc-tier='rail'\] \.sidebar\s*\{[^}]*flex:\s*0 0 64px/s);
        expect(homeCss).toMatch(/@media \(min-width: 48rem\)[\s\S]*?\.quickActionsSingle\s*\{[^}]*grid-template-columns:\s*minmax\(76px, 10rem\)/s);
        expect(collectibleCss).toMatch(/@media \(min-width: 48rem\)[\s\S]*?\.grid\s*\{[^}]*minmax\(10rem, 12rem\)/s);
    });
});
