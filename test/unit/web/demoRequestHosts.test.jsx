// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { COINGECKO_API_BASE } from '../../../packages/core/src/branding/branding.js';
import { isDemoWallet, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { joinEndpoint } from '../../../packages/core/src/sdk/SDKRegistry.js';

const DEMO_WALLET_ID = 'request-audit-demo';
const audit = vi.hoisted(() => ({
    root: null,
    requests: [],
    getSessionStatus: vi.fn(async () => ({ state: 'unlocked' })),
    listWallets: vi.fn(async () => ([{
        id: DEMO_WALLET_ID,
        name: 'Demo Wallet',
        format: 'bip39',
    }])),
    listAccounts: vi.fn(async () => ([{
        id: 'request-audit-account',
        walletId: DEMO_WALLET_ID,
        index: 0,
        name: 'Main Account',
    }])),
}));

vi.mock('react-dom/client', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        createRoot(container) {
            audit.root = actual.createRoot(container);
            return audit.root;
        },
    };
});

vi.mock('../../../packages/web/src/messaging.js', async (importOriginal) => ({
    ...await importOriginal(),
    getSessionStatus: audit.getSessionStatus,
    listWallets: audit.listWallets,
    listAccounts: audit.listAccounts,
    getSettings: vi.fn(async () => ({ activeNetwork: 'testnet' })),
    updateSettings: vi.fn(async () => ({})),
    getWalletBalances: vi.fn(async () => ({})),
    getAddressesByChain: vi.fn(async () => ({})),
    getActiveAddresses: vi.fn(async () => ({})),
    getMultisigReceiveAddress: vi.fn(async () => null),
    listConfirmSessions: vi.fn(async () => ({ sessions: [] })),
    listQueuedBroadcasts: vi.fn(async () => []),
    listContacts: vi.fn(async () => []),
    listConnectedSites: vi.fn(async () => []),
    listPendingAirdropsForWallet: vi.fn(async () => []),
    getCoinpayObligationsForAddress: vi.fn(async () => []),
    checkReachabilityRequest: vi.fn(async () => ({ reachable: true })),
    getNativePricesRequest: vi.fn(async () => ({})),
    reportAutoLock: undefined,
}));

vi.mock('../../../packages/web/src/platform/webviewFloor.js', () => ({
    checkWebViewFloor: () => ({ usable: true, stale: false, missing: [], chromium: 130 }),
    floorFailureMessage: () => '',
    floorStaleMessage: () => '',
}));

vi.mock('../../../packages/web/src/storage/nativeVault.js', () => ({
    BROKEN_SHELL_MESSAGE: 'Native vault unavailable.',
    nativeShellIsBroken: () => false,
}));

vi.mock('../../../packages/web/src/storage/nativeKdfProvider.js', () => ({
    installNativeKdfProvider: vi.fn(),
}));

vi.mock('../../../packages/web/src/platform/keyboardViewport.js', () => ({
    installKeyboardViewport: vi.fn(),
}));

vi.mock('../../../packages/web/src/platform/nativeFontScale.js', () => ({
    installNativeFontScale: vi.fn(),
}));

vi.mock('../../../packages/web/src/errorCapture.js', () => ({
    getRecentShellErrors: () => [],
    installShellErrorCapture: vi.fn(),
}));

function requestUrl(input) {
    const value = typeof Request === 'function' && input instanceof Request
        ? input.url
        : String(input);
    return new URL(value, window.location.href);
}

function configuredServiceHosts() {
    const serviceUrls = defaultRegistry().supportedChains().flatMap((descriptor) => ([
        joinEndpoint(descriptor.explorer),
        joinEndpoint(descriptor.encoder),
        // Testnet descriptors carry no default hub; only a configured one is allowed.
        descriptor.hub ? joinEndpoint(descriptor.hub) : null,
    ]));
    return new Set(
        [...serviceUrls, COINGECKO_API_BASE]
            .filter(Boolean)
            .map((url) => new URL(url).host.toLowerCase()),
    );
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    audit.root = null;
    audit.requests.length = 0;
    localStorage.clear();
    markDemoWallet(DEMO_WALLET_ID, { now: Date.now() });
    document.body.innerHTML = '<div id="xchain-web-root"></div>';
    Object.defineProperty(navigator, 'registerProtocolHandler', {
        configurable: true,
        value: vi.fn(),
    });
    vi.stubGlobal('requestIdleCallback', vi.fn((callback) => {
        callback();
        return 1;
    }));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('fetch', vi.fn(async (input) => {
        audit.requests.push({ transport: 'fetch', url: requestUrl(input) });
        return {
            ok: false,
            status: 404,
            headers: new Headers(),
            json: async () => ({}),
        };
    }));
});

afterEach(async () => {
    if (audit.root) await act(async () => audit.root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('web demo shell request hosts', () => {
    it('contacts only configured explorer, hub, encoder, or price-source hosts', async () => {
        const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open')
            .mockImplementation(function open(method, url) {
                audit.requests.push({ transport: 'xhr', url: requestUrl(url) });
            });
        vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {});

        expect(isDemoWallet(DEMO_WALLET_ID)).toBe(true);
        await act(async () => {
            await import('../../../packages/web/src/main.jsx');
        });

        expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
        await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
        await waitFor(() => expect(audit.listAccounts).toHaveBeenCalled());

        const allowedHosts = configuredServiceHosts();
        expect(audit.requests.length).toBeGreaterThan(0);
        for (const request of audit.requests) {
            expect(
                allowedHosts.has(request.url.host.toLowerCase()),
                `${request.transport} requested unconfigured host ${request.url.host}`,
            ).toBe(true);
        }
        expect(xhrOpen).toHaveBeenCalledTimes(
            audit.requests.filter(({ transport }) => transport === 'xhr').length,
        );
    });
});
