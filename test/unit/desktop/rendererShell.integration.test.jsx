// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boot = vi.hoisted(() => ({
    installErrorCapture: vi.fn(),
    installFiatRateSource: vi.fn(),
    setShellCapabilities: vi.fn(),
}));

vi.mock('../../../packages/desktop/renderer/errorCapture.js', () => ({
    installShellErrorCapture: boot.installErrorCapture,
}));
vi.mock('../../../packages/desktop/renderer/fiatRateSource.js', () => ({
    installDesktopFiatRateSource: boot.installFiatRateSource,
}));
vi.mock('@xchain-wallet/core/shared/shellCapabilities.js', () => ({
    setShellCapabilities: boot.setShellCapabilities,
}));
vi.mock('../../../packages/desktop/renderer/DesktopUpdateBanner.jsx', () => ({
    DesktopUpdateBanner: () => null,
}));

vi.mock('@xchain-wallet/core/shared/PrivacyBlurGate.jsx', () => ({ PrivacyBlurGate: () => null }));
vi.mock('@xchain-wallet/core/shared/LocaleSync.jsx', () => ({ LocaleSync: () => null }));
vi.mock('@xchain-wallet/core/shared/DisplayPrefsGate.jsx', () => ({ DisplayPrefsGate: () => null }));

vi.mock('@xchain-wallet/core/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: { autolockMinutes: 0, walletMode: 'full' },
        loading: false,
        error: null,
        refresh: vi.fn(),
        update: vi.fn(),
    }),
}));
vi.mock('@xchain-wallet/core/shared/hooks/useAutoLockPolicy.js', () => ({
    useAutoLockPolicy: () => ({ armed: false, idleMs: 0, minutes: 0, checkNow: vi.fn() }),
}));
vi.mock('@xchain-wallet/core/shared/hooks/useLastView.js', () => ({ useLastView: () => {} }));
vi.mock('@xchain-wallet/core/shared/hooks/useWalletMode.js', () => ({
    useWalletMode: () => ({
        walletMode: 'full',
        isFullMode: true,
        isWatcherMode: false,
        isSignerMode: false,
    }),
}));
vi.mock('@xchain-wallet/core/shared/hooks/useMessagingUnread.js', () => ({
    useMessagingUnread: () => 0,
}));
vi.mock('@xchain-wallet/core/shared/hooks/useAccountList.js', () => ({ useAccountList: () => [] }));
vi.mock('@xchain-wallet/core/shared/hooks/useBtcAddressesPresent.js', () => ({
    useBtcAddressesPresent: () => false,
}));
vi.mock('@xchain-wallet/core/shared/hooks/useVmAddressesPresent.js', () => ({
    useVmAddressesPresent: () => false,
}));
vi.mock('@xchain-wallet/core/shared/hooks/useGovernanceAddressesPresent.js', () => ({
    useGovernanceAddressesPresent: () => false,
}));
vi.mock('@xchain-wallet/core/shared/keyboard/useKeyboardShortcuts.js', () => ({
    useKeyboardShortcuts: () => {},
}));
vi.mock('@xchain-wallet/core/shared/commandPalette/useCommandPalette.js', () => ({
    useCommandPalette: ({ navigate }) => ({
        open: false,
        navigationKey: 0,
        navigate,
        openPalette: vi.fn(),
        closePalette: vi.fn(),
    }),
}));
vi.mock('@xchain-wallet/core/shared/commandPalette/CommandPalette.jsx', () => ({
    CommandPalette: () => null,
}));
vi.mock('@xchain-wallet/core/shared/keyboard/ShortcutHelp.jsx', () => ({ ShortcutHelp: () => null }));
vi.mock('@xchain-wallet/core/shared/hooks/useCoinpayObligations.js', () => ({
    CoinpayObligationsProvider: ({ children }) => children,
    useSharedCoinpayObligations: () => ({ payableCount: 0 }),
}));
vi.mock('../../../packages/desktop/renderer/deepLinkRoute.js', () => ({ useDeepLinks: () => {} }));

vi.mock('@xchain-wallet/core/shared/routes/Home.jsx', () => ({
    Home: () => <h1>Home screen</h1>,
}));
vi.mock('@xchain-wallet/core/shared/routes/Settings.jsx', () => ({
    Settings: () => <h1>Settings screen</h1>,
}));
vi.mock('@xchain-wallet/core/shared/components/AppHeader.jsx', () => ({ AppHeader: () => null }));
vi.mock('@xchain-wallet/core/shared/components/BottomTabBar.jsx', () => ({ BottomTabBar: () => null }));
vi.mock('@xchain-wallet/core/shared/components/QueuedBroadcastBanner.jsx', () => ({
    QueuedBroadcastBanner: () => null,
}));
vi.mock('@xchain-wallet/core/shared/components/ReachabilityBanner.jsx', () => ({
    ReachabilityBanner: () => null,
}));
vi.mock('@xchain-wallet/core/shared/components/DemoBanner.jsx', () => ({ DemoBanner: () => null }));
vi.mock('@xchain-wallet/core/shared/components/NetworkBanner.jsx', () => ({ NetworkBanner: () => null }));

