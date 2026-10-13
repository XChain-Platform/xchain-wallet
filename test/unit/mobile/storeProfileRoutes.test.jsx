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
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';
import {
    HIDDEN_SURFACES,
    SURFACE_VIEWS,
} from '../../../packages/web/src/surfaces/registry.js';

afterEach(cleanup);

const routeModules = import.meta.glob(
    '../../../packages/core/src/shared/routes/*.jsx',
);

const pendingMessaging = new Proxy(
    {},
    { get: () => () => new Promise(() => {}) },
);

const noop = () => {};
const MINIMAL_PROPS = {
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
    return routeModules[`../../../packages/core/src/shared/routes/${component}.jsx`];
}

function hiddenRouteIds(profile) {
    return new Set(HIDDEN_SURFACES[profile].flatMap((surface) => SURFACE_VIEWS[surface]));
}

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

describe('store profile build-time routing', () => {
    it('removes exactly the routes owned by documented hidden surfaces', () => {
        const hidden = hiddenRouteIds('store');
        const all = Object.keys(ROUTE_REGISTRY);
        const reachable = all.filter((id) => !hidden.has(id));

        expect(all.filter((id) => !reachable.includes(id)).sort()).toEqual(
            [...hidden].sort(),
        );
        for (const id of hidden) {
            expect(ROUTE_REGISTRY[id], `${id} is a documented route`).toBeDefined();
        }
    });
});

const storeHiddenRoutes = hiddenRouteIds('store');
const storeRoutes = Object.values(ROUTE_REGISTRY).filter(
    ({ id }) => !storeHiddenRoutes.has(id),
);

describe('every route reachable in the store profile', () => {
    it('keeps at least one route reachable', () => {
        expect(storeRoutes.length).toBeGreaterThan(0);
    });

    for (const route of storeRoutes) {
        it(`${route.id} renders`, async () => {
            const importer = moduleImporter(route.component);
            expect(importer, `${route.component}.jsx is registered`).toBeTypeOf('function');
            const routeModule = await importer();
            const Component = routeModule[route.component];
            expect(Component, `${route.component} is exported`).toBeTypeOf('function');

            expect(() => render(
                <MessagingProvider shell="web" messaging={pendingMessaging}>
                    <Component {...MINIMAL_PROPS} {...route.minimalProps} />
                </MessagingProvider>,
            )).not.toThrow();
        });
    }
});
