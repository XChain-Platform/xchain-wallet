// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A wallet switch from a sibling window that waited for a signing result
// trims the navigation history the way a switch made in this window does:
// the old wallet's pages leave it, so Back never reopens one of them under
// the new wallet.

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const review = vi.hoisted(() => ({ open: false, endListeners: new Set(), keyboard: null }));

vi.mock('@xchain-wallet/core/shared/hooks/useConfirmAction.js', async (importOriginal) => ({
    ...(await importOriginal()),
    isConfirmActive: () => review.open,
    subscribeConfirmEnd: (listener) => {
        review.endListeners.add(listener);
        return () => { review.endListeners.delete(listener); };
    },
}));

vi.mock('../../../packages/desktop/renderer/errorCapture.js', () => ({ installShellErrorCapture: vi.fn() }));
vi.mock('../../../packages/desktop/renderer/fiatRateSource.js', () => ({ installDesktopFiatRateSource: vi.fn() }));
vi.mock('../../../packages/desktop/renderer/releaseFeedSource.js', () => ({ installDesktopReleaseFeedSource: vi.fn() }));
vi.mock('@xchain-wallet/core/shared/shellCapabilities.js', () => ({ setShellCapabilities: vi.fn() }));
vi.mock('../../../packages/desktop/renderer/DesktopUpdateBanner.jsx', () => ({ DesktopUpdateBanner: () => null }));
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
    useWalletMode: () => ({ walletMode: 'full', isFullMode: true, isWatcherMode: false, isSignerMode: false, walletModeKnown: true }),
    useActiveWalletModeSource: () => {},
    notifyWalletModesChanged: () => {},
}));
vi.mock('@xchain-wallet/core/shared/hooks/useMessagingUnread.js', () => ({ useMessagingUnread: () => 0 }));
vi.mock('@xchain-wallet/core/shared/hooks/useAccountList.js', () => ({ useAccountList: () => [] }));
vi.mock('@xchain-wallet/core/shared/hooks/useBtcAddressesPresent.js', () => ({ useBtcAddressesPresent: () => false }));
vi.mock('@xchain-wallet/core/shared/hooks/useVmAddressesPresent.js', () => ({ useVmAddressesPresent: () => false }));
vi.mock('@xchain-wallet/core/shared/hooks/useGovernanceAddressesPresent.js', () => ({
    useGovernanceAddressesPresent: () => false,
}));
// The shortcut handlers are how this test opens a page from the result screen.
vi.mock('@xchain-wallet/core/shared/keyboard/useKeyboardShortcuts.js', () => ({
    useKeyboardShortcuts: ({ handlers }) => { review.keyboard = handlers; },
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
vi.mock('@xchain-wallet/core/shared/commandPalette/CommandPalette.jsx', () => ({ CommandPalette: () => null }));
vi.mock('@xchain-wallet/core/shared/keyboard/ShortcutHelp.jsx', () => ({ ShortcutHelp: () => null }));
vi.mock('@xchain-wallet/core/shared/hooks/useCoinpayObligations.js', () => ({
    CoinpayObligationsProvider: ({ children }) => children,
    useSharedCoinpayObligations: () => ({ payableCount: 0 }),
}));
vi.mock('../../../packages/desktop/renderer/deepLinkRoute.js', () => ({ useDeepLinks: () => {} }));
vi.mock('@xchain-wallet/core/shared/routes/Home.jsx', () => ({
    Home: ({ activeWalletId, onSignMessage }) => (
        <div>
            <h1>Home screen</h1>
            <p>{`Home for ${activeWalletId}`}</p>
            <button type="button" onClick={onSignMessage}>Open sign message</button>
        </div>
    ),
}));
vi.mock('@xchain-wallet/core/shared/routes/SignMessageForm.jsx', () => ({
    SignMessageForm: ({ walletId, onBack }) => (
        <div>
            <h1>Sign message screen</h1>
            <p>{`Signing for ${walletId}`}</p>
            <button type="button" onClick={onBack}>Leave sign message</button>
        </div>
    ),
}));
vi.mock('@xchain-wallet/core/shared/routes/VerifySignatureForm.jsx', () => ({
    VerifySignatureForm: ({ onBack }) => (
        <div>
            <h1>Verify signature screen</h1>
            <button type="button" onClick={onBack}>Leave verify signature</button>
        </div>
    ),
}));
vi.mock('@xchain-wallet/core/shared/components/AppHeader.jsx', () => ({ AppHeader: () => null }));
vi.mock('@xchain-wallet/core/shared/components/BottomTabBar.jsx', () => ({ BottomTabBar: () => null }));
vi.mock('@xchain-wallet/core/shared/components/QueuedBroadcastBanner.jsx', () => ({ QueuedBroadcastBanner: () => null }));
vi.mock('@xchain-wallet/core/shared/components/ReachabilityBanner.jsx', () => ({ ReachabilityBanner: () => null }));

import { App } from '../../../packages/desktop/renderer/App.jsx';

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    review.open = false;
    review.keyboard = null;
    window.xchainWalletRegistry = { getRemoteDescriptors: vi.fn().mockResolvedValue({ ok: true, descriptors: [] }) };
    window.xchainWalletWindow = { onStateChange: vi.fn(() => vi.fn()) };
    window.xchainWalletBridge = {
        sendMessage: vi.fn(async ({ type, request }) => {
            if (type === 'session.status') {
                return { ok: true, result: { state: 'unlocked', hasWallet: true, hasSession: true } };
            }
            if (type === 'wallet.list') return { ok: true, result: [{ id: 'wallet-1', name: 'Alpha' }, { id: 'wallet-2', name: 'Bravo' }] };
            if (type === 'wallet.setActive') return { ok: true, result: {} };
            if (type === 'account.list') return { ok: true, result: [{ id: `${request.walletId}-a0`, index: 0 }] };
            throw new Error(`unexpected renderer IPC call: ${type}`);
        }),
    };
});

afterEach(() => {
    cleanup();
    review.endListeners.clear();
    delete window.xchainWalletBridge;
    delete window.xchainWalletRegistry;
    delete window.xchainWalletWindow;
});

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

describe('desktop history after a held sibling wallet switch', () => {
    it('drops the old wallet signing page once the user moves on from its result', async () => {
        localStorage.setItem('xc:activeWallet', 'wallet-1');
        render(<App />);
        await screen.findByText('Home for wallet-1');
        fireEvent.click(screen.getByRole('button', { name: 'Open sign message' }));
        await screen.findByText('Signing for wallet-1');
        const onStateChange = window.xchainWalletWindow.onStateChange.mock.calls[0][0];

        // The review signs, and its result stays on screen for wallet-1.
        review.open = true;
        await act(async () => {
            review.open = false;
            for (const listener of [...review.endListeners]) listener({ approved: true, left: false });
        });
        act(() => { onStateChange({ kind: 'active-wallet', walletId: 'wallet-2' }); });
        await settle();
        expect(screen.getByText('Signing for wallet-1')).toBeInTheDocument();

        // The user opens another page from the result; the held switch applies.
        act(() => { review.keyboard.navigate('verify-signature'); });
        await settle();
        expect(await screen.findByRole('heading', { name: 'Verify signature screen' })).toBeInTheDocument();

        // Back skips the old wallet's signing page.
        fireEvent.click(screen.getByRole('button', { name: 'Leave verify signature' }));
        await settle();
        expect(await screen.findByText('Home for wallet-2')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Sign message screen' })).toBeNull();
    });
});
