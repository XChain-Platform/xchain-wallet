// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Home's empty tabs depend on balances, so while balances could not be
// checked they say that once instead of "Fund your wallet" or "No tokens
// yet" beside the stale-balances notice.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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

afterEach(() => cleanup());

describe('HomeTabs when balances could not be checked', () => {
    it('shows the first-funding nudge when the empty read is trustworthy', () => {
        mount({ onRecheckBalances: vi.fn() });
        expect(screen.getByText('Fund your wallet')).toBeInTheDocument();
        expect(screen.queryByText('Balances could not be checked')).toBeNull();
    });

    it('replaces the first-funding nudge with one unchecked state and a retry', () => {
        const props = mount({ balancesUnchecked: true, onRecheckBalances: vi.fn() });
        expect(screen.getByText('Balances could not be checked')).toBeInTheDocument();
        expect(screen.queryByText('Fund your wallet')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(props.onRecheckBalances).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
        expect(props.onReceive).toHaveBeenCalledTimes(1);
    });

    it('words the empty Tokens tab the same way, but keeps a search miss as a search miss', () => {
        mount({ balancesUnchecked: true, onRecheckBalances: vi.fn() });
        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
        expect(screen.getByText('Balances could not be checked')).toBeInTheDocument();
        expect(screen.queryByText('No tokens yet')).toBeNull();

        cleanup();
        mount({ balancesUnchecked: true, onRecheckBalances: vi.fn(), tokenQuery: 'LTC' });
        fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
        expect(screen.getByText('No matching tokens')).toBeInTheDocument();
    });
});
