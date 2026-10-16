// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Network-backed list screens with the device offline: each shows its offline
// state at once instead of a skeleton that waits on reads that cannot finish,
// the shell's reachability notice steps aside so the page has one message,
// and the reads run when the connection returns.

import React, { useMemo, useState } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

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
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';
import { MarketsList } from '../../../packages/core/src/shared/routes/MarketsList.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const WALLET_ID = 'offline-lists-wallet';
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

afterEach(() => {
    cleanup();
    localStorage.clear();
    reachability.overall = 'offline';
    delete navigator.onLine;
});

function setNavigatorOnline(online) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

// A read that never settles, the way an unreachable explorer behaves while
// the request layer is still retrying.
const pending = () => vi.fn(() => new Promise(() => {}));

function messagingWith(defaults) {
    return new Proxy({
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'address-1', address: ADDRESS, source: 'hd', role: 'receive' }],
        }),
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
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

// The shell's notice slot as the layout wires it.
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

async function expectOneOfflineMessage(body) {
    expect(await screen.findByText("You're offline")).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.queryByText('Some balances may be out of date')).toBeNull();
    expect(screen.queryByRole('status', { name: /^Loading/ })).toBeNull();
}

const SCREENS = [
    {
        name: 'My lists',
        body: 'Your lists load when the connection returns.',
        reads: { getListsForSource: pending() },
        read: 'getListsForSource',
        route: () => <MyLists walletId={WALLET_ID} onOpenList={() => {}} onBack={() => {}} />,
    },
    {
        name: 'Dispensers',
        body: 'Your dispensers load when the connection returns.',
        reads: { getDispensersForSource: pending() },
        read: 'getDispensersForSource',
        route: () => <DispensersList walletId={WALLET_ID} onOpenDispenser={() => {}} onBack={() => {}} />,
    },
    {
        name: 'Contracts',
        body: 'Contracts load when the connection returns.',
        reads: {
            getContractsForSource: pending(),
            getDepositsForAddress: pending(),
            getWithdrawalsForAddress: pending(),
            getContractsBrowseAll: pending(),
        },
        read: 'getContractsBrowseAll',
        route: () => <ContractsList walletId={WALLET_ID} onOpenContract={() => {}} onBack={() => {}} />,
    },
    {
        name: 'Messaging',
        body: 'Your messages load when the connection returns.',
        reads: {
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getMessagingInboxSweep: pending(),
        },
        read: 'getMessagingInboxSweep',
        route: () => <MessagingInbox walletId={WALLET_ID} onCompose={() => {}} onBack={() => {}} />,
    },
];

describe('network-backed list screens offline', () => {
    for (const screenCase of SCREENS) {
        it(`${screenCase.name} shows its offline state at once and reads nothing`, async () => {
            setNavigatorOnline(false);
            const messaging = messagingWith(screenCase.reads);

            renderScreen(messaging, screenCase.route());

            await expectOneOfflineMessage(screenCase.body);
            expect(messaging[screenCase.read]).not.toHaveBeenCalled();
        });
    }

    it('DEX markets show the offline state while their read waits', async () => {
        setNavigatorOnline(false);
        const messaging = messagingWith({
            getMarkets: pending(),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        });

        renderScreen(messaging, (
            <MarketsList
                walletId={WALLET_ID}
                selectedAsset={{ chainId: CHAIN, tick: 'BTC' }}
                onChangeAsset={() => {}}
                onOpenMarket={() => {}}
            />
        ));

        await expectOneOfflineMessage('Markets load when the connection returns.');
        expect(screen.getByRole('region', { name: 'Markets results' })).not.toHaveAttribute('aria-busy');
    });

    it('DEX markets replace a failed read with the offline state, not a second message', async () => {
        setNavigatorOnline(false);
        const messaging = messagingWith({
            getMarkets: vi.fn().mockRejectedValue(new Error('Network Error')),
            listWatchlistForWallet: vi.fn().mockResolvedValue([]),
        });

        renderScreen(messaging, (
            <MarketsList
                walletId={WALLET_ID}
                selectedAsset={{ chainId: CHAIN, tick: 'BTC' }}
                onChangeAsset={() => {}}
                onOpenMarket={() => {}}
            />
        ));

        await expectOneOfflineMessage('Markets load when the connection returns.');
        await waitFor(() => expect(messaging.getMarkets).toHaveBeenCalled());
        expect(screen.queryByText('Could not load markets. Try again.')).toBeNull();
    });

    it('loads the lists when the connection returns', async () => {
        setNavigatorOnline(false);
        reachability.overall = 'unknown';
        const messaging = messagingWith({
            getListsForSource: vi.fn().mockResolvedValue({ data: [] }),
        });
        renderScreen(messaging, <MyLists walletId={WALLET_ID} onOpenList={() => {}} onBack={() => {}} />);
        expect(await screen.findByText("You're offline")).toBeInTheDocument();
        expect(messaging.getListsForSource).not.toHaveBeenCalled();

        setNavigatorOnline(true);
        act(() => { window.dispatchEvent(new Event('online')); });

        await waitFor(() => expect(messaging.getListsForSource).toHaveBeenCalled());
        expect(await screen.findByText('No lists yet')).toBeInTheDocument();
        expect(screen.queryByText("You're offline")).toBeNull();
    });
});
