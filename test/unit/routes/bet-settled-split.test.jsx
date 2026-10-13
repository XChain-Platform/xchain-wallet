// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A settled market must preserve its final split without claiming nobody bet.
// Current explorers return the complete accepted-bet aggregate. The bounded
// bet-row reconstruction supports older or incomplete responses only when that
// terminal aggregate is empty.

import { describe, it, expect, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedDetail, splitFromBets, isLiveFeedStatus } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const ORACLE = 'bc1qoracleoracleoracleoracleoracleoraclex';
const BETTOR = 'bc1qbettorbettorbettorbettorbettorbettorx';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: OWN,
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

// Compatibility shape for a terminal market whose explorer omits final pools.
function feed(status, extra = {}) {
    return {
        action_index: '1268',
        source: ORACLE,
        label: 'Does cancelling a market refund every open bet in full?',
        outcomes: 'Yes,No',
        tick: 'XCHAIN',
        fee: '5',
        deadline: Math.floor(Date.now() / 1000) + 3600,
        expire_at: Math.floor(Date.now() / 1000) + 90000,
        feed_status: status,
        pools: [],
        timeline: [{ status: 'open', block_index: 6594 }, { status, block_index: 6598 }],
        ...extra,
    };
}

const REFUNDED_BETS = Object.freeze([
    { action_index: '1269', outcome: 0, amount: '300', bet_status: 'refunded', source: BETTOR },
    { action_index: '1270', outcome: 1, amount: '100', bet_status: 'refunded', source: OWN },
]);

function harness(overrides = {}) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        betFeed: () => Promise.resolve({ data: [feed('cancelled')] }),
        bets: (args) => {
            calls.push({ method: 'bets', args });
            return Promise.resolve({ data: REFUNDED_BETS });
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

async function openMarket(messaging, props = {}) {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(BetFeedDetail, {
                    walletId: 'w', chainId: CHAIN, feedIndex: '1268', onBack() {},
                    ...props,
                }),
            ),
        );
        await drain();
    });
    return utils;
}

describe('splitFromBets', () => {
    it('aggregates per outcome, with a decimal-safe pool total', () => {
        expect(splitFromBets([
            { outcome: 0, amount: '300' },
            { outcome: 0, amount: '0.5' },
            { outcome: 1, amount: '100' },
        ])).toEqual([
            { outcome: 0, pool: '300.5', bet_count: 2 },
            { outcome: 1, pool: '100', bet_count: 1 },
        ]);
    });

    it('ignores rows with no usable outcome rather than bucketing them at 0', () => {
        expect(splitFromBets([{ amount: '5' }, { outcome: null, amount: '5' }])).toEqual([]);
        expect(splitFromBets(null)).toEqual([]);
    });

    // Session 25,. Market #1198 was resolved `resolved_void` because it
    // held no accepted bets at all, and its page still read "0: Yes 100
    // (100.0%, 1 bet)" - the rejected bet from the deadline race, counted as a
    // stake. A rejected BET is a real transaction that paid real fees and
    // staked nothing.
    it('leaves out bets the chain rejected, which staked nothing', () => {
        expect(splitFromBets([
            { outcome: 0, amount: '100', bet_status: 'invalid', status: 'invalid: FEED_ACTION_INDEX (feed not open)' },
            { outcome: 0, amount: '300', bet_status: 'won', status: 'valid' },
        ])).toEqual([{ outcome: 0, pool: '300', bet_count: 1 }]);

        // A market whose only bet was rejected has an empty split, not a
        // phantom pool beside a "void, everyone refunded" verdict.
        expect(splitFromBets([
            { outcome: 0, amount: '100', bet_status: 'invalid', status: 'invalid: FEED_ACTION_INDEX (feed not open)' },
        ])).toEqual([]);
    });

    it('still counts a row whose validity the host never reported', () => {
        // An explorer that omits the field must not silently empty the split.
        expect(splitFromBets([{ outcome: 1, amount: '7' }])).toEqual([
            { outcome: 1, pool: '7', bet_count: 1 },
        ]);
    });
});

