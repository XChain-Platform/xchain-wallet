// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A token query that matches nothing used to strand the user on the Tokens
// tab: the empty state pointed at a "top toolbar" that does not exist and the
// filter row holding the query was collapsed. The empty state now clears the
// query itself, and the filter row opens whenever a query is live.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/components/TotalBalanceHero.jsx', () => ({
    TotalBalanceHero: () => null,
}));
vi.mock('../../../packages/core/src/shared/components/PortfolioChart.jsx', () => ({
    PortfolioChart: () => null,
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: {}, shell: 'web' }),
}));
vi.mock('../../../packages/core/src/shared/hooks/useCollectibleKeys.js', () => ({
    useCollectibleKeys: () => new Set(),
}));

import { HomeTabs } from '../../../packages/core/src/shared/components/HomeTabs.jsx';

const chainRegistry = {
    byCoin: () => [],
    get: () => null,
    all: () => [],
};

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
        ...overrides,
    };
    const view = render(<HomeTabs {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tokens' }));
    return { ...view, props };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('HomeTabs token filter empty state', () => {
    it('offers a Clear filter action that empties the query', () => {
        const onTokenQueryChange = vi.fn();
        mount({ tokenQuery: 'LTC', onTokenQueryChange });

        expect(screen.getByText('No matching tokens')).toBeInTheDocument();
        expect(screen.getByText('Nothing matches "LTC". Clear the filter to see all tokens.')).toBeInTheDocument();
        expect(screen.queryByText(/top toolbar/)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
        expect(onTokenQueryChange).toHaveBeenCalledWith('');
    });

    it('opens the filter row when it mounts with a live query', () => {
        mount({ tokenQuery: 'LTC' });
        expect(screen.getByRole('searchbox', { name: 'Search tokens by name' })).toHaveValue('LTC');
    });

    it('keeps the filter row collapsed and shows no Clear action without a query', () => {
        mount();
        expect(screen.queryByRole('searchbox', { name: 'Search tokens by name' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull();
    });
});
