// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The token page's Dispensers panel read field names the explorer does not
// send (give_quantity, get_quantity, mainchainrate, give_remaining,
// escrow_quantity), so every real listing collapsed to "Open dispenser" with
// no terms or stock. Rows here are shaped as the explorer's token lane serves them.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';

afterEach(() => cleanup());

const CHAIN = 'bitcoin-regtest';
const MINE = 'bcrt1qmineminemineminemineminemineminemine0';
const ORACLE = 'bcrt1qoracleoracleoracleoracleoracleoracle';

const base = {
    source: MINE, address: null, status: 'valid', current_status: 'open',
    give_tick: 'S18PROBE', get_tick: null, get_coin: 'BTC',
};
const FIXED = { ...base, action_index: '10', give_amount: '5', get_amount: '0.01', escrow_remaining: '48' };
const MODE_B = { ...base, action_index: '11', give_amount: '2', get_amount: '0', oracle_address: ORACLE, escrow_remaining: '8' };
const CLOSED = { ...base, action_index: '12', give_amount: '7', get_amount: '0.03', current_status: 'cancelled', escrow_remaining: '0' };
const BUYS_IT = { ...base, action_index: '13', give_tick: 'OTHER', get_tick: 'S18PROBE', get_coin: null, give_amount: '9', get_amount: '4' };

function renderPanel(extra = {}) {
    const messaging = {
        getTokenInfo: async () => ({}),
        getHoldersForToken: async () => ({ data: [] }),
        getWalletBalances: async () => ({}),
        getHistoryForToken: async () => ({ data: [] }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: MINE }] }),
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [FIXED, MODE_B, CLOSED, BUYS_IT] }),
        oracleFeeds: vi.fn().mockResolvedValue([{ tick: 'S18PROBE', fiat: 'USD', live: { value: '1.5' } }]),
        ...extra,
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(ManageToken, { walletId: 'w1', chainId: CHAIN, tick: 'S18PROBE', onBack() {} }),
    ));
    return messaging;
}

describe('ManageToken Dispensers panel on explorer-shaped rows', () => {
    it('states a fixed-price listing\'s terms and stock', async () => {
        renderPanel();
        expect(await screen.findByText(/5 S18PROBE per 0\.01 BTC · 48 S18PROBE left/)).toBeInTheDocument();
    });

    it('prices a Mode B listing from its oracle, never as zero coin', async () => {
        renderPanel();
        expect(await screen.findByText(/2 S18PROBE per 3 USD \(oracle .*\) · 8 S18PROBE left/)).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/per 0 BTC/);
    });

    it('lists neither a closed dispenser nor one that buys this token', async () => {
        renderPanel();
        await screen.findByText(/5 S18PROBE per 0\.01 BTC/);
        expect(screen.queryByText(/7 S18PROBE/)).toBeNull();
        expect(screen.queryByText(/9 OTHER/)).toBeNull();
        expect(screen.queryByText(/^Open dispenser$/)).toBeNull();
    });
});
