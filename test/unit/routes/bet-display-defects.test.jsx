// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Three display defects the session-20 wallet E2E pass found on the
// betting surfaces, pinned at the level a user meets them.
//
//   (a) a market denominated in a 0-decimal token showed its pool as
//       "300.000000000000000000", because the indexer sums in DECIMAL(65,18)
//       and only the pool line lacked the trim every other amount gets;
//   (b) counts read "1 bets" and "about 1 days";
//   (c) three surfaces named the outcome by INDEX while the market itself
//       carries the labels - including both BET confirm screens, whose whole
//       job is letting someone check they are backing the side they meant.
//
// (c) is the one worth a test rather than a read-through: the index is what
// the composed bytes carry and must survive, so the label has to be an
// annotation on top of it, never a replacement for it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { CreateBetFeedForm } from '../../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const ORACLE = 'bc1qoracleoracleoracleoracleoracleoraclex';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: OWN,
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

// The D-101 market: XCHAIN has DECIMALS 0, and the pool is a DECIMAL(65,18)
// sum of exactly one bet.
const ZERO_DECIMAL_FEED = Object.freeze({
    action_index: '1169',
    source: ORACLE,
    label: 'Will it ship?',
    outcomes: 'Yes,No',
    tick: 'XCHAIN',
    fee: '0',
    deadline: Math.floor(Date.now() / 1000) + 86400,
    expire_at: Math.floor(Date.now() / 1000) + 172800,
    feed_status: 'open',
    pools: [{ outcome: 0, pool: '300.000000000000000000', bet_count: 1 }],
    timeline: [{ status: 'open', block_index: 4217 }],
});

// A market this wallet's own address runs, past its deadline and inside the
// refund window: the one state where resolve is legal.
const OWN_CLOSED_FEED = Object.freeze({
    action_index: '2343',
    source: OWN,
    label: 'Rain tomorrow?',
    outcomes: 'Yes,No',
    tick: 'XCHAIN',
    fee: '0',
    deadline: Math.floor(Date.now() / 1000) - 3600,
    expire_at: Math.floor(Date.now() / 1000) + 3600,
    feed_status: 'closed',
});

// What sdk.decoder.describe hands back for a place-bet and for a resolve: the
// outcome is an index, because that is all the composed bytes carry.
const BET_DECODED = Object.freeze({
    summary: 'Bet 300 on outcome 0 of market 1169 on Bitcoin',
    details: [
        { label: 'Market', value: '1169' },
        { label: 'Outcome', value: '0' },
        { label: 'Stake', value: '300' },
    ],
    warnings: ['Bets are final.'],
});
const RESOLVE_DECODED = Object.freeze({
    summary: 'Resolve market 2343 to outcome 0 on Bitcoin',
    details: [
        { label: 'Market', value: '2343' },
        { label: 'Winning outcome', value: '0' },
    ],
    warnings: ['This pays out the market.'],
});

const ONE_DAY_QUOTE = Object.freeze({
    durationSeconds: 86400, days: 1, billableDays: 0, free: true, fee: '0.00000000',
});

beforeEach(() => {
    vi.useRealTimers();
});

function harness(overrides = {}) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [], unverified: [] }),
        composeBetForConfirm: (args) => {
            calls.push({ method: 'composeBetForConfirm', args });
            return Promise.resolve({
                psbt: 'aa00',
                encoding: 'psbt',
                actionString: 'BET|2|x',
                version: 0,
                chainId: CHAIN,
                // The confirm page renders THIS - the host's decode of the
                // composed bytes - never the form state.
                decoded: args?.builder === 'resolveMarketParams' ? RESOLVE_DECODED : BET_DECODED,
            });
        },
        betFeed: (args) => {
            calls.push({ method: 'betFeed', args });
            return Promise.resolve({ data: [ZERO_DECIMAL_FEED] });
        },
        betFeeds: (args) => {
            calls.push({ method: 'betFeeds', args });
            return Promise.resolve({ data: [OWN_CLOSED_FEED] });
        },
        betProjectFeedCreateFee: (args) => {
            calls.push({ method: 'betProjectFeedCreateFee', args });
            return Promise.resolve(ONE_DAY_QUOTE);
        },
        bets: (args) => {
            calls.push({ method: 'bets', args });
            return Promise.resolve({ data: [] });
        },
    };
    Object.assign(target, overrides);
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return (args) => {
                calls.push({ method: String(prop), args });
                return Promise.resolve({});
            };
        },
    });
    return { messaging, calls };
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function mount(Component, messaging, props = {}) {
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Component, { walletId: 'w', onBack() {}, ...props }),
        ),
    );
}

function button(utils, re) {
    return Array.from(utils.container.querySelectorAll('button'))
        .find((b) => re.test(b.textContent || ''));
}

const typeIn = (utils, label, value) => {
    fireEvent.change(utils.getByLabelText(label), { target: { value } });
};

