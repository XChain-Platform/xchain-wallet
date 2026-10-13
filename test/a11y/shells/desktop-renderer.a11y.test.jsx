// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeAll, describe, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { CoinpayObligationsProvider } from '../../../packages/core/src/shared/hooks/useCoinpayObligations.js';
import { FullLayoutWithNav, LeftNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { WatchOnlyBadge } from '../../../packages/core/src/shared/components/WatchOnlyBadge.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const WALLET = { id: 'wallet-1', name: 'Desktop Wallet', createdAt: Date.now() };
const ACCOUNT = { id: 'account-1', name: 'Daily', index: 0, walletId: WALLET.id };
const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const SETTINGS = createDefaultSettings();
SETTINGS.walletMode = 'watcher';
delete SETTINGS.fees;

function pending() {
    return new Promise(() => {});
}

function desktopMessaging() {
    const base = {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        updateSettings: vi.fn().mockResolvedValue(SETTINGS),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: ADDRESS,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [],
                },
            }],
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'address-1', address: ADDRESS }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [CHAIN]: { id: 'address-1', address: ADDRESS },
        }),
        getCoinpayObligationsForAddress: vi.fn().mockResolvedValue([]),
        listConnectedSites: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(pending);
            target[property] = stub;
            return stub;
        },
    });
}

function DesktopRendererHarness() {
    const [view, setView] = useState('home');
    const messaging = useMemo(() => desktopMessaging(), []);
    const route = view === 'settings' ? (
        <Settings
            onBack={() => setView('home')}
            activeWallet={WALLET}
            activeAccount={ACCOUNT}
            onOpenWalletPicker={() => {}}
            onOpenAccountPicker={() => {}}
        />
    ) : (
        <Home
            activeWalletId={WALLET.id}
            activeAccountId={ACCOUNT.id}
            onSend={() => {}}
            onReceive={() => {}}
            onOpenWalletPicker={() => {}}
            onOpenAccountPicker={() => {}}
            demoBannerInHeader
        />
    );

    return (
        <MessagingProvider shell="desktop" messaging={messaging}>
            <ToastHost>
                <CoinpayObligationsProvider walletId={WALLET.id} accountId={ACCOUNT.id}>
                    <FullLayoutWithNav
                        routeKey={view}
                        nav={(
                            <LeftNav
                                currentView={view}
                                onSelect={setView}
                                onOpenSettings={() => setView('settings')}
                                onOpenWalletPicker={() => {}}
                                onCommandPalette={() => {}}
                                onLock={() => {}}
                                walletName={WALLET.name}
                                hasVmAddress
                            />
                        )}
                        header={<WatchOnlyBadge visible />}
                    >
                        {route}
                    </FullLayoutWithNav>
                </CoinpayObligationsProvider>
            </ToastHost>
        </MessagingProvider>
    );
}

let originalResizeObserver;
let originalInnerWidth;

beforeAll(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    originalInnerWidth = window.innerWidth;
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        disconnect() {}
    };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
});

afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
});

describe('desktop renderer accessibility', () => {
    it('scans the side navigation, persistent header, and loaded Home route', async () => {
        const { container } = render(<DesktopRendererHarness />);

        await screen.findByText('BTC · Bitcoin');
        screen.getByRole('navigation', { name: 'Primary navigation' });
        screen.getByRole('status', { name: 'Watch-only wallet' });
        screen.getByRole('heading', { name: 'Home' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans Settings inside the desktop chrome', async () => {
        const { container } = render(<DesktopRendererHarness />);
        await screen.findByText('BTC · Bitcoin');

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        await screen.findByRole('heading', { name: 'Settings' });
        await screen.findAllByText('Desktop Wallet');
        await expectNoSeriousAxeViolations(container);
    });
});