describe('isLiveFeedStatus', () => {
    it('treats only open and closed as live', () => {
        expect(isLiveFeedStatus('open')).toBe(true);
        expect(isLiveFeedStatus('closed')).toBe(true);
        for (const s of ['cancelled', 'resolved', 'resolved_void', 'expired']) {
            expect(isLiveFeedStatus(s)).toBe(false);
        }
    });
});

describe('BetFeedDetail: a settled market reports what happened', () => {
    it('names the winner and explains that payouts need no claim', async () => {
        const { messaging } = harness({
            betFeed: () => Promise.resolve({ data: [feed('resolved', { winning_outcome: 0 })] }),
            bets: () => Promise.resolve({ data: [
                { action_index: '1269', outcome: 0, amount: '300', bet_status: 'won' },
                { action_index: '1270', outcome: 1, amount: '100', bet_status: 'lost' },
            ] }),
        });
        const utils = await openMarket(messaging);
        const settlement = utils.getByTestId('bet-settlement');

        expect(settlement.textContent).toContain('Winning outcome: "Yes" (outcome 0)');
        expect(settlement.textContent).toContain('Winning bets settled as won');
        expect(settlement.textContent).toContain('nothing to claim');
        expect(utils.container.textContent).toContain('winner "Yes" (outcome 0)');
    });

    it('offers the existing oracle settlement controls only to this market owner', async () => {
        const onSettleMarket = vi.fn();
        const { messaging } = harness({
            betFeed: () => Promise.resolve({
                data: [feed('closed', { source: OWN, expire_at: Math.floor(Date.now() / 1000) + 3600 })],
            }),
        });
        const utils = await openMarket(messaging, { onSettleMarket });

        expect(utils.getByTestId('bet-settlement').textContent).toContain('Pending resolution');
        expect(utils.getByTestId('bet-settlement').textContent).toContain('do not submit a claim');
        fireEvent.click(utils.getByRole('button', { name: 'Settle this market' }));
        expect(onSettleMarket).toHaveBeenCalledOnce();
        utils.unmount();

        const other = harness({
            betFeed: () => Promise.resolve({ data: [feed('closed', { source: ORACLE })] }),
        });
        const otherUtils = await openMarket(other.messaging, { onSettleMarket });
        expect(otherUtils.queryByRole('button', { name: 'Settle this market' })).toBeNull();
    });

    it('rebuilds the split from the bets when the market is terminal', async () => {
        const { messaging, calls } = harness();
        const utils = await openMarket(messaging);
        const text = utils.container.textContent;

        expect(text).toContain('Final split');
        expect(text).not.toContain('Current split');
        // The claim the defect made, in the exact words a bettor read.
        expect(text).not.toContain('no bets yet');
        expect(text).toContain('300');
        expect(text).toContain('100');
        expect(text).toContain('1 bet)');

        const betsCall = calls.find((c) => c.method === 'bets');
        expect(betsCall?.args).toMatchObject({ chainId: CHAIN, query: '1268', type: 'feed' });

        // The same screen must not still be advising on a decision that is over.
        expect(text).not.toContain('every later bet changes it');
        expect(text).toContain('The split above is final');
    });

    it('keeps a complete terminal explorer aggregate instead of replacing it with a capped read', async () => {
        const { messaging, calls } = harness({
            betFeed: () => Promise.resolve({ data: [feed('resolved', {
                winning_outcome: 0,
                pools: [
                    { outcome: 0, pool: '900', bet_count: 9 },
                    { outcome: 1, pool: '100', bet_count: 1 },
                ],
            })] }),
        });
        const utils = await openMarket(messaging);
        const text = utils.container.textContent;

        expect(text).toContain('900 (90.0%, 9 bets)');
        expect(text).toContain('100 (10.0%, 1 bet)');
        expect(calls.some((call) => call.method === 'bets')).toBe(false);
    });

    it('leaves a live market on the explorer aggregate and asks for no bet rows', async () => {
        const { messaging, calls } = harness({
            betFeed: () => Promise.resolve({
                data: [feed('open', { pools: [{ outcome: 0, pool: '300.000000000000000000', bet_count: 1 }] })],
            }),
        });
        const utils = await openMarket(messaging);
        const text = utils.container.textContent;

        expect(text).toContain('Current split');
        expect(text).not.toContain('Final split');
        expect(text).toContain('300');
        expect(calls.some((c) => c.method === 'bets')).toBe(false);
    });

    it('says "no bets" rather than "no bets yet" on a market that really took none', async () => {
        const { messaging } = harness({
            betFeed: () => Promise.resolve({ data: [feed('resolved_void')] }),
            bets: () => Promise.resolve({ data: [] }),
        });
        const utils = await openMarket(messaging);
        const text = utils.container.textContent;

        expect(text).toContain('no bets');
        expect(text).not.toContain('no bets yet');
    });

    // Same family, other surface: the oracle's own console kept counting down
    // on a market that was over. Session 23 read "Betting closes in 1h 12m ·
    // refunds everyone in 1d 1h if unresolved" on the line under the word
    // `cancelled`, minutes after the refunds had already landed.
    it('OracleConsole drops the countdown once the market is terminal', async () => {
        const own = { ...feed('cancelled'), source: OWN, chainId: CHAIN };
        const live = { ...feed('closed'), action_index: '1193', source: OWN, chainId: CHAIN };
        const { messaging } = harness({
            betFeeds: ({ chainId }) => Promise.resolve({ data: chainId === CHAIN ? [own, live] : [] }),
        });
        let utils;
        await domAct(async () => {
            utils = render(
                React.createElement(
                    MessagingProvider,
                    { shell: 'web', messaging },
                    React.createElement(OracleConsole, { walletId: 'w', onBack() {} }),
                ),
            );
            await drain();
        });
        // The card element itself, not an ancestor that happens to contain both.
        const cards = Array.from(utils.container.querySelectorAll('div'))
            .filter((d) => /card/i.test(String(d.className)) && /^Market number: #\d+/.test(d.textContent || ''));
        const cancelled = cards.find((d) => /#1268/.test(d.textContent));
        const closed = cards.find((d) => /#1193/.test(d.textContent));

        expect(cancelled.textContent).not.toContain('Betting closes');
        expect(cancelled.textContent).not.toContain('if unresolved');
        // The live one still needs both clocks: acting inside them is the job.
        expect(closed.textContent).toContain('Betting closes');
        expect(closed.textContent).toContain('if unresolved');
    });

    // A bound that is not stated reads as "this is all of them".
    it('admits it when the bet read was capped instead of implying a complete total', async () => {
        const many = Array.from({ length: 500 }, (_, i) => ({
            action_index: String(2000 + i), outcome: i % 2, amount: '1', bet_status: 'lost',
        }));
        const { messaging } = harness({ bets: () => Promise.resolve({ data: many }) });
        const utils = await openMarket(messaging);
        const text = utils.container.textContent;

        expect(text).toContain('more than 500 bets');
        expect(text).toContain('250 bets');   // the split it could see, still shown
    });

    it('says nothing about a cap when the whole market fits in one read', async () => {
        const { messaging } = harness();
        const utils = await openMarket(messaging);
        expect(utils.container.textContent).not.toContain('more than 500 bets');
    });

    it('falls back to the live rows if the bet read fails, rather than blanking the screen', async () => {
        const { messaging } = harness({ bets: () => Promise.reject(new Error('explorer down')) });
        const utils = await openMarket(messaging);
        expect(utils.container.textContent).toContain('Final split');
        expect(vi.isMockFunction(messaging.bets)).toBe(false);
    });
});
