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
import { MyBets } from '../../../packages/core/src/shared/routes/MyBets.jsx';
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

describe('(a) BetFeedDetail: the pool respects the token, not the sum column', () => {
    it('renders a 0-decimal token\'s pool without the DECIMAL(65,18) tail', async () => {
        const { messaging } = harness();
        const utils = await openMarket(messaging);
        const shown = utils.container.textContent;
        expect(shown).not.toContain('300.000000000000000000');
        expect(shown).toContain('300 (100.0%');
    });

    it('does not trim a figure that has significant decimals', async () => {
        const { messaging } = harness({
            betFeed: () => Promise.resolve({
                data: [{ ...ZERO_DECIMAL_FEED, pools: [{ outcome: 0, pool: '0.175000000000000000', bet_count: 2 }] }],
            }),
        });
        const utils = await openMarket(messaging);
        expect(utils.container.textContent).toContain('0.175 (100.0%');
    });
});

describe('(b) counts are pluralized', () => {
    it('one bet is "1 bet", two are "2 bets"', async () => {
        const { messaging } = harness();
        const utils = await openMarket(messaging);
        expect(utils.container.textContent).toContain('1 bet)');
        expect(utils.container.textContent).not.toContain('1 bets');

        const two = harness({
            betFeed: () => Promise.resolve({
                data: [{ ...ZERO_DECIMAL_FEED, pools: [{ outcome: 0, pool: '300.000000000000000000', bet_count: 2 }] }],
            }),
        });
        const utils2 = await openMarket(two.messaging);
        expect(utils2.container.textContent).toContain('2 bets)');
    });

    it('a one-day market costs "about 1 day", never "about 1 days"', async () => {
        const { messaging } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(CreateBetFeedForm, messaging, { chainId: CHAIN, presetTick: 'XCHAIN' });
            await drain();
        });
        await domAct(async () => {
            typeIn(utils, 'What is being bet on', 'Will it ship?');
            typeIn(utils, 'Outcome 0', 'Yes');
            typeIn(utils, 'Outcome 1', 'No');
            typeIn(utils, 'Betting closes', '2027-06-01T12:00');
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
        await domAct(async () => {
            fireEvent.click(button(utils, /^Yes$/));
            await drain();
        });
        await domAct(async () => {
            typeIn(utils, 'Stake (XCHAIN)', '300');
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /Review bet/i));
            await drain();
        });

        const intent = utils.getByTestId('action-intent').textContent;
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
            fireEvent.click(button(utils, /^Resolve$/));
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /^Yes$/));
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /Review resolve/i));
            await drain();
        });

        const intent = utils.getByTestId('action-intent').textContent;
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
        expect(utils.container.textContent).toContain('No outcomes recorded');
        // Nothing to pick means nothing to review: the button stays disabled.
        expect(button(utils, /Review bet/i).disabled).toBe(true);
    });
});

describe('(c) MyBets names each row\'s outcome', () => {
    const BET_ROW = Object.freeze({
        action_index: '5001',
        feed_action_index: '1169',
        outcome: 1,
        amount: '100',
        tick: 'XCHAIN',
        bet_status: 'open',
    });

    async function openMyBets(messaging) {
        let utils;
        await domAct(async () => {
            utils = mount(MyBets, messaging, {});
            await drain();
        });
        // The label read is a second wave of effects behind the bet list.
        await domAct(async () => { await drain(); });
        return utils;
    }

    it('reads the market for its labels and names the backed side', async () => {
        const { messaging, calls } = harness({ bets: () => Promise.resolve({ data: [BET_ROW] }) });
        const utils = await openMyBets(messaging);
        expect(utils.container.textContent).toContain('Backed "No" (outcome 1)');
        expect(utils.container.textContent).toContain('staked 100 XCHAIN');
        // One read per DISTINCT market, not per row.
        expect(calls.filter((c) => c.method === 'betFeed').length).toBe(1);
    });

    it('stops reading markets at the ceiling instead of re-batching forever', async () => {
        // The label read re-runs on its own result, so a per-pass cap would
        // just fetch the next batch each time. 40 distinct markets, ceiling 25.
        const many = Array.from({ length: 40 }, (_, i) => ({
            ...BET_ROW, action_index: String(6000 + i), feed_action_index: String(2000 + i),
        }));
        const { messaging, calls } = harness({ bets: () => Promise.resolve({ data: many }) });
        const utils = await openMyBets(messaging);
        await domAct(async () => { await drain(40); });
        expect(calls.filter((c) => c.method === 'betFeed').length).toBe(25);
        // The rows past the ceiling still render, on their index.
        expect(utils.container.textContent).toContain('Backed outcome 1');
    });

    // Session 25,. The deadline race put a REJECTED bet in this list and
    // it read "Backed "No" (outcome 1) · staked 100 XCHAIN" under a raw
    // lowercase `invalid` pill in the same colour as a live position. Nothing
    // was staked: the chain refused the action. What it did cost is the fees.
    it('does not tell a bettor they staked money on a bet the chain refused', async () => {
        const rejected = { ...BET_ROW, bet_status: 'invalid', status: 'invalid: FEED_ACTION_INDEX (feed not open)' };
        const { messaging } = harness({ bets: () => Promise.resolve({ data: [rejected] }) });
        const utils = await openMyBets(messaging);
        const text = utils.container.textContent;

        expect(text).not.toContain('staked 100 XCHAIN');
        expect(text).toContain('nothing was staked, but the fees were spent');
        expect(text).toContain('Rejected by the network');
        // The row still names what was attempted, and is still a row: the user
        // paid for it and may need to find it.
        expect(text).toContain('Would have backed "No" (outcome 1)');
    });

    it('keeps the index alone when the market read fails, and asks only once', async () => {
        const { messaging, calls } = harness({
            bets: () => Promise.resolve({ data: [BET_ROW] }),
            betFeed: (args) => {
                calls.push({ method: 'betFeed', args });
                return Promise.reject(new Error('explorer down'));
            },
        });
        const utils = await openMyBets(messaging);
        expect(utils.container.textContent).toContain('Backed outcome 1');
        expect(calls.filter((c) => c.method === 'betFeed').length).toBe(1);
    });
});
