// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The detail page's stats-hero "Payment" line, separate from the buyer-facing
// "Pay to buy" panel, printed GET_AMOUNT verbatim, so a fiat-priced
// dispenser's own summary row read "PAYMENT 0 DOGE (native coin)". These
// tests drive only that line.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'dogecoin-mainnet';
const OWNER = 'D7ownerownerownerownerownerownerowner0001';
const ORACLE_ADDRESS = 'ndDEAAsomeoracleaddresssomeoracleaddress01';

const ORACLE_DISPENSER = {
    action_index: '2868',
    source: OWNER,
    address: OWNER,
    give_tick: 'MGRTEST',
    give_amount: '1',
    get_tick: null,
    get_coin: 'DOGE',
    get_amount: '0',
    fiat_code: 'USD',
    fiat_amount: null,
    oracle_address: ORACLE_ADDRESS,
    escrow_remaining: '100',
    status: 'open',
    current_status: 'open',
};

const ORACLE_FEEDS = [{
    key: 'DOGE/MGRTEST/USD', coin: 'DOGE', tick: 'MGRTEST', fiat: 'USD',
    live: { value: '0.05', fee: '0.01' }, pending: null, history: [],
}];

function mount(dispenser, extraMessaging = {}) {
    const messaging = {
        ...extraMessaging,
        getDispenserByActionIndex: vi.fn().mockResolvedValue(dispenser),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserDetail, {
                walletId: 'w',
                chainId: CHAIN,
                actionIndex: dispenser.action_index,
                onBack() {},
                onCanceled() {},
            }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

// The stats-hero Payment value only: the Pay to buy panel states the same
// fill price, so a page-wide match cannot tell which of the two printed it.
async function paymentLine(expected) {
    const dt = await screen.findByText('Payment', { selector: 'dt' });
    const dd = dt.nextElementSibling;
    await waitFor(() => expect(dd.textContent).toMatch(expected));
    return dd.textContent;
}

describe('DispenserDetail stats-hero Payment line', () => {
    it('never states a coin price of zero for a Mode B dispenser', async () => {
        mount(ORACLE_DISPENSER, { oracleFeeds: vi.fn().mockResolvedValue(ORACLE_FEEDS) });
        const text = await paymentLine(/0\.05 USD/);
        expect(text).not.toMatch(/\b0(\.0+)?\s*DOGE\b/i);
    });

    it('states the oracle fill price and the oracle address', async () => {
        mount(ORACLE_DISPENSER, { oracleFeeds: vi.fn().mockResolvedValue(ORACLE_FEEDS) });
        await paymentLine(new RegExp(`0\\.05 USD \\(oracle ${ORACLE_ADDRESS}\\)`));
    });

    it('says plainly when the oracle has no current price (stale)', async () => {
        mount(ORACLE_DISPENSER, {
            oracleFeeds: vi.fn().mockResolvedValue([{ ...ORACLE_FEEDS[0], live: null }]),
        });
        await paymentLine(/USD via oracle .*: no current price \(stale\)/);
    });

    it('still states an exact coin figure for an ordinary coin-priced dispenser', async () => {
        mount({ ...ORACLE_DISPENSER, get_amount: '100', fiat_code: null, oracle_address: null });
        await paymentLine(/100 DOGE \(native coin\)/);
    });
});