async function openMarket(messaging, feedIndex = '1169') {
    let utils;
    await domAct(async () => {
        utils = mount(BetFeedDetail, messaging, { chainId: CHAIN, feedIndex });
        await drain();
    });
    return utils;
}

// The market page opens on its Bet tab and shows only the chosen tab's
// content; choosing Bet again keeps it there.
async function chooseBetTab(utils) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('tab', { name: 'Bet' }));
        await drain();
    });
}

describe('(a) BetFeedDetail: the pool respects the token, not the sum column', () => {
    it('renders a 0-decimal token\'s pool without the DECIMAL(65,18) tail', async () => {
        const { messaging } = harness();
        const utils = await openMarket(messaging);
        const shown = utils.container.textContent;
        expect(shown).not.toContain('300.000000000000000000');
        // The hero's pool line, and the Yes outcome row with its stake and chance.
        expect(shown).toContain('Pool 300 XCHAIN');
        const yes = utils.getByRole('button', { name: 'Bet on Yes, 100 percent, 300 XCHAIN staked' });
        expect(yes.textContent).toBe('Yes300 XCHAIN staked100%');
    });

    it('does not trim a figure that has significant decimals', async () => {
        const { messaging } = harness({
            betFeed: () => Promise.resolve({
                data: [{ ...ZERO_DECIMAL_FEED, pools: [{ outcome: 0, pool: '0.175000000000000000', bet_count: 2 }] }],
            }),
        });
        const utils = await openMarket(messaging);
        expect(utils.container.textContent).toContain('Pool 0.175 XCHAIN');
        const yes = utils.getByRole('button', { name: 'Bet on Yes, 100 percent, 0.175 XCHAIN staked' });
        expect(yes.textContent).toBe('Yes0.175 XCHAIN staked100%');
    });
});

describe('(b) counts are pluralized', () => {
    it('one bet is "1 bet", two are "2 bets"', async () => {
        const { messaging } = harness();
        const utils = await openMarket(messaging);
        // The hero's standing line: "Pool 300 XCHAIN · 1 bet".
        const stats = () => utils.container.querySelector('[data-bet-hero-stats]').textContent;
        expect(stats()).toContain('· 1 bet');
        expect(utils.container.textContent).not.toContain('1 bets');

        const two = harness({
            betFeed: () => Promise.resolve({
                data: [{ ...ZERO_DECIMAL_FEED, pools: [{ outcome: 0, pool: '300.000000000000000000', bet_count: 2 }] }],
            }),
        });
        const utils2 = await openMarket(two.messaging);
        expect(utils2.container.querySelector('[data-bet-hero-stats]').textContent).toContain('· 2 bets');
    });

    it('a one-day market costs "about 1 day", never "about 1 days"', async () => {
        const { messaging } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(CreateBetFeedForm, messaging, { chainId: CHAIN, presetTick: 'XCHAIN' });
            await drain();
        });
        await domAct(async () => {
            typeIn(utils, 'Question', 'Will it ship?');
            typeIn(utils, 'Outcome 1', 'Yes');
            typeIn(utils, 'Outcome 2', 'No');
            typeIn(utils, 'Closes', '2027-06-01T12:00');
            await drain();
        });
        const shown = utils.container.textContent;
        expect(shown).toContain('about 1 day,');
        expect(shown).toContain('the first 1 day of any market');
        expect(shown).not.toContain('1 days');
    });
});

describe('(c) the confirm screens name the outcome the market names', () => {
    it('BetFeedDetail: the place-bet intent reads the label AND keeps the index', async () => {
        const { messaging } = harness();
        const utils = await openMarket(messaging);
        await chooseBetTab(utils);
        // Tapping Yes opens the Place Bet step, where the stake is.
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: /^Bet on Yes,/ }));
            await drain();
        });
        await domAct(async () => {
            typeIn(utils, 'Stake (XCHAIN)', '300');
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /Place bet/i));
            await drain();
        });

        // The confirm page's sentence and facts (G127) carry the decoded intent.
        const intent = utils.getByTestId('confirm-modal').textContent;
        expect(intent).toContain('"Yes" (outcome 0)');
        // The index is what the bytes carry: it must still be on the screen.
        expect(intent).toContain('outcome 0');
        expect(intent).toContain('market 1169');
    });

    it('OracleConsole: the resolve intent names the side about to be paid', async () => {
        const { messaging } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(OracleConsole, messaging, {});
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /^Resolve/));
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /^Yes$/));
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /Publish Result/));
            await drain();
        });

        const intent = utils.getByTestId('confirm-modal').textContent;
        expect(intent).toContain('"Yes" (outcome 0)');
        expect(intent).toContain('market 2343');
    });

    it('a market carrying no labels still renders, with nothing to bet on', async () => {
        // The annotation is best-effort by construction: no labels means the
        // screen falls back to what it showed before, never to a crash.
        const { messaging } = harness({
            betFeed: () => Promise.resolve({ data: [{ ...ZERO_DECIMAL_FEED, outcomes: '' }] }),
        });
        const utils = await openMarket(messaging);
        // The Bet tab offers nothing to back.
        await chooseBetTab(utils);
        expect(utils.queryByRole('list', { name: 'Outcome to back' })).toBeNull();
        expect(utils.getByRole('heading', { level: 2, name: 'Will it ship?' })).toBeTruthy();
        // No outcome rows and no Bet button: the tab says why instead.
        expect(utils.queryByRole('button', { name: 'Bet' })).toBeNull();
        expect(utils.getByText('This market lists no outcomes, so there is nothing to bet on.')).toBeTruthy();
        expect(utils.queryByRole('form', { name: 'Place Bet' })).toBeNull();
    });
});

