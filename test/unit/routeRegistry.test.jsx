// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { RouteErrorBoundary } from '../../packages/core/src/shared/components/RouteErrorBoundary.jsx';
import {
    HIDDEN_ROUTE_IDS,
    ROUTE_NAV_GROUPS,
    ROUTE_REGISTRY,
} from '../../packages/core/src/shared/routeRegistry.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

let savedResizeObserver;
beforeAll(() => {
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});
afterAll(() => {
    globalThis.ResizeObserver = savedResizeObserver;
});

const routeModules = import.meta.glob(
    '../../packages/core/src/shared/routes/*.jsx',
);

const pendingMessaging = new Proxy(
    {},
    { get: () => () => new Promise(() => {}) },
);

const noop = () => {};
const MINIMAL_UNLOCKED_WALLET_PROPS = {
    walletId: 'wallet-1',
    accountId: 'account-1',
    chainId: 'bitcoin-mainnet',
    actionIndex: '1',
    contractActionIndex: '1',
    dispenserId: '1',
    tick: 'XCP',
    tick1: 'XCP',
    tick2: 'BTC',
    address: 'bc1qexampleexampleexampleexampleexampleex',
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

function moduleImporter(component) {
    return routeModules[`../../packages/core/src/shared/routes/${component}.jsx`];
}

describe('route registry consistency', () => {
    it('gives every route navigation and page metadata', () => {
        const grouped = new Set(Object.values(ROUTE_NAV_GROUPS).flat());
        const hidden = new Set(HIDDEN_ROUTE_IDS);

        for (const [id, route] of Object.entries(ROUTE_REGISTRY)) {
            expect(route.id).toBe(id);
            expect(route.title.trim()).not.toBe('');
            expect(Boolean(route.root) !== Boolean(route.backTarget)).toBe(true);
            if (route.backTarget) expect(ROUTE_REGISTRY[route.backTarget]).toBeDefined();
            expect(ROUTE_NAV_GROUPS[route.nav]).toContain(id);
            expect(grouped.has(id) || hidden.has(id)).toBe(true);
        }
    });

    it('does not leave grouped or hidden routes outside the registry', () => {
        const classified = [
            ...Object.values(ROUTE_NAV_GROUPS).flat(),
            ...HIDDEN_ROUTE_IDS,
        ].sort();
        expect(classified).toEqual(Object.keys(ROUTE_REGISTRY).sort());
    });
});

describe('registered route jsdom smoke', () => {
    for (const route of Object.values(ROUTE_REGISTRY)) {
        it(`${route.id} renders a heading without console errors in the web shell`, async () => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            const importer = moduleImporter(route.component);
            expect(importer, `${route.component}.jsx is registered`).toBeTypeOf('function');
            const routeModule = await importer();
            const Component = routeModule[route.component];
            expect(Component, `${route.component} is exported`).toBeTypeOf('function');

            const result = render(
                <MessagingProvider shell="web" messaging={pendingMessaging}>
                    <RouteErrorBoundary>
                        <Component {...MINIMAL_UNLOCKED_WALLET_PROPS} {...route.minimalProps} />
                    </RouteErrorBoundary>
                </MessagingProvider>,
            );

            expect(result.queryByText('This screen could not be shown')).not.toBeInTheDocument();
            expect(result.container.querySelector('h1, h2, h3, h4, h5, h6')).not.toBeNull();
            expect(consoleError).not.toHaveBeenCalled();
        });
    }
});
