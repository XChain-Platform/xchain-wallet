// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A desktop window holding a review, or the signing or broadcast result a
// review ended on, keeps its wallet when a sibling window switches wallet. The
// switch applies once the review is cancelled or the user leaves the result.
// Wallet and account record changes from a sibling window refresh the names
// this window shows, and a removed wallet is left.

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const review = vi.hoisted(() => ({ open: false, endListeners: new Set(), accountKeys: [], settingsMounts: 0 }));

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
    useWalletMode: () => ({ walletMode: 'full', isFullMode: true, isWatcherMode: false, isSignerMode: false }),
}));
vi.mock('@xchain-wallet/core/shared/hooks/useMessagingUnread.js', () => ({ useMessagingUnread: () => 0 }));
vi.mock('@xchain-wallet/core/shared/hooks/useAccountList.js', () => ({
    useAccountList: (_walletId, refreshKey) => { review.accountKeys.push(refreshKey); return []; },
}));
vi.mock('@xchain-wallet/core/shared/hooks/useBtcAddressesPresent.js', () => ({ useBtcAddressesPresent: () => false }));
vi.mock('@xchain-wallet/core/shared/hooks/useVmAddressesPresent.js', () => ({ useVmAddressesPresent: () => false }));
vi.mock('@xchain-wallet/core/shared/hooks/useGovernanceAddressesPresent.js', () => ({
    useGovernanceAddressesPresent: () => false,
}));
vi.mock('@xchain-wallet/core/shared/keyboard/useKeyboardShortcuts.js', () => ({ useKeyboardShortcuts: () => {} }));
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
    Home: ({ activeWalletId, onSignMessage, onOpenWalletPicker }) => (
        <div>
            <h1>Home screen</h1>
            <p>{`Home for ${activeWalletId}`}</p>
            <button type="button" onClick={onSignMessage}>Open sign message</button>
            <button type="button" onClick={onOpenWalletPicker}>Open wallet picker</button>
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
vi.mock('@xchain-wallet/core/shared/routes/Settings.jsx', async () => {
    const { useEffect } = await import('react');
    return {
        Settings: ({ activeWallet }) => {
            useEffect(() => { review.settingsMounts += 1; }, []);
            return (
                <div>
                    <h1>Settings screen</h1>
                    <p>{`Settings for ${activeWallet?.name ?? 'no wallet'}`}</p>
                </div>
            );
        },
    };
});
vi.mock('@xchain-wallet/core/shared/components/AppHeader.jsx', () => ({ AppHeader: () => null }));
vi.mock('@xchain-wallet/core/shared/components/BottomTabBar.jsx', () => ({ BottomTabBar: () => null }));
vi.mock('@xchain-wallet/core/shared/components/QueuedBroadcastBanner.jsx', () => ({ QueuedBroadcastBanner: () => null }));
vi.mock('@xchain-wallet/core/shared/components/ReachabilityBanner.jsx', () => ({ ReachabilityBanner: () => null }));

import { App } from '../../../packages/desktop/renderer/App.jsx';

let wallets;
let firstList = null;
let listReads = 0;

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    review.open = false;
    review.accountKeys = [];
    review.settingsMounts = 0;
    firstList = null;
    listReads = 0;
    wallets = [{ id: 'wallet-1', name: 'Alpha' }, { id: 'wallet-2', name: 'Bravo' }];
    window.xchainWalletRegistry = { getRemoteDescriptors: vi.fn().mockResolvedValue({ ok: true, descriptors: [] }) };
    window.xchainWalletWindow = { onStateChange: vi.fn(() => vi.fn()) };
    window.xchainWalletBridge = {
        sendMessage: vi.fn(async ({ type, request }) => {
            if (type === 'session.status') {
                return { ok: true, result: { state: 'unlocked', hasWallet: true, hasSession: true } };
            }
            if (type === 'wallet.list') {
                const shown = listReads === 0 && firstList ? firstList : wallets;
                listReads += 1;
                return { ok: true, result: shown.map((wallet) => ({ ...wallet })) };
            }
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

async function onSignMessageForAlpha() {
    localStorage.setItem('xc:activeWallet', 'wallet-1');
    render(<App />);
    await screen.findByText('Home for wallet-1');
    fireEvent.click(screen.getByRole('button', { name: 'Open sign message' }));
    await screen.findByText('Signing for wallet-1');
    return window.xchainWalletWindow.onStateChange.mock.calls[0][0];
}

const endReview = (outcome) => act(async () => {
    review.open = false;
    for (const listener of [...review.endListeners]) listener(outcome);
});

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

describe('desktop window keeps its review through a sibling wallet switch', () => {
    it('keeps the open review on its wallet when a sibling window switches wallet', async () => {
        const onStateChange = await onSignMessageForAlpha();
        review.open = true;
        act(() => { onStateChange({ kind: 'active-wallet', walletId: 'wallet-2' }); });
        await settle();

        expect(screen.getByText('Signing for wallet-1')).toBeInTheDocument();
    });

    it('switches as soon as the held review is cancelled', async () => {
        const onStateChange = await onSignMessageForAlpha();
        review.open = true;
        act(() => { onStateChange({ kind: 'active-wallet', walletId: 'wallet-2' }); });
        await settle();

        await endReview({ approved: false, left: false });
        await settle();

        expect(await screen.findByText('Home for wallet-2')).toBeInTheDocument();
    });

    it('keeps a signing result on screen and switches when the user leaves it', async () => {
        const onStateChange = await onSignMessageForAlpha();
        review.open = true;
        await endReview({ approved: true, left: false });
        act(() => { onStateChange({ kind: 'active-wallet', walletId: 'wallet-2' }); });
        await settle();
        expect(screen.getByText('Signing for wallet-1')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Leave sign message' }));
        await settle();

        expect(await screen.findByText('Home for wallet-2')).toBeInTheDocument();
    });

    it('switches at once when no review or result is open', async () => {
        const onStateChange = await onSignMessageForAlpha();
        act(() => { onStateChange({ kind: 'active-wallet', walletId: 'wallet-2' }); });
        await settle();
        expect(await screen.findByText('Home for wallet-2')).toBeInTheDocument();
    });
});

const sent = (type) => window.xchainWalletBridge.sendMessage.mock.calls.filter(([message]) => message.type === type).length;

async function onSettingsForAlpha() {
    localStorage.setItem('xc:activeWallet', 'wallet-1');
    render(<App />);
    await screen.findByText('Home for wallet-1');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings screen' });
    await settle();
    return window.xchainWalletWindow.onStateChange.mock.calls[0][0];
}

describe('desktop window follows wallet and account record changes from a sibling window', () => {
    it('reads the wallet list again and remounts a screen that lists wallets for a sibling rename', async () => {
        const onStateChange = await onSettingsForAlpha();
        const mounts = review.settingsMounts;
        const reads = sent('wallet.list');

        act(() => { onStateChange({ kind: 'wallets', change: 'renamed', walletId: 'wallet-1' }); });
        await settle();

        expect(sent('wallet.list')).toBeGreaterThan(reads);
        expect(review.settingsMounts).toBe(mounts + 1);
    });

    it('leaves a screen mounted for a sibling rename while a review is open', async () => {
        const onStateChange = await onSettingsForAlpha();
        const mounts = review.settingsMounts;
        review.open = true;

        act(() => { onStateChange({ kind: 'wallets', change: 'renamed', walletId: 'wallet-1' }); });
        act(() => { onStateChange({ kind: 'accounts', change: 'added', walletId: 'wallet-1', accountId: 'a2' }); });
        await settle();

        expect(review.settingsMounts).toBe(mounts);
    });

    it('reads the account names again for an account added or renamed in the shown wallet', async () => {
        const onStateChange = await onSettingsForAlpha();
        const keyBefore = review.accountKeys.at(-1);

        act(() => { onStateChange({ kind: 'accounts', change: 'added', walletId: 'wallet-1', accountId: 'a2' }); });
        await settle();
        const keyAfterAdd = review.accountKeys.at(-1);
        act(() => { onStateChange({ kind: 'accounts', change: 'renamed', walletId: 'wallet-1', accountId: 'a2' }); });
        await settle();

        expect(keyAfterAdd).not.toBe(keyBefore);
        expect(review.accountKeys.at(-1)).not.toBe(keyAfterAdd);
    });

    it('ignores an account change in a wallet this window does not show', async () => {
        const onStateChange = await onSettingsForAlpha();
        const mounts = review.settingsMounts;
        const keyBefore = review.accountKeys.at(-1);

        act(() => { onStateChange({ kind: 'accounts', change: 'added', walletId: 'wallet-2', accountId: 'b2' }); });
        await settle();

        expect(review.accountKeys.at(-1)).toBe(keyBefore);
        expect(review.settingsMounts).toBe(mounts);
    });

    it('leaves the shown wallet when a sibling window removes it', async () => {
        localStorage.setItem('xc:activeWallet', 'wallet-1');
        render(<App />);
        await screen.findByText('Home for wallet-1');
        const onStateChange = window.xchainWalletWindow.onStateChange.mock.calls[0][0];

        wallets = wallets.filter((wallet) => wallet.id !== 'wallet-1');
        act(() => { onStateChange({ kind: 'wallets', change: 'removed', walletId: 'wallet-1' }); });
        await settle();

        expect(await screen.findByText('Home for wallet-2')).toBeInTheDocument();
    });

    it('drops a held switch to a wallet a sibling window removed before the review ended', async () => {
        const onStateChange = await onSignMessageForAlpha();
        review.open = true;
        act(() => { onStateChange({ kind: 'active-wallet', walletId: 'wallet-2' }); });
        wallets = wallets.filter((wallet) => wallet.id !== 'wallet-2');
        act(() => { onStateChange({ kind: 'wallets', change: 'removed', walletId: 'wallet-2' }); });
        await settle();

        await endReview({ approved: false, left: false });
        await settle();

        expect(screen.getByText('Signing for wallet-1')).toBeInTheDocument();
        expect(screen.queryByText('Home for wallet-2')).toBeNull();
    });

    it('hands the record revision to both rename screens', () => {
        const source = readFileSync(join(process.cwd(), 'packages/desktop/renderer/App.jsx'), 'utf8');
        expect(source).toMatch(/<RenameWalletForm[^>]*?refreshKey=\{recordRevision\}/s);
        expect(source).toMatch(/<RenameAccountForm[^>]*?refreshKey=\{recordRevision\}/s);
    });
});

describe('desktop window names a wallet its list lacks', () => {
    it('reads the wallet list again when the user switches to a wallet added by a flow left before it finished', async () => {
        // The session read lists only Alpha: Bravo was added by a flow left on
        // its closing notice, so it never reached the shell list.
        firstList = [{ id: 'wallet-1', name: 'Alpha' }];
        localStorage.setItem('xc:activeWallet', 'wallet-1');
        render(<App />);
        await screen.findByText('Home for wallet-1');
        fireEvent.click(screen.getByRole('button', { name: 'Open wallet picker' }));
        const row = await screen.findByRole('button', { name: /^(?!Wallet details for).*Bravo/ });
        fireEvent.click(row);
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        expect(await screen.findByText('Settings for Bravo')).toBeInTheDocument();
    });
});