// My bets is a tab of Bet Markets (view 'bets').
describe('(c) the My bets tab names each bet\'s outcome on its market card', () => {
    const BET_ROW = Object.freeze({
        action_index: '5001',
        feed_action_index: '1169',
        outcome: 1,
        amount: '100',
        tick: 'XCHAIN',
        bet_status: 'open',
    });

    async function openMyBets(messaging, props = {}) {
        let utils;
        await domAct(async () => {
            utils = mount(BetFeedsList, messaging, { view: 'bets', onOpenMarket() {}, ...props });
            await drain();
        });
        // The label read is a second wave of effects behind the bet list.
        await domAct(async () => { await drain(); });
        return utils;
    }

    // My bets is the All list narrowed to the markets the wallet bet in
    // (operator ruling 2026-11-13): the market names its outcomes, so the
    // card's chip names the backed side with no read per bet.
    const listed = (utils) => Array.from(utils.container.querySelectorAll('[data-market-index]'))
        .map((el) => el.getAttribute('data-market-index'));
    const marketsRead = () => Promise.resolve({ data: [ZERO_DECIMAL_FEED, OWN_CLOSED_FEED] });

    it('lists the market the bet sits in as its card, naming the backed side', async () => {
        const { messaging, calls } = harness({ bets: () => Promise.resolve({ data: [BET_ROW] }), betFeeds: marketsRead });
        const onOpenMarket = vi.fn();
        const utils = await openMyBets(messaging, { onOpenMarket });
        expect(listed(utils)).toEqual(['1169']);
        // One short summary on the right of the row: amount and asset only.
        const chips = utils.container.querySelectorAll('[data-testid="bet-market-your-bet"]');
        expect(chips.length).toBe(1);
        expect(chips[0].textContent).toBe('You bet 100 XCHAIN');
        expect(chips[0].closest('span[class*="right"]')).not.toBeNull();
        expect(utils.container.textContent).not.toContain(' on No');
        fireEvent.click(utils.container.querySelector('[data-market-index="1169"]'));
        expect(onOpenMarket).toHaveBeenCalledWith(CHAIN, '1169');
        // No market read per bet: the list's own read carries the labels.
        expect(calls.filter((c) => c.method === 'betFeed').length).toBe(0);
    });

    it('sums several bets and assets into the one right-side summary', async () => {
        const second = { ...BET_ROW, action_index: '6001', outcome: 0, amount: '50' };
        const other = { ...BET_ROW, action_index: '6002', tick: 'PEPE', amount: '5' };
        const { messaging } = harness({ bets: () => Promise.resolve({ data: [BET_ROW, second, other] }), betFeeds: marketsRead });
        const utils = await openMyBets(messaging);
        const chips = utils.container.querySelectorAll('[data-testid="bet-market-your-bet"]');
        expect(chips.length).toBe(1);
        expect(chips[0].textContent).toBe('You bet 150 XCHAIN +1 more');
    });

    it('reads no market per bet however many bets the wallet holds', async () => {
        const many = Array.from({ length: 40 }, (_, i) => ({
            ...BET_ROW, action_index: String(6000 + i), feed_action_index: String(2000 + i),
        }));
        const { messaging, calls } = harness({ bets: () => Promise.resolve({ data: many }), betFeeds: marketsRead });
        await openMyBets(messaging);
        await domAct(async () => { await drain(40); });
        expect(calls.filter((c) => c.method === 'betFeed').length).toBe(0);
    });

    // Session 25,. The deadline race put a REJECTED bet in this list and
    // it read "Backed "No" (outcome 1) · staked 100 XCHAIN" under a raw
    // lowercase `invalid` pill in the same colour as a live position. Nothing
    // was staked: the chain refused the action. What it did cost is the fees.
    it('does not tell a bettor they staked money on a bet the chain refused', async () => {
        const rejected = { ...BET_ROW, bet_status: 'invalid', status: 'invalid: FEED_ACTION_INDEX (feed not open)' };
        const { messaging } = harness({ bets: () => Promise.resolve({ data: [rejected] }), betFeeds: marketsRead });
        const utils = await openMyBets(messaging);
        const text = utils.container.textContent;

        expect(text).not.toContain('You bet 100 XCHAIN');
        expect(text).toContain('Your bet was rejected by the network');
        // The market is still listed: the user paid fees for the bet and may
        // need to find it.
        expect(listed(utils)).toEqual(['1169']);
    });
});
