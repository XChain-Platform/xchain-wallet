// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A token read that failed must not read as "No tokens yet": the Balances
// list narrowed to Tokens says the tokens could not be loaded, and a
// genuinely empty read still says there are none.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

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
import { registry as registryLib } from '../../../packages/core/src/index.js';

const chainRegistry = registryLib.defaultRegistry();
const CHAIN = 'bitcoin-mainnet';

const answered = (extra = {}) => ({
    [CHAIN]: [{
        address: 'bc1qa',
        balances: { native: { tick: 'BTC', quantity: '5', divisibility: 8 }, tokens: [], ...extra },
    }],
});

function mount(balances, overrides = {}) {
    globalThis.localStorage.setItem('xc:balances:type:w1', 'tokens');
    render(
        <HomeTabs
            chainRegistry={chainRegistry}
            balances={balances}
            walletId="w1"
            networkFilter="all"
            coinFamilies={[]}
            onNetworkFilterChange={vi.fn()}
            tokenQuery=""
            onTokenQueryChange={vi.fn()}
            onReceive={vi.fn()}
            {...overrides}
        />,
    );
}

afterEach(() => {
    cleanup();
    globalThis.localStorage.removeItem('xc:balances:type:w1');
});

describe('HomeTabs Tokens type when the token read failed', () => {
    it('says the tokens could not be loaded instead of that there are none', () => {
        mount(answered({ unavailable: ['tokens'], unavailableReason: 'balance read failed' }));
        expect(screen.getByText("Tokens couldn't be loaded")).toBeInTheDocument();
        expect(screen.queryByText('No tokens yet')).toBeNull();
    });

    it('still says there are no tokens when the read was healthy and empty', () => {
        mount(answered());
        expect(screen.getByText('No tokens yet')).toBeInTheDocument();
        expect(screen.queryByText("Tokens couldn't be loaded")).toBeNull();
    });

    it('keeps a search miss as a search miss', () => {
        mount(answered({ unavailable: ['tokens'] }), { tokenQuery: 'PEPE' });
        expect(screen.getByText('No matching tokens')).toBeInTheDocument();
    });
});
