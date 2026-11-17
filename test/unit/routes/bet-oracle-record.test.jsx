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
import { render, act as domAct, fireEvent, within } from '@testing-library/react';
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

// Only the chosen tab renders (Actions, Markets, Details), so a test opens
// the tab that holds the line it reads.
async function openTab(utils, name) {
    await domAct(async () => {
        Array.from(utils.container.querySelectorAll('[role="tab"]'))
            .find((tab) => (tab.textContent || '').trim() === name)
            .click();
        await drain();
    });
    return text(utils);
}

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

        const details = await openTab(utils, 'Details');
        expect(details).toMatch(/Markets opened/);
        expect(details).toMatch(/Still running/);
        expect(details).toMatch(/Settled with a result/);
        // The screening signal: an oracle that walked away from a market. It must be
        // a line of its own, not folded into a total.
        expect(details).toMatch(/Left to expire with no result/);
    });

    it('shows fees earned per wager token', async () => {
        const { messaging } = harness();
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        const body = await openTab(utils, 'Details');
        expect(body).toMatch(/PEPECREATURE/);
        expect(body).toMatch(/0\.175/);
        expect(body).toMatch(/XCHAIN/);
        expect(body).toMatch(/12/);
    });

    it('says plainly that an oracle earns nothing from a market it never settles', async () => {
        const { messaging } = harness();
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        expect(await openTab(utils, 'Details')).toMatch(/earns nothing from a market it cancels, voids, or lets expire/i);
    });

    it('renders the unbonded / per-address caveat as part of the page', async () => {
        const { messaging } = harness();
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        const body = await openTab(utils, 'Details');
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
        expect(await openTab(utils, 'Details')).toMatch(/No settlement fees yet/i);
    });

    it('survives an explorer too old to report fees at all', async () => {
        const { messaging } = harness({
            betOracle: () => Promise.resolve({ data: [{ address: ORACLE, total_feeds: 1, active_feeds: 1, counts: { open: 1 } }] }),
        });
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        // The record still renders; the missing field degrades to "no fees", never
        // to a crash on a non-array.
        const about = await openTab(utils, 'Details');
        expect(about).toMatch(/Markets opened/);
        expect(about).toMatch(/No settlement fees yet/i);
    });

    it('keeps the record and does not claim there are no markets when the listing fails', async () => {
        const { messaging } = harness({
            betFeeds: () => Promise.reject(new Error('explorer down')),
        });
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        // Actions opens first (G102); the market listing is on Markets.
        const body = await openTab(utils, 'Markets');
        expect(await openTab(utils, 'Details')).toMatch(/Markets opened/);
        expect(body).toMatch(/Could not load this address's markets/i);
        expect(body).not.toMatch(/No markets from this address/i);
        expect(body).not.toMatch(/explorer down/);
    });

    it('reports a failed record read instead of hanging on the loader', async () => {
        const { messaging } = harness({
            betOracle: () => Promise.reject(new Error('oracleStats: sdk.getOracleStats is unavailable')),
        });
        const utils = await mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE });
        const alert = utils.getByRole('alert').textContent;
        expect(alert).toMatch(/Failed to load the oracle record/);
        expect(alert).not.toMatch(/oracleStats|sdk\.getOracleStats/);
    });

    it('opens one of the oracle\'s markets on the chain the record was read from', async () => {
        const { messaging } = harness();
        const opened = [];
        const utils = await mount(OracleRecord, messaging, {
            chainId: CHAIN, address: ORACLE, onOpenMarket: (c, i) => opened.push([c, i]),
        });
        await openTab(utils, 'Markets');
        const row = utils.getByRole('button', { name: /Who wins the final\?/ });
        await domAct(async () => { fireEvent.click(row); await drain(); });
        expect(opened).toEqual([[CHAIN, '2308']]);
    });
});

