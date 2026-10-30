// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A network switch reloads the page but keeps its session history. Back
// after the switch must not reopen a route made on the network the user
// left: a mainnet token detail opened on testnet reads a zero balance and
// offers a mainnet receive address under the testnet session.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLastView } from '../../../packages/core/src/shared/hooks/useLastView.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

afterEach(() => {
    cleanup();
    localStorage.clear();
    resetBackStackForTests();
    window.history.replaceState(null, '');
});

const TOKEN_ROUTE = {
    view: 'token-detail',
    params: { chainId: 'bitcoin-mainnet', tick: 'XCP', kind: 'token' },
};

function pop(xcRoute) {
    act(() => {
        window.dispatchEvent(new PopStateEvent('popstate', { state: { xcRoute } }));
    });
}

function renderRoute(network, currentView = 'home') {
    const onResume = vi.fn();
    const onResumeParams = vi.fn();
    const hook = renderHook(
        (props) => useLastView({
            walletId: 'wallet-1',
            currentView: props.currentView,
            currentParams: props.currentParams ?? null,
            network: props.network,
            onResume,
            onResumeParams,
        }),
        { initialProps: { network, currentView } },
    );
    onResume.mockClear();
    onResumeParams.mockClear();
    return { ...hook, onResume, onResumeParams };
}

describe('useLastView network scope', () => {
    it('ignores a history entry made on another network', () => {
        const { onResume, onResumeParams } = renderRoute('testnet');

        pop({ walletId: 'wallet-1', network: 'mainnet', ...TOKEN_ROUTE });

        expect(onResumeParams).not.toHaveBeenCalled();
        expect(onResume).not.toHaveBeenCalled();
    });

    it('restores a history entry made on the active network', () => {
        const { onResume, onResumeParams } = renderRoute('mainnet');

        pop({ walletId: 'wallet-1', network: 'mainnet', ...TOKEN_ROUTE });

        expect(onResumeParams).toHaveBeenCalledWith('token-detail', TOKEN_ROUTE.params);
        expect(onResume).toHaveBeenCalledWith('token-detail');
    });

    it('stamps each history entry with the active network', () => {
        const { rerender } = renderRoute('testnet');

        rerender({ network: 'testnet', currentView: 'history' });

        expect(window.history.state?.xcRoute).toEqual({
            walletId: 'wallet-1',
            network: 'testnet',
            view: 'history',
            params: null,
        });
    });

    it('keeps an entry with no network restorable while the network is unknown', () => {
        const { onResume } = renderRoute(undefined);

        pop({ walletId: 'wallet-1', network: 'mainnet', view: 'history', params: null });

        expect(onResume).toHaveBeenCalledWith('history');
    });
});
