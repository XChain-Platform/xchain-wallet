// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';

const controls = vi.hoisted(() => ({
    desktopRoute: null,
    getWebSessionStatus: vi.fn(async () => ({ state: 'unlocked' })),
    listWebWallets: vi.fn(async () => [{ id: 'wallet-web', name: 'Web Wallet' }]),
    listWebAccounts: vi.fn(async () => [{ id: 'account-web', index: 0 }]),
}));

vi.mock('@xchain-wallet/core/shared/PrivacyBlurGate.jsx', () => ({ PrivacyBlurGate: () => null }));
vi.mock('@xchain-wallet/core/shared/LocaleSync.jsx', () => ({ LocaleSync: () => null }));
vi.mock('@xchain-wallet/core/shared/DisplayPrefsGate.jsx', () => ({ DisplayPrefsGate: () => null }));
vi.mock('@xchain-wallet/core/shared/components/RouteErrorBoundary.jsx', () => ({
    RouteErrorBoundary: ({ children }) => children,
}));
vi.mock('@xchain-wallet/core/shared/components/ToastHost.jsx', () => ({
    ToastHost: ({ children }) => children,
    useClearToastsOnLock: () => {},
    useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn() }),
}));
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
        walletModeKnown: true,
    }),
    useActiveWalletModeSource: () => {},
    notifyWalletModesChanged: () => {},
}));
vi.mock('@xchain-wallet/core/shared/hooks/useWalletFilters.js', () => ({
    useWalletFilters: () => ({ walletFilter: null, setWalletFilter: vi.fn() }),
}));
vi.mock('@xchain-wallet/core/shared/hooks/useMessagingUnread.js', () => ({ useMessagingUnread: () => 0 }));
vi.mock('@xchain-wallet/core/shared/hooks/useAccountList.js', () => ({ useAccountList: () => [] }));
vi.mock('@xchain-wallet/core/shared/hooks/useBtcAddressesPresent.js', () => ({ useBtcAddressesPresent: () => false }));
vi.mock('@xchain-wallet/core/shared/hooks/useVmAddressesPresent.js', () => ({ useVmAddressesPresent: () => false }));
vi.mock('@xchain-wallet/core/shared/hooks/useGovernanceAddressesPresent.js', () => ({ useGovernanceAddressesPresent: () => false }));
vi.mock('@xchain-wallet/core/shared/keyboard/useKeyboardShortcuts.js', () => ({ useKeyboardShortcuts: () => {} }));
vi.mock('@xchain-wallet/core/shared/commandPalette/useCommandPalette.js', () => ({
    useCommandPalette: ({ navigate }) => ({
        open: false,
        navigationKey: 0,
        navigate,
        openPalette: vi.fn(),
        closePalette: vi.fn(),
        togglePalette: vi.fn(),
    }),
}));
vi.mock('@xchain-wallet/core/shared/commandPalette/CommandPalette.jsx', () => ({ CommandPalette: () => null }));
vi.mock('@xchain-wallet/core/shared/keyboard/ShortcutHelp.jsx', () => ({ ShortcutHelp: () => null }));
vi.mock('@xchain-wallet/core/shared/hooks/useCoinpayObligations.js', () => ({
    CoinpayObligationsProvider: ({ children }) => children,
    useSharedCoinpayObligations: () => ({ payableCount: 0 }),
}));
vi.mock('@xchain-wallet/core/shared/components/LeftNav.jsx', () => ({
    LeftNav: () => null,
    FullLayoutWithNav: ({ children }) => children,
}));
vi.mock('@xchain-wallet/core/shared/components/ShellRouteOutlet.jsx', () => ({
    ShellRouteOutlet: ({ children }) => children,
}));
vi.mock('@xchain-wallet/core/shared/components/ShellAppHeader.jsx', () => ({ ShellAppHeader: () => null }));
vi.mock('@xchain-wallet/core/shared/components/BottomTabBar.jsx', () => ({ BottomTabBar: () => null }));
vi.mock('@xchain-wallet/core/shared/components/QueuedBroadcastBanner.jsx', () => ({ QueuedBroadcastBanner: () => null }));
vi.mock('@xchain-wallet/core/shared/components/ReachabilityBanner.jsx', () => ({ ReachabilityBanner: () => null }));
vi.mock('@xchain-wallet/core/shared/routes/Home.jsx', () => ({ Home: () => <h1>Home</h1> }));
vi.mock('../../../packages/web/src/components/ExtensionBanner.jsx', () => ({ ExtensionBanner: () => null }));
vi.mock('../../../packages/web/src/devVariant.js', () => ({
    useActiveVariant: () => ({ variant: 'full', source: 'auto', viewportPx: 1200 }),
    shellForVariant: () => 'web',
}));
vi.mock('../../../packages/core/src/shared/approval/SignApproval.jsx', () => ({
    SignApproval: ({ id, kind, payload }) => (
        <section
            data-testid="site-request-approval"
            data-id={id}
            data-kind={kind}
            data-origin={payload.origin}
            data-address={payload.payload.address}
        />
    ),
}));

