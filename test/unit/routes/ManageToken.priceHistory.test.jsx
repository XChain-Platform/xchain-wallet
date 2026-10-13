// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ManageToken draws a synthesized price line only for the demo wallet; a
// real wallet gets "No price history yet" and no range tabs, because the
// wallet never fabricates a number.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/flows/demoMode.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isDemoWallet: (id) => id === 'demo-wallet' };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

afterEach(() => { cleanup(); __clearTokenInfoCache(); });

const CHAIN = 'bitcoin-regtest';

function renderManage(walletId) {
    const messaging = {
        getTokenInfo: async () => ({ marketPrice: '0.5', totalSupply: '1000' }),
        getHoldersForToken: async () => ({ data: [] }),
        getWalletBalances: async () => ({}),
        getHistoryForToken: async () => ({ data: [] }),
        getAddressesByChain: async () => ({ [CHAIN]: [] }),
        getDispensersForToken: async () => ({ data: [] }),
        getOrdersForToken: async () => ({ data: [] }),
        getSwapsForToken: async () => ({ data: [] }),
        oracleFeeds: async () => [],
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(ManageToken, { walletId, chainId: CHAIN, tick: 'PRICEPROBE', onBack() {} }),
    ));
}

describe('ManageToken price history', () => {
    it('shows a message, no line and no range tabs for a real wallet', async () => {
        renderManage('real-wallet');
        expect(await screen.findByText('No price history yet')).toBeTruthy();
        expect(screen.queryByRole('img', { name: /^Price trend\b/ })).toBeNull();
        expect(screen.queryByRole('tablist', { name: 'Chart range' })).toBeNull();
    });

    it('still draws a synthesized chart with range tabs for the demo wallet', async () => {
        renderManage('demo-wallet');
        expect(await screen.findByRole('img', { name: /^Price trend\b/ })).toBeTruthy();
        expect(screen.getByRole('tablist', { name: 'Chart range' })).toBeTruthy();
        const selected = screen.getByRole('tab', { name: '30d' });
        const next = screen.getByRole('tab', { name: '24h' });
        const panel = document.getElementById(selected.getAttribute('aria-controls'));
        expect(selected).toHaveAttribute('tabindex', '0');
        expect(next).toHaveAttribute('tabindex', '-1');
        expect(panel).toHaveAttribute('aria-labelledby', selected.id);

        fireEvent.click(next);

        expect(next).toHaveAttribute('aria-selected', 'true');
        expect(next).toHaveAttribute('tabindex', '0');
        expect(panel).toHaveAttribute('aria-labelledby', next.id);
        expect(screen.queryByText('No price history yet')).toBeNull();
    });
});
