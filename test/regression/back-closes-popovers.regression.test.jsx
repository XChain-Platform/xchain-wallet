// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: Back closes persistent Home popovers.
//
//   [P1] 2026-10-13: Back bypasses an open Home network control and reaches
//        the route or app-exit action underneath it.

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reachability = vi.hoisted(() => ({
    value: { overall: 'normal', perChain: [] },
}));

vi.mock('../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => reachability.value,
}));

import { HomeFilterBar } from '../../packages/core/src/shared/components/HomeFilterBar.jsx';
import { NetworkStatusIndicator } from '../../packages/core/src/shared/components/NetworkStatusIndicator.jsx';
import {
    registerBackHandler,
    resetBackStackForTests,
} from '../../packages/core/src/ui/backStack.js';

const chainRegistry = {
    byCoin: (coin) => [{
        id: `${coin}-mainnet`,
        displayName: coin === 'bitcoin' ? 'Bitcoin' : 'Dogecoin',
    }],
};

let nativeBack;
let capacitorApp;
let unregisterRoute;

function watchUnderlyingBackActions() {
    const navigateAway = vi.fn();
    unregisterRoute = registerBackHandler(navigateAway, 'route');
    return navigateAway;
}

beforeEach(() => {
    resetBackStackForTests();
    window.history.replaceState(null, '');
    capacitorApp = {
        addListener: vi.fn((_event, listener) => {
            nativeBack = listener;
            return { remove: vi.fn() };
        }),
        minimizeApp: vi.fn(),
    };
    globalThis.Capacitor = { Plugins: { App: capacitorApp } };
});

afterEach(() => {
    unregisterRoute?.();
    unregisterRoute = undefined;
    cleanup();
    resetBackStackForTests();
    delete globalThis.Capacitor;
    vi.restoreAllMocks();
});

describe('regression/back-closes-popovers', () => {
    it('[REGRESSION P1] closes the open Home network filter before navigation or exit', () => {
        const navigateAway = watchUnderlyingBackActions();
        render(
            <HomeFilterBar
                chainRegistry={chainRegistry}
                coinFamilies={['bitcoin', 'dogecoin']}
                networkFilter="all"
                onNetworkFilterChange={() => {}}
                tokenQuery=""
                onTokenQueryChange={() => {}}
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Filter by network' });
        fireEvent.click(trigger);
        expect(screen.getByRole('listbox', { name: 'Networks' })).toBeInTheDocument();

        act(() => nativeBack({ canGoBack: false }));

        expect.soft(screen.queryByRole('listbox', { name: 'Networks' })).toBeNull();
        expect.soft(navigateAway).not.toHaveBeenCalled();
        expect.soft(capacitorApp.minimizeApp).not.toHaveBeenCalled();
    });

    it('[REGRESSION P1] closes the network status popover before navigation or exit', () => {
        const navigateAway = watchUnderlyingBackActions();
        render(<NetworkStatusIndicator onOpenNetworkSettings={() => {}} />);
        const trigger = screen.getByRole('button', { name: /Network connected/ });
        fireEvent.click(trigger);
        expect(screen.getByRole('dialog', { name: 'Network status' })).toBeVisible();

        act(() => nativeBack({ canGoBack: false }));

        expect.soft(trigger).toHaveAttribute('aria-expanded', 'false');
        expect.soft(navigateAway).not.toHaveBeenCalled();
        expect.soft(capacitorApp.minimizeApp).not.toHaveBeenCalled();
    });
});
