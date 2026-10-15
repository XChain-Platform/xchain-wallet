// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function installBridge(wallets) {
    let stateListener;
    const sendMessage = vi.fn(async ({ type, request }) => {
        if (type === 'session.status') {
            return { ok: true, result: { state: 'unlocked', hasWallet: true, hasSession: true } };
        }
        if (type === 'wallet.list') return { ok: true, result: wallets };
        if (type === 'account.list') {
            return {
                ok: true,
                result: [{ id: `${request.walletId}-account`, index: 0 }],
            };
        }
        throw new Error(`unexpected renderer IPC call: ${type}`);
    });
    window.xchainWalletBridge = { sendMessage };
    window.xchainWalletWindow = {
        onStateChange: vi.fn((listener) => {
            stateListener = listener;
            return vi.fn();
        }),
    };
    return { sendMessage, emit: (change) => act(() => stateListener(change)) };
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    delete window.xchainWalletBridge;
    delete window.xchainWalletWindow;
});

describe('desktop renderer state synchronization branches', () => {
    it('refreshes session state when the main process sends a session nudge', async () => {
        const bridge = installBridge([{ id: 'wallet-1', name: 'Primary' }]);
        render(<App />);
        await screen.findByRole('heading', { name: 'Home screen' });

        bridge.emit({ kind: 'session' });

        await waitFor(() => {
            expect(bridge.sendMessage.mock.calls.filter(([message]) => (
                message.type === 'session.status'
            ))).toHaveLength(2);
        });
    });

    it('ignores malformed wallet changes and applies a loaded sibling wallet', async () => {
        const bridge = installBridge([
            { id: 'wallet-1', name: 'Primary' },
            { id: 'wallet-2', name: 'Secondary' },
        ]);
        render(<App />);
        await waitFor(() => expect(bridge.sendMessage).toHaveBeenCalledWith({
            type: 'account.list',
            request: { walletId: 'wallet-1' },
        }));
        const accountCallsBefore = bridge.sendMessage.mock.calls.filter(([message]) => (
            message.type === 'account.list'
        )).length;

        bridge.emit({ kind: 'active-wallet', walletId: 2 });
        expect(bridge.sendMessage.mock.calls.filter(([message]) => (
            message.type === 'account.list'
        ))).toHaveLength(accountCallsBefore);

        bridge.emit({ kind: 'active-wallet', walletId: 'wallet-2' });
        await waitFor(() => expect(bridge.sendMessage).toHaveBeenCalledWith({
            type: 'account.list',
            request: { walletId: 'wallet-2' },
        }));
    });

    it('treats a non-array wallet reply as an empty list', async () => {
        const bridge = installBridge(null);
        render(<App />);
        await screen.findByRole('heading', { name: 'Home screen' });
        await waitFor(() => expect(bridge.sendMessage).toHaveBeenCalledWith({
            type: 'wallet.list',
            request: undefined,
        }));

        expect(bridge.sendMessage.mock.calls.some(([message]) => (
            message.type === 'account.list'
        ))).toBe(false);
    });
});
