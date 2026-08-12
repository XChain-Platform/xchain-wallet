// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// P8: the oracle track record, and the link that reaches it.
//
// The wallet shipped every other betting surface with the `bet.oracle` host route
// registered, the flow written, and BetFeedDetail carrying an `onOpenOracle` prop
// that nothing ever passed. So the one question a bettor most needs answered
// before staking money - who is deciding this, and what have they done before -
// had a complete data path and no way to ask it.
//
// Three properties are worth driving rather than reading:
//
//   1. The caveat is part of the page, not documentation about the page. This
//      record is unbonded and per-address, so a clean sheet means unknown rather
//      than safe (spec §5). A reputation display without that sentence actively
//      misleads, which is worse than not shipping one.
//   2. `expired` is reported on its own. An oracle that lets markets run out has
//      refunded everyone and decided nothing, and averaging that into a success
//      rate would hide exactly the behaviour a bettor is screening for.
//   3. The market listing is allowed to fail on its own. It is a second host
//      call, and a failed listing must not blank the record that IS the page.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleRecord } from '../../../packages/core/src/shared/routes/OracleRecord.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ORACLE = 'bc1qoracleoracleoracleoracleoracleoraclex';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';

const RECORD = Object.freeze({
    address: ORACLE,
    total_feeds: 9,
    active_feeds: 2,
    counts: { open: 1, closed: 1, resolved: 5, resolved_void: 1, cancelled: 0, expired: 1 },
    fees_earned: [
        { tick: 'PEPECREATURE', resolves: 4, amount: '0.175' },
        { tick: 'XCHAIN', resolves: 1, amount: '12' },
    ],
    reputation_caveat: 'Per-address record with no bonding; addresses are free to create, so an empty history means unknown, not safe.',
});

const MARKETS = Object.freeze([
    { action_index: '2308', label: 'Who wins the final?', tick: 'PEPECREATURE', feed_status: 'open' },
    { action_index: '2211', label: 'Rain tomorrow?', tick: 'XCHAIN', feed_status: 'resolved' },
]);

const FEED = Object.freeze({
    action_index: '2308',
    source: ORACLE,
    label: 'Who wins the final?',
    outcomes: 'Home,Away',
    tick: 'PEPECREATURE',
    fee: '1.00',
    deadline: Math.floor(Date.now() / 1000) + 86400,
    expire_at: Math.floor(Date.now() / 1000) + 86400 + 1209600,
    feed_status: 'open',
    pools: [{ outcome: 0, pool: '10.00000000', bet_count: 1 }],
    timeline: [{ status: 'open', block_index: 4217 }],
});

beforeEach(() => { vi.useRealTimers(); });

function harness(overrides = {}) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [{ id: 'a0', address: OWN, source: 'hd' }] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        betOracle: (args) => { calls.push({ method: 'betOracle', args }); return Promise.resolve({ data: [RECORD] }); },
        betFeeds: (args) => { calls.push({ method: 'betFeeds', args }); return Promise.resolve({ data: MARKETS.slice() }); },
        betFeed: (args) => { calls.push({ method: 'betFeed', args }); return Promise.resolve({ data: [FEED] }); },
        // The SDK returns a projection OBJECT, not a bare amount. Mocked at the
        // real shape so nothing here quietly re-asserts the mismatch.
        betProjectPayout: () => Promise.resolve({
            payout: '13.86000000', profit: '3.86000000', impliedOdds: '1.38600000',
            total: '14.00000000', winningPool: '5.00000000', fee: '0.14000000',
        }),
    };
    Object.assign(target, overrides);
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return (args) => { calls.push({ method: String(prop), args }); return Promise.resolve({}); };
        },
    });
    return { messaging, calls };
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mount(Component, messaging, props = {}) {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(Component, { onBack() {}, ...props }),
            ),
        );
        await drain();
    });
    return utils;
}

const text = (utils) => utils.container.textContent || '';