// The operator's layout 3 ruling (2026-11-14): a white identity card with no
// chart (G16), then Actions, Markets and Details. Markets is every loaded
// market in one list with a status pill each (no Disputed state: betting
// markets have no dispute process), and the header's filter icon searches
// and filters that list by status, on the Markets tab only.
describe('OracleRecord layout: identity card, three tabs, one market list', () => {
    const NOW = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    const ALL_STATES = Object.freeze([
        { action_index: '6', label: 'Expired vote', tick: 'XCHAIN', feed_status: 'expired', deadline: NOW - 9 * DAY },
        { action_index: '1', label: 'Winter Cup final', tick: 'XCHAIN', feed_status: 'open', deadline: NOW + DAY },
        { action_index: '3', label: 'Autumn Derby', tick: 'XCHAIN', feed_status: 'resolved', deadline: NOW - 5 * DAY },
        { action_index: '2', label: 'Bitcoin above 100k', tick: 'XCHAIN', feed_status: 'closed', deadline: NOW - DAY },
        { action_index: '5', label: 'Cancelled race', tick: 'XCHAIN', feed_status: 'cancelled', deadline: NOW - 7 * DAY },
        { action_index: '4', label: 'Void match', tick: 'XCHAIN', feed_status: 'resolved_void', deadline: NOW - 6 * DAY },
    ]);
    const RECORD6 = { ...RECORD, total_feeds: 6 };

    const mountAll = (markets = ALL_STATES) => {
        const { messaging, calls } = harness({
            betOracle: (args) => { calls.push({ method: 'betOracle', args }); return Promise.resolve({ data: [RECORD6] }); },
            betFeeds: (args) => { calls.push({ method: 'betFeeds', args }); return Promise.resolve({ data: markets.slice() }); },
        });
        return mount(OracleRecord, messaging, { chainId: CHAIN, address: ORACLE, onOpenMarket() {} })
            .then((utils) => ({ utils, calls }));
    };
    const marketList = (utils) => utils.getByRole('list', { name: 'Oracle markets' });
    const pills = (utils) => Array.from(marketList(utils).querySelectorAll('[data-market-status]'))
        .map((pill) => pill.textContent);

    it('has exactly three tabs, Actions, Markets and Details, with Actions chosen', async () => {
        const { utils } = await mountAll();
        const tablist = utils.getByRole('tablist', { name: 'Oracle sections' });
        const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
        expect(tabs.map((tab) => (tab.textContent || '').trim())).toEqual(['Actions', 'Markets', 'Details']);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        expect(text(utils)).not.toMatch(/Resolutions|Disputes|About/);
    });

    it('opens with the white identity card and no chart', async () => {
        const { utils } = await mountAll();
        const card = utils.container.querySelector('[data-oracle-identity]');
        expect(card).not.toBeNull();
        expect(card.textContent).toMatch(/Betting oracle on Bitcoin/);
        expect(card.textContent).toMatch(/6 markets/);
        // The chart, its range chips and the resolved-count figure are gone.
        expect(utils.container.querySelector('svg[role="img"]')).toBeNull();
        expect(utils.container.querySelector('[data-chart-behind]')).toBeNull();
        expect(utils.queryByRole('tab', { name: '6M' })).toBeNull();
        expect(text(utils)).not.toMatch(/markets? resolved/);
    });

    it('lists every market in one list with a status pill each, and no Disputed state', async () => {
        const { utils } = await mountAll();
        await openTab(utils, 'Markets');
        expect(within(marketList(utils)).getAllByRole('listitem')).toHaveLength(6);
        // Open, then Resolving, then Resolved (newest first), then Refunded
        // (cancelled and expired, newest first).
        expect(pills(utils)).toEqual(['Open', 'Resolving', 'Resolved', 'Resolved', 'Refunded', 'Refunded']);
        const titles = Array.from(marketList(utils).querySelectorAll('li')).map((li) => li.textContent);
        expect(titles[0]).toMatch(/Winter Cup final/);
        expect(titles[2]).toMatch(/Autumn Derby/);
        expect(titles[4]).toMatch(/Cancelled race/);
        expect(text(utils)).not.toMatch(/Disputed/);
    });

    it('shows the header filter on Markets only, and it searches and filters by status', async () => {
        const { utils } = await mountAll();
        // Actions and Details have nothing for the filter to narrow.
        expect(utils.queryByRole('button', { name: 'Filter markets' })).toBeNull();
        await openTab(utils, 'Details');
        expect(utils.queryByRole('button', { name: 'Filter markets' })).toBeNull();
        await openTab(utils, 'Markets');
        const filter = utils.getByRole('button', { name: 'Filter markets' });
        // It sits in the page header's toolbar, not in the panel.
        expect(utils.container.querySelector('[role="tabpanel"]').contains(filter)).toBe(false);

        await domAct(async () => { fireEvent.click(filter); await drain(); });
        const panel = utils.getByRole('dialog', { name: 'Filter markets' });
        expect(within(panel).getByRole('searchbox', { name: 'Search markets' })).toBeTruthy();
        // The Status dropdown is the themed one with an option per state.
        const status = within(panel).getByRole('combobox', { name: 'Status' });
        expect(status.textContent).toMatch(/All statuses \(6\)/);
        await domAct(async () => { fireEvent.click(status); await drain(); });
        expect(utils.getAllByRole('option').map((o) => (o.textContent || '').trim()))
            .toEqual(['All statuses (6)', 'Open (1)', 'Resolving (1)', 'Resolved (2)', 'Refunded (2)']);
        expect(utils.container.querySelector('input[type="radio"]')).toBeNull();
        await domAct(async () => { fireEvent.click(utils.getByRole('option', { name: 'Refunded (2)' })); await drain(); });
        expect(pills(utils)).toEqual(['Refunded', 'Refunded']);

        await domAct(async () => {
            fireEvent.change(utils.getByRole('searchbox', { name: 'Search markets' }), { target: { value: 'expired' } });
            await drain();
        });
        expect(within(marketList(utils)).getAllByRole('listitem')).toHaveLength(1);
        expect(marketList(utils).textContent).toMatch(/Expired vote/);

        await domAct(async () => {
            fireEvent.change(utils.getByRole('searchbox', { name: 'Search markets' }), { target: { value: 'no such market' } });
            await drain();
        });
        expect(utils.queryByRole('list', { name: 'Oracle markets' })).toBeNull();
        expect(text(utils)).toMatch(/No matching markets/);
    });

    it('reads the same four times whatever the number of markets, never per row', async () => {
        const many = Array.from({ length: 40 }, (_, i) => ({
            action_index: String(9000 + i), label: `Market ${i}`, tick: 'XCHAIN',
            feed_status: ['open', 'closed', 'resolved', 'expired'][i % 4], deadline: NOW - i * DAY,
        }));
        const counted = async (markets) => {
            const { utils, calls } = await mountAll(markets);
            await openTab(utils, 'Markets');
            await openTab(utils, 'Details');
            await openTab(utils, 'Markets');
            const reads = calls.map((c) => c.method).filter((m) => m !== 'getSettings');
            utils.unmount();
            return reads;
        };
        const few = await counted(ALL_STATES.slice(0, 2));
        const lots = await counted(many);
        expect(lots).toEqual(few);
        expect(few.filter((m) => m === 'betFeeds')).toHaveLength(1);
        expect(few.filter((m) => m === 'betOracle')).toHaveLength(1);
        expect(few).not.toContain('betFeed');
    });
});