import { App } from '../../../packages/desktop/renderer/App.jsx';

function createPreloadBridge() {
    let sessionState = 'locked';
    const failures = new Map();
    const sendMessage = vi.fn(async ({ type, request }) => {
        if (failures.has(type)) throw failures.get(type);
        if (type === 'session.status') {
            return {
                ok: true,
                result: {
                    hasWallet: true,
                    hasSession: sessionState === 'unlocked',
                    state: sessionState,
                },
            };
        }
        if (type === 'wallet.unlock') {
            sessionState = 'unlocked';
            return { ok: true, result: {} };
        }
        if (type === 'wallet.list') {
            return { ok: true, result: [{ id: 'wallet-1', name: 'Primary wallet' }] };
        }
        if (type === 'account.list') {
            expect(request).toEqual({ walletId: 'wallet-1' });
            return { ok: true, result: [{ id: 'account-1', index: 0, name: 'Main' }] };
        }
        if (type === 'wallet.lock') {
            sessionState = 'locked';
            return { ok: true, result: {} };
        }
        throw new Error(`unexpected renderer IPC call: ${type}`);
    });

    return { failures, sendMessage };
}

async function importRenderer() {
    await import('../../../packages/desktop/renderer/main.jsx');
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.body.innerHTML = '<div id="xchain-desktop-root"></div>';
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    window.xchainWalletRegistry = {
        getRemoteDescriptors: vi.fn().mockResolvedValue({ ok: true, descriptors: [] }),
    };
    window.xchainWalletWindow = { onStateChange: vi.fn(() => vi.fn()) };
});

afterEach(() => {
    delete window.xchainWalletBridge;
    delete window.xchainWalletRegistry;
    delete window.xchainWalletWindow;
});

describe('desktop renderer shell', () => {
    it('boots, unlocks into Home, opens Settings, and locks through the preload bridge', async () => {
        const bridge = createPreloadBridge();
        window.xchainWalletBridge = bridge;

        await importRenderer();

        expect(await screen.findByRole('heading', { name: 'Unlock wallet' })).toBeInTheDocument();
        expect(boot.installErrorCapture).toHaveBeenCalledOnce();
        expect(boot.installFiatRateSource).toHaveBeenCalledOnce();
        expect(boot.setShellCapabilities).toHaveBeenCalledWith({ socksProxy: true });
        expect(bridge.sendMessage).toHaveBeenCalledWith({ type: 'session.status', request: undefined });

        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse' } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));

        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Home screen' })).toBeInTheDocument();
        });
        expect(bridge.sendMessage).toHaveBeenCalledWith({
            type: 'wallet.unlock',
            request: { password: 'correct horse' },
        });
        await waitFor(() => {
            expect(bridge.sendMessage).toHaveBeenCalledWith({ type: 'wallet.list', request: undefined });
            expect(bridge.sendMessage).toHaveBeenCalledWith({
                type: 'account.list',
                request: { walletId: 'wallet-1' },
            });
        });

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
        expect(await screen.findByRole('heading', { name: 'Settings screen' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
        expect(await screen.findByRole('heading', { name: 'Unlock wallet' })).toBeInTheDocument();
        expect(bridge.sendMessage).toHaveBeenCalledWith({ type: 'wallet.lock', request: undefined });
    });

    it('keeps the locked screen usable when the preload IPC call rejects', async () => {
        const bridge = createPreloadBridge();
        bridge.failures.set('wallet.unlock', new Error('IPC channel unavailable'));
        window.xchainWalletBridge = bridge;

        render(<App />);
        await screen.findByRole('heading', { name: 'Unlock wallet' });

        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));

        // The failure is reported in plain copy; the raw IPC text stays off screen.
        expect(await screen.findByText('Could not unlock the wallet. Close and reopen the app, then try again.')).toBeInTheDocument();
        expect(screen.queryByText('IPC channel unavailable')).toBeNull();
        expect(screen.getByRole('heading', { name: 'Unlock wallet' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Unlock Wallet' })).toBeEnabled();
        expect(bridge.sendMessage).toHaveBeenCalledWith({
            type: 'wallet.unlock',
            request: { password: 'secret' },
        });
    });
});
