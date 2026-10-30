// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One message per state. Every registered route is mounted in the unlocked
// shell's layout, with the shell's reachability notice, in four data states:
//
//   empty    every read answers with nothing, the network is healthy
//   loading  every read and the reachability probe stay pending
//   offline  the device is offline and every read fails
//   error    every read fails and the services answer degraded
//
// and the page may show at most one page-level message: a StatusMessage
// (`data-variant`) or an EmptyState (`data-empty-state`), counting the shell's
// notice. A message inside a dialog, or inside another message, is not a
// second page message. The freshness line next to a balance is not a notice.

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { RouteErrorBoundary } from '../../../packages/core/src/shared/components/RouteErrorBoundary.jsx';
import { FullLayoutWithNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

// jsdom draws no canvas; the market chart gets a stand-in that accepts any call.
vi.mock('lightweight-charts', () => {
    const stub = () => new Proxy(() => {}, {
        get: (_target, property) => (typeof property === 'symbol' || property === 'then' ? undefined : stub()),
        apply: () => stub(),
    });
    return { createChart: () => stub(), ColorType: { Solid: 'solid' }, CrosshairMode: {}, LineStyle: {}, PriceScaleMode: {} };
});

const routeModules = import.meta.glob(
    '../../../packages/core/src/shared/routes/*.jsx',
);

const STATES = ['empty', 'loading', 'offline', 'error'];
const CHAIN_ID = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

const noop = () => {};
const ROUTE_PROPS = {
    walletId: 'wallet-1',
    accountId: 'account-1',
    activeWalletId: 'wallet-1',
    activeAccountId: 'account-1',
    chainId: CHAIN_ID,
    address: ADDRESS,
    actionIndex: '1',
    contractActionIndex: '1',
    dispenserId: '1',
    tick: 'XCP',
    tick1: 'XCP',
    tick2: 'BTC',
    divisibility: 0,
    alerts: [],
    entry: { type: 'send', status: 'confirmed', timestamp: 0 },
    onBack: noop,
    onClose: noop,
    onDone: noop,
    onNavigate: noop,
    onSelect: noop,
    onOpen: noop,
    onFork: noop,
};

const SETTINGS = {
    activeNetwork: 'mainnet',
    fiatCurrency: 'USD',
    fees: { [CHAIN_ID]: { strategy: 'normal' } },
};

const WALLET = { id: 'wallet-1', name: 'Wallet', type: 'hd', accounts: [{ id: 'account-1', name: 'Account 1' }] };

function pending() {
    return new Promise(() => {});
}

function reachabilityFor(state) {
    if (state === 'offline') {
        return { overall: 'offline', failedFast: true, perChain: [{ chainId: CHAIN_ID, mode: 'offline', services: {} }] };
    }
    if (state === 'error') {
        return { overall: 'degraded', perChain: [{ chainId: CHAIN_ID, mode: 'degraded', services: {} }] };
    }
    return { overall: 'normal', perChain: [{ chainId: CHAIN_ID, mode: 'normal', services: {} }] };
}

function failure(state) {
    return Object.assign(
        new Error(state === 'offline' ? 'Failed to fetch' : 'Explorer returned HTTP 500'),
        { status: state === 'offline' ? 0 : 500 },
    );
}

// Every method the routes call answers by state; a few that shape the
// shell (settings, the wallet list) answer the same in every state.
function messagingFor(state) {
    const fixed = {
        getSettings: () => Promise.resolve(SETTINGS),
        listWallets: () => Promise.resolve([WALLET]),
        // Addresses live in the vault, so they read the same in every state.
        getAddressesByChain: () => Promise.resolve({ [CHAIN_ID]: [{ id: 'address-1', address: ADDRESS, source: 'hd', role: 'receive' }] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN_ID]: { id: 'address-1', address: ADDRESS } }),
        checkReachabilityRequest: () => (state === 'loading' ? pending() : Promise.resolve(reachabilityFor(state))),
    };
    return new Proxy({}, {
        get(target, property) {
            if (typeof property !== 'string' || property === 'then') return undefined;
            if (fixed[property]) return fixed[property];
            if (!(property in target)) {
                target[property] = /^(on|subscribe|add.*Listener)/.test(property)
                    ? () => noop
                    : () => {
                        if (state === 'loading') return pending();
                        if (state === 'empty') return Promise.resolve([]);
                        return Promise.reject(failure(state));
                    };
            }
            return target[property];
        },
    });
}

async function componentFor(route) {
    const importer = routeModules[`../../../packages/core/src/shared/routes/${route.component}.jsx`];
    const module = await importer();
    return module[route.component];
}

function visibleMessages(container) {
    const nodes = [...container.querySelectorAll('[data-variant], [data-empty-state]')]
        .filter((el) => !el.closest('[role="dialog"], [hidden], [aria-hidden="true"]'));
    return nodes
        .filter((el) => !nodes.some((other) => other !== el && other.contains(el)))
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 90));
}

// Lets the reads, the reachability probe and the notices they publish settle:
// the page is read once its messages have stayed the same for a few turns.
async function settle(container) {
    let last = null;
    let steady = 0;
    for (let i = 0; i < 60 && steady < 4; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(() => new Promise((resolve) => { setTimeout(resolve, 20); }));
        const now = JSON.stringify(visibleMessages(container));
        steady = now === last ? steady + 1 : 0;
        last = now;
    }
}

let saved;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    saved = {
        ResizeObserver: globalThis.ResizeObserver,
        IntersectionObserver: globalThis.IntersectionObserver,
        matchMedia: globalThis.matchMedia,
    };
    globalThis.ResizeObserver = StubObserver;
    globalThis.IntersectionObserver = StubObserver;
    globalThis.matchMedia = (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
    });
});

afterEach(() => {
    cleanup();
    // Each route state reads its own answers, never a token record another state cached.
    __clearTokenInfoCache();
    localStorage.clear();
    vi.restoreAllMocks();
});

afterAll(() => {
    globalThis.ResizeObserver = saved.ResizeObserver;
    globalThis.IntersectionObserver = saved.IntersectionObserver;
    globalThis.matchMedia = saved.matchMedia;
});

const cases = Object.values(ROUTE_REGISTRY).flatMap((route) => STATES.map((state) => [route.id, state, route]));

describe('one page message per route state', () => {
    it.each(cases)('%s (%s) shows at most one page message', async (id, state, route) => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        if (state === 'offline') vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const Component = await componentFor(route);
        const { container } = render(
            <MessagingProvider shell="web" messaging={messagingFor(state)}>
                <ToastHost>
                    <FullLayoutWithNav
                        routeKey={id}
                        notices={<ReachabilityBanner startupGraceMs={0} confirmMs={0} intervalMs={600_000} />}
                    >
                        <RouteErrorBoundary>
                            <Component {...ROUTE_PROPS} {...route.minimalProps} />
                        </RouteErrorBoundary>
                    </FullLayoutWithNav>
                </ToastHost>
            </MessagingProvider>,
        );
        await settle(container);
        const messages = visibleMessages(container);
        // Zero is fine (a page still loading); two is a stack.
        expect(messages.length, `${id} in ${state}: ${messages.join(' | ')}`).toBeLessThanOrEqual(1);
    }, 60_000);
});