vi.mock('../../../packages/web/src/messaging.js', async (importOriginal) => ({
    ...await importOriginal(),
    getSessionStatus: controls.getWebSessionStatus,
    listWallets: controls.listWebWallets,
    listAccounts: controls.listWebAccounts,
}));

vi.mock('../../../packages/desktop/renderer/deepLinkRoute.js', async (importOriginal) => {
    const actual = await importOriginal();
    const { useEffect, useRef } = await import('react');
    return {
        ...actual,
        useDeepLinks: (options) => {
            const delivered = useRef(false);
            useEffect(() => {
                if (delivered.current || !controls.desktopRoute || !options.unlocked || !options.walletId) return;
                delivered.current = true;
                options.apply(controls.desktopRoute);
            }, [options.unlocked, options.walletId]);
            return { waiting: false, drop: vi.fn() };
        },
    };
});

import { App as WebApp } from '../../../packages/web/src/App.jsx';
import { App as DesktopApp } from '../../../packages/desktop/renderer/App.jsx';
import { deepLinkRoute } from '../../../packages/desktop/renderer/deepLinkRoute.js';

const NOW = 1_800_000_000_000;

function requestLink(changes = {}, outerVersion = 1) {
    const envelope = {
        v: 1,
        id: 'AAAAAAAAAAAAAAAAAAAAAA',
        method: 'signMessage',
        params: {
            chainId: 'BTC',
            address: 'bc1qrequestvector',
            message: 'Approve this request',
        },
        return: 'https://request.example/connect/return',
        exp: NOW + 300_000,
        ...changes,
    };
    const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64url');
    return `xchain:request?v=${outerVersion}&req=${encoded}`;
}

function installDesktopBridge() {
    window.xchainWalletBridge = {
        sendMessage: vi.fn(async ({ type, request }) => {
            if (type === 'session.status') {
                return { ok: true, result: { state: 'unlocked', hasWallet: true, hasSession: true } };
            }
            if (type === 'wallet.list') return { ok: true, result: [{ id: 'wallet-desktop', name: 'Desktop Wallet' }] };
            if (type === 'account.list') {
                return { ok: true, result: [{ id: `${request.walletId}-account`, index: 0 }] };
            }
            throw new Error(`unexpected desktop request: ${type}`);
        }),
    };
    window.xchainWalletWindow = { onStateChange: vi.fn(() => vi.fn()) };
}

async function renderWeb(link) {
    window.history.replaceState({}, '', `/?uri=${encodeURIComponent(link)}`);
    return render(<WebApp />);
}

async function renderDesktop(link) {
    installDesktopBridge();
    controls.desktopRoute = deepLinkRoute(link, null);
    return render(<DesktopApp />);
}

beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    localStorage.clear();
    controls.desktopRoute = null;
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete window.xchainWalletBridge;
    delete window.xchainWalletWindow;
    window.history.replaceState({}, '', '/');
});

describe.each([
    ['web', renderWeb],
    ['desktop', renderDesktop],
])('%s app site request route', (_shell, renderShell) => {
    it('passes the routed request fields to SiteRequestApproval', async () => {
        await renderShell(requestLink());

        const approval = await screen.findByTestId('site-request-approval');
        expect(approval).toHaveAttribute('data-id', 'AAAAAAAAAAAAAAAAAAAAAA');
        expect(approval).toHaveAttribute('data-kind', 'signMessage');
        expect(approval).toHaveAttribute('data-origin', 'https://request.example');
        expect(approval).toHaveAttribute('data-address', 'bc1qrequestvector');
    });

    it('renders NewerWalletNeeded for an unsupported request version', async () => {
        const { container } = await renderShell(requestLink({}, 2));

        expect(await screen.findByRole('heading', { name: 'This request needs a newer wallet' }))
            .toBeInTheDocument();
        await expectNoSeriousAxeViolations(container);
    });
});

describe('site request deep link classification', () => {
    it('keeps malformed requests on the invalid link route', () => {
        expect(deepLinkRoute(requestLink({ return: 'javascript:alert(1)' }), null)).toEqual({
            view: 'deep-link-error',
            message: 'This link is invalid or unsupported.',
        });
    });

    it('unwraps the wallet link host before request routing', () => {
        const raw = requestLink();
        const wrapped = `https://wallet.xchain.io/link/?uri=${encodeURIComponent(raw)}`;

        expect(deepLinkRoute(wrapped, null)).toEqual(expect.objectContaining({
            view: 'site-request-approval',
        }));
    });
});
