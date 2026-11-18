// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's empty Balances tab says "Balances couldn't be checked" in the
// first-funding slot only when the balance check failed; a check that
// passed keeps "Fund your wallet". An empty tab stays quiet while Home's own
// balance notice is up (a load in flight, cached balances), for a demo
// wallet exactly as for a real one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const reachability = vi.hoisted(() => ({ overall: 'normal' }));
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({ overall: reachability.overall, loading: false, perChain: [], lastChecked: null, refresh: () => {}, error: null }),
}));
vi.mock('../../../packages/core/src/shared/components/TotalBalanceHero.jsx', () => ({
    TotalBalanceHero: () => null,
}));
vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: () => null,
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => {
    const value = { messaging: {}, shell: 'web' };
    return { useMessaging: () => value };
});
vi.mock('../../../packages/core/src/shared/hooks/useCollectibleKeys.js', () => ({
    useCollectibleKeys: () => new Set(),
}));

import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { showHomeBalances } from '../../helpers/homeBalances.js';

const chainRegistry = { byCoin: () => [], get: () => null, all: () => [] };

function mount(overrides = {}) {
    const props = {
        chainRegistry,
        balances: {},
        walletId: 'w1',
        networkFilter: 'all',
        coinFamilies: [],
        onNetworkFilterChange: vi.fn(),
        tokenQuery: '',
        onTokenQueryChange: vi.fn(),
        onReceive: vi.fn(),
        ...overrides,
    };
    render(<HomeTabs {...props} />);
    return props;
}

afterEach(() => {
    cleanup();
    reachability.overall = 'normal';
    clearDemoWalletId();
    globalThis.localStorage?.clear();
});

describe('HomeTabs empty tabs', () => {
    it('shows the first-funding nudge when the balance check passed', () => {
        mount();
        expect(screen.getByText('Fund your wallet')).toBeInTheDocument();
        expect(screen.queryByText("Balances couldn't be checked")).toBeNull();
        expect(screen.queryByRole('button', { name: /^Try again$/i })).toBeNull();
    });

    it('says the balances could not be checked in that slot when the check failed', () => {
        reachability.overall = 'degraded';
        mount();
        expect(screen.getByText("Balances couldn't be checked")).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Try again$/i })).toBeInTheDocument();
        expect(screen.queryByText('Fund your wallet')).toBeNull();
    });

    it('keeps the first-funding nudge for a demo wallet whatever the check says', () => {
        reachability.overall = 'degraded';
        markDemoWallet('demo-wallet-1');
        mount({ walletId: 'demo-wallet-1' });
        expect(screen.getByText('Fund your wallet')).toBeInTheDocument();
        expect(screen.queryByText("Balances couldn't be checked")).toBeNull();
    });

    it('shows the ordinary empty Tokens state with no unchecked state', () => {
        reachability.overall = 'degraded';
        mount();
        showHomeBalances('tokens');
        expect(screen.getByText('No tokens yet')).toBeInTheDocument();
        expect(screen.queryByText("Balances couldn't be checked")).toBeNull();
        expect(screen.queryByRole('button', { name: /^Try again$/i })).toBeNull();
    });

    it('keeps a search miss as a search miss', () => {
        mount({ tokenQuery: 'LTC' });
        showHomeBalances('tokens');
        expect(screen.getByText('No matching tokens')).toBeInTheDocument();
    });

    it('stays quiet while Home shows its own balance notice', () => {
        reachability.overall = 'degraded';
        mount({ balanceNoticeShown: true });
        expect(screen.queryByText("Balances couldn't be checked")).toBeNull();
        expect(screen.queryByText('Fund your wallet')).toBeNull();
        showHomeBalances('tokens');
        expect(screen.queryByText('No tokens yet')).toBeNull();
        expect(document.querySelectorAll('[data-empty-state]')).toHaveLength(0);
    });

    it('treats a demo wallet the same way under Home\'s balance notice', () => {
        markDemoWallet('demo-wallet-1');
        mount({ walletId: 'demo-wallet-1', balanceNoticeShown: true });
        expect(screen.queryByText('Fund your wallet')).toBeNull();
        showHomeBalances('tokens');
        expect(screen.queryByText('No tokens yet')).toBeNull();
        expect(document.querySelectorAll('[data-empty-state]')).toHaveLength(0);
    });
});
