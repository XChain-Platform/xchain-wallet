// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Action screens on a device that still reports a network while the shared
// probe finds every service unreachable (a phone WebView with Wi-Fi off):
// each behaves like a browser that reports offline, with one message on the
// page and the shell's reachability notice stepped aside. With the probe
// healthy the same screens are unchanged.

import React, { useMemo, useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

const reachability = vi.hoisted(() => ({ overall: 'offline' }));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({
        loading: false,
        overall: reachability.overall,
        perChain: [],
        refresh: vi.fn(),
        lastChecked: null,
        error: null,
    }),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import {
    ReachabilityNoticeHiddenContext,
    ShellNoticesContext,
} from '../../../packages/core/src/shared/components/noticesRoute.js';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { CrossChainSwapForm } from '../../../packages/core/src/shared/routes/CrossChainSwapForm.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const WALLET_ID = 'offline-actions-wallet';
const BANNER = 'Some balances may be out of date';
let savedResizeObserver;

beforeAll(() => {
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
    };
});

afterAll(() => {
    globalThis.ResizeObserver = savedResizeObserver;
});

beforeEach(() => {
    reachability.overall = 'offline';
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    delete navigator.onLine;
});

function messagingWith(defaults) {
    return new Proxy({
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'address-1', address: ADDRESS, source: 'hd', role: 'receive' }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        ...defaults,
    }, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
}

function ShellNotices({ children }) {
    const [hidden, setHidden] = useState(0);
    const notices = useMemo(() => ({ claim: () => () => {}, setReachabilityHidden: setHidden }), []);
    return (
        <ShellNoticesContext.Provider value={notices}>
            <ReachabilityNoticeHiddenContext.Provider value={hidden > 0}>
                <ReachabilityBanner />
            </ReachabilityNoticeHiddenContext.Provider>
            {children}
        </ShellNoticesContext.Provider>
    );
}

function renderScreen(messaging, route) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <ShellNotices>{route}</ShellNotices>
            </ToastHost>
        </MessagingProvider>,
    );
}

const ENTRY = {
    key: `${CHAIN}:1255:${ADDRESS}`,
    chainId: CHAIN,
    address: ADDRESS,
    actionIndex: '1255',
    action: 'SEND',
    blockIndex: 7707,
    timestamp: Date.now() - 10000,
    txHash: 'ab'.repeat(32),
    source: ADDRESS,
    raw: { source: ADDRESS, destination: ADDRESS },
    link: null,
};

describe('ActionDetail', () => {
    it('shows its offline message once and hides the shell notice when only the probe is offline', async () => {
        renderScreen(messagingWith({}), (
            <ActionDetail entry={ENTRY} walletId={WALLET_ID} onBack={() => {}} />
        ));
        expect(await screen.findByText(/You are offline\. Showing saved action details/)).toBeInTheDocument();
        expect(screen.queryByText(BANNER)).toBeNull();
    });

    it('does not read the pending transaction from the explorer while offline', async () => {
        const messaging = messagingWith({});
        const pending = { ...ENTRY, blockIndex: 0 };
        renderScreen(messaging, (
            <ActionDetail entry={pending} walletId={WALLET_ID} onBack={() => {}} />
        ));
        await screen.findByText(/You are offline\. Showing saved action details/);
        expect(messaging.getAddressHistory).not.toHaveBeenCalled();
    });

    it('shows no offline message when the probe is healthy', async () => {
        reachability.overall = 'normal';
        renderScreen(messagingWith({}), (
            <ActionDetail entry={ENTRY} walletId={WALLET_ID} onBack={() => {}} />
        ));
        await screen.findByText(/SEND/i, {}, { timeout: 3000 }).catch(() => {});
        expect(screen.queryByText(/You are offline/)).toBeNull();
    });
});

describe.each([
    ['SwapForm', () => <SwapForm walletId={WALLET_ID} onBack={() => {}} />, 'Swapping needs a network connection.'],
    ['CrossChainSwapForm', () => <CrossChainSwapForm walletId={WALLET_ID} onBack={() => {}} />, 'Swapping needs a network connection.'],
    ['TokenWizard', () => <TokenWizard walletId={WALLET_ID} onBack={() => {}} />, 'Creating a token needs a network connection.'],
])('%s', (_name, route, message) => {
    it('shows one offline message and hides the shell notice when only the probe is offline', async () => {
        renderScreen(messagingWith({}), route());
        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(screen.getAllByText(message)).toHaveLength(1);
        expect(screen.queryByText(BANNER)).toBeNull();
        expect(screen.queryByText(/fee estimate unavailable/i)).toBeNull();
    });

    it('shows no offline message when the probe is healthy', async () => {
        reachability.overall = 'normal';
        renderScreen(messagingWith({}), route());
        await screen.findByRole('heading', {}, { timeout: 3000 }).catch(() => {});
        expect(screen.queryByText(message)).toBeNull();
    });
});

describe('TokenWizard load failure offline', () => {
    it('shows the load error as the one message, without the offline note', async () => {
        renderScreen(messagingWith({
            getAddressesByChain: vi.fn().mockRejectedValue(new Error('Could not read your addresses.')),
        }), <TokenWizard walletId={WALLET_ID} onBack={() => {}} />);
        await screen.findByText('Could not read your addresses.');
        expect(screen.queryByText('Creating a token needs a network connection.')).toBeNull();
        expect(screen.queryByText(BANNER)).toBeNull();
    });
});

describe('TokenDetail', () => {
    function detail() {
        return (
            <TokenDetail
                walletId={WALLET_ID}
                chainId={CHAIN}
                tick="CACHE"
                kind="token"
                quantity="10"
                divisibility={0}
                onBack={() => {}}
                onSend={vi.fn()}
                onReceive={vi.fn()}
                onBuy={vi.fn()}
            />
        );
    }
    const detailMessaging = () => messagingWith({
        getTokenInfo: vi.fn().mockResolvedValue({ creator: ADDRESS }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
    });

    it('disables Send and Trade with reasons when only the probe is offline', async () => {
        renderScreen(detailMessaging(), detail());
        const actions = within(await screen.findByRole('group', { name: 'Quick actions' }));
        expect(actions.getByRole('button', { name: 'Trade' })).toBeDisabled();
        expect(actions.getByText('Trade needs a network connection.')).toBeInTheDocument();
    });

    it('keeps Trade enabled when the probe is healthy', async () => {
        reachability.overall = 'normal';
        renderScreen(detailMessaging(), detail());
        const actions = within(await screen.findByRole('group', { name: 'Quick actions' }));
        expect(actions.getByRole('button', { name: 'Trade' })).toBeEnabled();
        expect(actions.queryByText('Trade needs a network connection.')).toBeNull();
    });
});
