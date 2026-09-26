// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// "My dispensers" quoted an oracle-priced (Mode B) dispenser as
// "1 MGRTEST per 0 DOGE". GET_AMOUNT is 0 by protocol convention for a
// fiat-priced dispenser and the row prints it verbatim. This list lane's
// row carries ORACLE_ADDRESS but not FIAT_CODE (unlike the detail page's
// row), so the fix reads the oracle's own published feeds and matches one
// by GIVE_TICK instead of fabricating a currency.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispensersList } from '../../../packages/core/src/shared/routes/DispensersList.jsx';

const CHAIN = 'dogecoin-mainnet';
const OWNER = 'D7ownerownerownerownerownerownerowner0001';
const ORACLE_ADDRESS = 'ndDEAAsomeoracleaddresssomeoracleaddress01';

/** A Mode B dispenser, shaped as the list lane serves one: no FIAT_CODE. */
const ORACLE_ROW = {
    action_index: '2868', block_index: 500, source: OWNER,
    give_tick: 'MGRTEST', give_amount: '1',
    get_coin: 'DOGE', get_amount: '0',
    oracle_address: ORACLE_ADDRESS,
    status: 'valid', current_status: 'open', escrow_remaining: '48',
};

/** The ordinary coin-priced control row: a real GET_AMOUNT, no oracle. */
const COIN_ROW = {
    action_index: '40', block_index: 200, source: OWNER,
    give_tick: 'JAVIERTEST', give_amount: '2',
    get_coin: 'DOGE', get_amount: '100',
    status: 'valid', current_status: 'open', escrow_remaining: '48',
};

const ORACLE_FEEDS = [{
    key: 'DOGE/MGRTEST/USD',
    coin: 'DOGE',
    tick: 'MGRTEST',
    fiat: 'USD',
    live: { value: '0.05', fee: '0.01' },
    pending: null,
    history: [],
}];

function mount(rows, extraMessaging = {}) {
    const messaging = {
        ...extraMessaging,
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'a1', address: OWNER, source: 'hd' }],
        }),
        getDispensersForSource: vi.fn().mockResolvedValue({ data: rows }),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispensersList, {
                walletId: 'w',
                onOpenDispenser() {},
                onBack() {},
            }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

describe('oracle-priced dispenser, "My dispensers" list', () => {
    it('never quotes a coin price of zero for a Mode B row', async () => {
        mount([ORACLE_ROW], { oracleFeeds: vi.fn().mockResolvedValue(ORACLE_FEEDS) });
        await screen.findByText(/0\.05 USD/);
        const text = document.body.textContent || '';
        expect(/\bper 0(\.0+)?\s*DOGE\b/i.test(text),
            `the list quotes zero coin for an oracle-priced dispenser: ${text.slice(0, 400)}`)
            .toBe(false);
    });

    it('states the fiat price and the oracle, once the feed is read', async () => {
        mount([ORACLE_ROW], { oracleFeeds: vi.fn().mockResolvedValue(ORACLE_FEEDS) });
        expect(await screen.findByText(/1 MGRTEST per 0\.05 USD \(oracle ndDEAA.*\)/)).toBeInTheDocument();
    });

    it('asks the oracle named on the row, on the row\'s own chain', async () => {
        const messaging = mount([ORACLE_ROW], { oracleFeeds: vi.fn().mockResolvedValue(ORACLE_FEEDS) });
        await screen.findByText(/0\.05 USD/);
        expect(messaging.oracleFeeds).toHaveBeenCalledWith({ chainId: CHAIN, address: ORACLE_ADDRESS });
    });

    it('says plainly when the oracle publishes no current price', async () => {
        mount([ORACLE_ROW], {
            oracleFeeds: vi.fn().mockResolvedValue([{ ...ORACLE_FEEDS[0], live: null }]),
        });
        expect(await screen.findByText(/no current price, stale/)).toBeInTheDocument();
    });

    it('shows the explorer stale-price state instead of advertising a rate', async () => {
        mount([{ ...ORACLE_ROW, price_stale: true }], {
            oracleFeeds: vi.fn().mockResolvedValue(ORACLE_FEEDS),
        });
        expect(await screen.findByText('Not selling right now: no price in the last 24 hours'))
            .toBeInTheDocument();
        expect(screen.queryByText(/1 MGRTEST per 0\.05 USD/)).toBeNull();
    });

    it('does not fabricate a price when the wallet cannot read oracle feeds at all', async () => {
        // No `oracleFeeds` on messaging: an older host or one built without the
        // capability. Silence would read as "free"; the fix must say something
        // true instead, never a bare zero.
        mount([ORACLE_ROW]);
        await screen.findByText(/open the dispenser for the price/);
        const text = document.body.textContent || '';
        expect(/\bper 0(\.0+)?\s*DOGE\b/i.test(text)).toBe(false);
    });

    it('still shows an exact coin rate for an ordinary coin-priced dispenser', async () => {
        mount([COIN_ROW]);
        expect(await screen.findByText(/2 JAVIERTEST per 100 DOGE/)).toBeInTheDocument();
    });
});