describe('OracleRecord (P8)', () => {

    it('asks the host for THIS address on THIS chain, and lists only its markets', async () => {
        const { messaging, calls } = harness();
        await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });

        const rec = calls.find((c) => c.method === 'betOracle');
        expect(rec.args).toMatchObject({ chainId: CHAIN, address: ORACLE });

        // `source` is the filter that means "markets this address RUNS". Filtering on
        // `address` instead would fold in markets it merely bet on, which is a
        // different address's track record.
        const feeds = calls.find((c) => c.method === 'betFeeds');
        expect(feeds.args).toMatchObject({ chainId: CHAIN, query: ORACLE, type: 'source' });
    });

    it('reports the counts, and gives expired-unresolved its own line', async () => {
        const { messaging } = harness();
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        const body = text(utils);

        expect(body).toMatch(/Markets opened/);
        expect(body).toMatch(/Still running/);
        expect(body).toMatch(/Settled with a result/);
        // The screening signal: an oracle that walked away from a market. It must be
        // a line of its own, not folded into a total.
        expect(body).toMatch(/Left to expire with no result/);
    });

    it('shows fees earned per wager token', async () => {
        const { messaging } = harness();
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        const body = text(utils);
        expect(body).toMatch(/PEPECREATURE/);
        expect(body).toMatch(/0\.175/);
        expect(body).toMatch(/XCHAIN/);
        expect(body).toMatch(/12/);
    });

    it('says plainly that an oracle earns nothing from a market it never settles', async () => {
        const { messaging } = harness();
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        expect(text(utils)).toMatch(/earns nothing from a market it cancels, voids, or lets expire/i);
    });

    it('renders the unbonded / per-address caveat as part of the page', async () => {
        const { messaging } = harness();
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        const body = text(utils);
        // Spec §5: without these two sentences the page reads as a safety rating,
        // which is the one thing it is not.
        expect(body).toMatch(/not a guarantee/i);
        expect(body).toMatch(/anyone can start again from a new one/i);
        expect(body).toMatch(/unknown/i);
    });

    it('does not present a never-paid oracle as a blank', async () => {
        const { messaging } = harness({
            betOracle: () => Promise.resolve({ data: [{ ...RECORD, fees_earned: [] }] }),
        });
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        expect(text(utils)).toMatch(/never been paid a fee/i);
    });

    it('survives an explorer too old to report fees at all', async () => {
        const { messaging } = harness({
            betOracle: () => Promise.resolve({ data: [{ address: ORACLE, total_feeds: 1, active_feeds: 1, counts: { open: 1 } }] }),
        });
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        // The record still renders; the missing field degrades to "no fees", never
        // to a crash on a non-array.
        expect(text(utils)).toMatch(/Markets opened/);
        expect(text(utils)).toMatch(/never been paid a fee/i);
    });

    it('keeps the record on screen when the market listing fails', async () => {
        const { messaging } = harness({
            betFeeds: () => Promise.reject(new Error('explorer down')),
        });
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        const body = text(utils);
        expect(body).toMatch(/Markets opened/);
        expect(body).toMatch(/No markets from this address/i);
        expect(body).not.toMatch(/explorer down/);
    });

    it('reports a failed record read instead of hanging on the loader', async () => {
        const { messaging } = harness({
            betOracle: () => Promise.reject(new Error('explorer down')),
        });
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        expect(utils.container.querySelector('[role="alert"]').textContent).toMatch(/explorer down/);
    });

    it('opens one of the oracle\'s markets on the chain the record was read from', async () => {
        const { messaging } = harness();
        const opened = [];
        const utils = await mount(OracleRecord, messaging, {
            chainId: CHAIN, address: ORACLE, onOpenMarket: (c, i) => opened.push([c, i]),
        });
        const row = Array.from(utils.container.querySelectorAll('button'))
            .find((b) => /Who wins the final\?/.test(b.textContent || ''));
        await domAct(async () => { fireEvent.click(row); await drain(); });
        expect(opened).toEqual([[CHAIN, '2308']]);
    });
});

describe('BetFeedDetail reaches the oracle record (the prop that had no caller)', () => {

    it('turns the oracle address into a link that hands back chain + address', async () => {
        const { messaging } = harness();
        const seen = [];
        const utils = await mount(BetFeedDetail, messaging, {
            walletId: 'w', chainId: CHAIN, feedIndex: '2308',
            onOpenOracle: (c, a) => seen.push([c, a]),
        });
        const link = Array.from(utils.container.querySelectorAll('a'))
            .find((a) => (a.textContent || '').includes(ORACLE));
        expect(link, 'the market page shows no link to the oracle').toBeTruthy();
        await domAct(async () => { fireEvent.click(link); await drain(); });
        expect(seen).toEqual([[CHAIN, ORACLE]]);
    });

    it('still renders the oracle address when no handler is wired', async () => {
        const { messaging } = harness();
        const utils = await mount(BetFeedDetail, messaging, {
            walletId: 'w', chainId: CHAIN, feedIndex: '2308',
        });
        expect(text(utils)).toMatch(new RegExp(ORACLE));
        expect(utils.container.querySelector(`a[href="#"]`)).toBeNull();
    });
});
