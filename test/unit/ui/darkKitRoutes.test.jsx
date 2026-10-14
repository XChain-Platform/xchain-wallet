// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';
import {
    expectNoSeriousAxeViolations,
    supportsAxeColorContrast,
} from '../../a11y/helpers/axe.js';

const routeModules = import.meta.glob(
    '../../../packages/core/src/shared/routes/*.jsx',
);
const routeSources = import.meta.glob(
    '../../../packages/core/src/shared/routes/*.jsx',
    { eager: true, query: '?raw', import: 'default' },
);
const KIT_CONTROL = /<(?:ListRow|Chip|Tabs|SegmentedControl|Checkbox|RadioGroup|Switch)(?=[\s/>])/;
const adopterEntries = Object.entries(routeSources)
    .filter(([, source]) => KIT_CONTROL.test(source))
    .map(([path]) => [path, path.slice(path.lastIndexOf('/') + 1, -4)])
    .sort((first, second) => first[1].localeCompare(second[1]));

const routeProps = Object.values(ROUTE_REGISTRY).reduce((props, route) => {
    if (!(route.component in props)) props[route.component] = route.minimalProps;
    return props;
}, {});
const noop = () => {};
const defaultProps = {
    walletId: 'wallet-1',
    accountId: 'account-1',
    activeAccountId: 'account-1',
    chainId: 'bitcoin-mainnet',
    chainIds: ['bitcoin-mainnet'],
    initialChainId: 'bitcoin-mainnet',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    initialFromAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    tick: 'XCP',
    tick1: 'XCP',
    tick2: 'BTC',
    initialTick: 'XCP',
    actionIndex: '1',
    contractActionIndex: '1',
    contractId: '1',
    dispenserId: '1',
    feedIndex: '1',
    mode: 'transfer',
    divisibility: 0,
    entries: [],
    addresses: [],
    listRef: {
        chainId: 'bitcoin-mainnet',
        actionIndex: '1',
        parentIndex: '1',
        source: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        type: '1',
        items: [],
        state: {},
    },
    onBack: noop,
    onChange: noop,
    onClose: noop,
    onCreated: noop,
    onDone: noop,
    onFork: noop,
    onGenerated: noop,
    onImported: noop,
    onNavigate: noop,
    onOpen: noop,
    onSelect: noop,
    onSwitch: noop,
    onUnlocked: noop,
};

function pending() {
    return new Promise(() => {});
}

function messaging() {
    return new Proxy({}, {
        get(target, property) {
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(pending);
            target[property] = stub;
            return stub;
        },
    });
}

async function componentFor(path, name) {
    const module = await routeModules[path]();
    return module[name]
        ?? Object.values(module).find((value) => typeof value === 'function');
}

let savedGlobals;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    savedGlobals = {
        ResizeObserver: globalThis.ResizeObserver,
        IntersectionObserver: globalThis.IntersectionObserver,
        matchMedia: globalThis.matchMedia,
    };
    globalThis.ResizeObserver = StubObserver;
    globalThis.IntersectionObserver = StubObserver;
    globalThis.matchMedia = (query) => ({
        matches: query === '(prefers-color-scheme: dark)',
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
    localStorage.clear();
    vi.clearAllMocks();
});

afterAll(() => {
    delete document.documentElement.dataset.xcTheme;
    document.documentElement.style.colorScheme = '';
    globalThis.ResizeObserver = savedGlobals.ResizeObserver;
    globalThis.IntersectionObserver = savedGlobals.IntersectionObserver;
    globalThis.matchMedia = savedGlobals.matchMedia;
});

describe('dark theme kit adopter routes', () => {
    it('discovers route adopters and detects the jsdom contrast capability', () => {
        expect(adopterEntries.length).toBeGreaterThan(0);
        const probe = document.createElement('div');
        document.body.append(probe);
        expect(supportsAxeColorContrast(probe)).toBe(false);
        probe.remove();
    });

    it.each(adopterEntries)('%s renders in dark theme without blocking axe violations', async (path, name) => {
        localStorage.setItem('xc:displayPrefs', JSON.stringify({ theme: 'dark' }));
        document.documentElement.dataset.xcTheme = 'dark';
        document.documentElement.style.colorScheme = 'dark';
        const Component = await componentFor(path, name);
        expect(Component, name).toBeTypeOf('function');

        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <Component {...defaultProps} {...routeProps[name]} />
            </MessagingProvider>,
        );

        expect(document.documentElement).toHaveAttribute('data-xc-theme', 'dark');
        await expectNoSeriousAxeViolations(container);
    });
});
