// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet never fabricates a number: TokenDetail draws a synthesized
// price line only for the demo wallet. A real wallet with no real history
// gets a plain message in the chart's place and no range tabs.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/flows/demoMode.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isDemoWallet: (id) => id === 'demo-wallet' };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

afterEach(() => { cleanup(); __clearTokenInfoCache(); });

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

const CHAIN = 'bitcoin-regtest';

function renderDetail(walletId) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qx', marketPrice: '0.5', totalSupply: '1000' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenDetail, {
            walletId, chainId: CHAIN, tick: 'PRICEPROBE', kind: 'token', quantity: '10', onBack() {},
        }),
    ));
}

describe('TokenDetail price history', () => {
    it('shows a message and no synthesized line for a real wallet', async () => {
        renderDetail('real-wallet');
        expect(await screen.findByText('No price history yet')).toBeTruthy();
        expect(screen.queryByRole('img', { name: 'Price trend' })).toBeNull();
        expect(screen.queryByRole('tablist', { name: 'Chart range' })).toBeNull();
    });

    it('still draws a synthesized chart for the demo wallet', async () => {
        renderDetail('demo-wallet');
        const chart = await screen.findByRole('img', { name: 'Price trend' });
        expect(chart.querySelector('polyline').getAttribute('points').length).toBeGreaterThan(10);
        expect(screen.queryByText('No price history yet')).toBeNull();
    });
});