describe('BetFeedDetail reaches the oracle record (the prop that had no caller)', () => {

    it('turns the oracle address into an action button that hands back chain + address', async () => {
        const { messaging } = harness();
        const seen = [];
        const utils = await mount(BetFeedDetail, messaging, {
            walletId: 'w', chainId: CHAIN, feedIndex: '2308',
            onOpenOracle: (c, a) => seen.push([c, a]),
        });
        // The oracle's full address is a fact on the Details tab.
        await domAct(async () => { fireEvent.click(utils.getByRole('tab', { name: 'Details' })); await drain(); });
        const button = utils.getByRole('button', { name: ORACLE });
        await domAct(async () => { fireEvent.click(button); await drain(); });
        expect(seen).toEqual([[CHAIN, ORACLE]]);
    });

    it('still renders the oracle address when no handler is wired', async () => {
        const { messaging } = harness();
        const utils = await mount(BetFeedDetail, messaging, {
            walletId: 'w', chainId: CHAIN, feedIndex: '2308',
        });
        await domAct(async () => { fireEvent.click(utils.getByRole('tab', { name: 'Details' })); await drain(); });
        expect(text(utils)).toMatch(new RegExp(ORACLE));
        expect(utils.queryByRole('link', { name: ORACLE })).toBeNull();
        expect(utils.queryByRole('button', { name: ORACLE })).toBeNull();
    });
});
