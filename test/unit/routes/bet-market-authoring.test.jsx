// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// P8: the BET authoring surfaces, driven as a user drives them.
//
// Three things here are worth a test rather than a read-through:
//
//   1. The market's cost quote is keyed on the REFUND deadline, not the betting
//      deadline. A user reads "time to publish the result" as a safety margin
//      rather than a price, so a quote that ignored it would under-quote exactly
//      the field most likely to push a market past the free window.
//   2. Every BET surface must actually RENDER the confirm page. The confirm flow
//      opens a phase and waits for Approve; a screen that opens it without
//      drawing it strands the action AND holds the confirm singleton, which
//      makes every other form in the wallet reject as busy. BetFeedDetail and
//      OracleConsole both shipped without it.
//   3. Compose and submit must be handed the SAME params object. BET's four
//      formats differ by a single field, so a second derivation is not a style
//      problem: a create whose params drift is signed rather than caught.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateBetFeedForm } from '../../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';
import { projectBetPayout } from '../../../packages/core/src/flows/betQueries.js';

const CHAIN = 'bitcoin-mainnet';
// A chain with NO XCHAIN fee lane, where a native-coin output is the
// only way to pay a protocol fee.
const LTC_CHAIN = 'litecoin-regtest';
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

const DEADLINE_LOCAL = '2027-06-01T12:00';
const DEADLINE_UNIX = Math.floor(Date.parse(DEADLINE_LOCAL) / 1000);
const DEFAULT_WINDOW = 1209600;   // 14 days, the form default
const YEAR_WINDOW = 31536000;

const FREE_QUOTE = Object.freeze({
    durationSeconds: 3801600, days: 44, billableDays: 0, free: true, fee: '0.00000000',
});
const CHARGED_QUOTE = Object.freeze({
    durationSeconds: 10368000, days: 120, billableDays: 30, free: false, fee: '0.16500000',
});

// One open market with two outcomes, run by someone else so the bet form shows.
const FEED = Object.freeze({
    action_index: '2308',
    source: ORACLE,
    label: 'Who wins the final?',
    outcomes: 'Home,Away',
    tick: 'PEPECREATURE',
    fee: '1.00',
    deadline: DEADLINE_UNIX,
    expire_at: DEADLINE_UNIX + DEFAULT_WINDOW,
    feed_status: 'open',
    pools: [{ outcome: 0, pool: '10.00000000', bet_count: 1 }],
    timeline: [{ status: 'open', block_index: 4217 }],
});

// A lopsided market: the D-97 shape, one side heavily backed and the other
// carrying no pool row at all, with a stake too small to survive the floor.
const WHALE_FEED = Object.freeze({
    ...FEED,
    action_index: '1169',
    pools: [{ outcome: 0, pool: '1000000.00000000', bet_count: 40 }],
});

// A stand-in for sdk.betting.projectPayout. It keeps the two rules the real one
// enforces and that the pool ROWS broke on: the outcome must be in range of the
// pools handed in, and every pool must parse as a number. Floats are fine at
// this size; the point under test is the shape reaching the SDK, not the last
// decimal place (the bignumber ordering is the SDK's own test).
function sdkProjectPayout({ pools, outcome, stake, feePct = 0 }) {
    if (!Array.isArray(pools)) throw new Error('projectPayout: pools must be an array');
    const index = Number(outcome);
    if (!Number.isInteger(index) || index < 0 || index >= pools.length) {
        throw new Error('projectPayout: outcome is out of range for the pools given');
    }
    const num = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(`projectPayout: pool is not a number: ${String(v)}`);
        return n;
    };
    const floor8 = (n) => Math.floor(n * 1e8) / 1e8;
    const staked = Number(stake);
    const totalIn = pools.reduce((sum, p) => sum + num(p), 0) + staked;
    const winning = num(pools[index]) + staked;
    if (!(winning > 0)) return null;
    const fee = floor8((totalIn * Number(feePct)) / 100);
    const payout = floor8((staked * (totalIn - fee)) / winning);
    return {
        payout: payout.toFixed(8),
        profit: (payout - staked).toFixed(8),
        impliedOdds: (payout / staked).toFixed(8),
        total: totalIn.toFixed(8),
        winningPool: winning.toFixed(8),
        fee: fee.toFixed(8),
    };
}

// A market this wallet's own address runs, past its deadline and inside the
// refund window: the one state where resolve is legal.
const OWN_CLOSED_FEED = Object.freeze({
    action_index: '2343',
    source: OWN,
    label: 'Rain tomorrow?',
    outcomes: 'Yes,No',
    tick: 'PEPECREATURE',
    fee: '2.00',
    deadline: Math.floor(Date.now() / 1000) - 3600,
    expire_at: Math.floor(Date.now() / 1000) + 3600,
    feed_status: 'closed',
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
                actionString: 'BET|0|x',
                version: 0,
                // The confirm page decodes THIS, not the form state.
                betParams: { version: 0, ...(args?.params || {}) },
            });
        },
        betProjectFeedCreateFee: (args) => {
            calls.push({ method: 'betProjectFeedCreateFee', args });
            return Promise.resolve(Number(args?.refundWindow) > DEFAULT_WINDOW ? CHARGED_QUOTE : FREE_QUOTE);
        },
        createMarketAction: (args) => {
            calls.push({ method: 'createMarketAction', args });
            return Promise.resolve({ txid: 'deadbeef' });
        },
        placeBetAction: (args) => {
            calls.push({ method: 'placeBetAction', args });
            return Promise.resolve({ txid: 'cafe' });
        },
        resolveMarketAction: (args) => {
            calls.push({ method: 'resolveMarketAction', args });
            return Promise.resolve({ txid: 'f00d' });
        },
        betFeed: (args) => {
            calls.push({ method: 'betFeed', args });
            return Promise.resolve({ data: [FEED] });
        },
        betFeeds: (args) => {
            calls.push({ method: 'betFeeds', args });
            return Promise.resolve({ data: [OWN_CLOSED_FEED] });
        },
        // Driven through the REAL flow helper, not a canned answer: the whole of
        // was a shape mismatch BETWEEN the screen and the SDK, and a mock
        // that returns a ready-made string is exactly what hid it.
        betProjectPayout: (args) => {
            calls.push({ method: 'betProjectPayout', args });
            return projectBetPayout({
                ...args,
                sdkRegistry: { get: () => ({ betting: { projectPayout: sdkProjectPayout } }) },
            });
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

// Fill the minimum a valid market needs. The token field is a picker, so the
// tick is seeded through the prop the shells pass.
async function fillMarket(utils, { outcomes = ['Home', 'Away'] } = {}) {
    await domAct(async () => {
        typeIn(utils, 'What is being bet on', 'Who wins the final?');
        typeIn(utils, 'Outcome 0', outcomes[0]);
        typeIn(utils, 'Outcome 1', outcomes[1]);
        typeIn(utils, 'Betting closes', DEADLINE_LOCAL);
        await drain();
    });
}

describe('CreateBetFeedForm: the live market-cost quote', () => {
    it('prices the market on the REFUND deadline, so the publish window moves the cost', async () => {
        const { messaging, calls } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(CreateBetFeedForm, messaging, { chainId: CHAIN, presetTick: 'PEPECREATURE' });
            await drain();
        });
        await fillMarket(utils);

        const first = calls.filter((c) => c.method === 'betProjectFeedCreateFee').pop();
        expect(first).toBeTruthy();
        expect(Number(first.args.deadline)).toBe(DEADLINE_UNIX);
        expect(Number(first.args.refundWindow)).toBe(DEFAULT_WINDOW);
        expect(utils.container.textContent).toMatch(/free/i);

        // Lengthening ONLY the publish window re-quotes and now charges. This is
        // the case the display exists for: the user changed a safety margin, not
        // a price, and the price moved.
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Time to publish the result'), {
                target: { value: String(YEAR_WINDOW) },
            });
            await drain();
        });
        const second = calls.filter((c) => c.method === 'betProjectFeedCreateFee').pop();
        expect(Number(second.args.refundWindow)).toBe(YEAR_WINDOW);
        expect(Number(second.args.deadline)).toBe(DEADLINE_UNIX);
        expect(utils.container.textContent).toContain('0.16500000');
    });
});

describe('CreateBetFeedForm: compose and submit', () => {
    it('composes through the SDK createMarketParams builder and signs the SAME params', async () => {
        const { messaging, calls } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(CreateBetFeedForm, messaging, { chainId: CHAIN, presetTick: 'PEPECREATURE' });
            await drain();
        });
        await fillMarket(utils);

        await domAct(async () => {
            fireEvent.click(button(utils, /Review market/i));
            await drain();
        });

        const compose = calls.find((c) => c.method === 'composeBetForConfirm');
        expect(compose).toBeTruthy();
        expect(compose.args.builder).toBe('createMarketParams');
        expect(compose.args.params).toMatchObject({
            label: 'Who wins the final?',
            outcomes: ['Home', 'Away'],
            tick: 'PEPECREATURE',
            deadline: DEADLINE_UNIX,
            refundWindow: DEFAULT_WINDOW,
        });
        // Nothing is signed by opening the confirm page.
        expect(calls.some((c) => c.method === 'createMarketAction')).toBe(false);
        expect(utils.getByTestId('confirm-modal')).toBeTruthy();

        await domAct(async () => {
            typeIn(utils, 'Password', 'hunter2');
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-approve'));
            await drain();
        });
        const submit = calls.find((c) => c.method === 'createMarketAction');
        expect(submit).toBeTruthy();
        expect(submit.args.password).toBe('hunter2');
        // Byte-for-byte the object compose was handed.
        expect(submit.args.params).toEqual(compose.args.params);
    });

    it('attaches DETAILS only when it carries more than the title, and titles it from the label', async () => {
        const { messaging, calls } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(CreateBetFeedForm, messaging, { chainId: CHAIN, presetTick: 'PEPECREATURE' });
            await drain();
        });
        await fillMarket(utils);

        // No description yet: a DETAILS blob holding only a copy of LABEL is
        // wire weight for nothing, and the whole action shares one size ceiling.
        await domAct(async () => {
            fireEvent.click(button(utils, /Review market/i));
            await drain();
        });
        expect(calls.find((c) => c.method === 'composeBetForConfirm').args.params.details).toBeUndefined();

        // Reject, add a description, and it attaches with the title tied to the label.
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-reject'));
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /Add a description/i));
            await drain();
        });
        await domAct(async () => {
            typeIn(utils, 'Description', 'Best of three, decided by the official result.');
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /Review market/i));
            await drain();
        });
        const last = calls.filter((c) => c.method === 'composeBetForConfirm').pop();
        expect(last.args.params.details).toMatchObject({
            title: 'Who wins the final?',
            description: 'Best of three, decided by the official result.',
        });
    });

    it('refuses two outcomes with the same label before composing anything', async () => {
        const { messaging, calls } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(CreateBetFeedForm, messaging, { chainId: CHAIN, presetTick: 'PEPECREATURE' });
            await drain();
        });
        await fillMarket(utils, { outcomes: ['Home', 'Home'] });
        await domAct(async () => {
            fireEvent.click(button(utils, /Review market/i));
            await drain();
        });
        expect(calls.some((c) => c.method === 'composeBetForConfirm')).toBe(false);
        expect(utils.container.textContent).toMatch(/same label/i);
    });

    it('refuses an outcome label carrying a separator the wire format uses', async () => {
        const { messaging, calls } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(CreateBetFeedForm, messaging, { chainId: CHAIN, presetTick: 'PEPECREATURE' });
            await drain();
        });
        await fillMarket(utils, { outcomes: ['Home, away or draw', 'Away'] });
        await domAct(async () => {
            fireEvent.click(button(utils, /Review market/i));
            await drain();
        });
        expect(calls.some((c) => c.method === 'composeBetForConfirm')).toBe(false);
        expect(utils.container.textContent).toMatch(/comma/i);
    });

    it('accepts an ordinary multi-word outcome label (the separator check is not a space check)', async () => {
        const { messaging, calls } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(CreateBetFeedForm, messaging, { chainId: CHAIN, presetTick: 'PEPECREATURE' });
            await drain();
        });
        await fillMarket(utils, { outcomes: ['Home team wins', 'Away team wins'] });
        await domAct(async () => {
            fireEvent.click(button(utils, /Review market/i));
            await drain();
        });
        const compose = calls.find((c) => c.method === 'composeBetForConfirm');
        expect(compose).toBeTruthy();
        expect(compose.args.params.outcomes).toEqual(['Home team wins', 'Away team wins']);
    });
});

//A parimutuel stake has no price the bettor can work out for themselves:
// it buys a share of a pot that every later bet re-divides. The projected payout
// is therefore the one number the decision turns on, and it reached the screen as
// nothing at all, because the explorer's pool ROWS were handed to payout math
// that indexes amounts BY outcome. The failure was silent in both directions, so
// what is pinned here is that the number REACHES the user.
describe('BetFeedDetail states what a win would pay', () => {
    async function openMarket(messaging, feedIndex = '2308') {
        let utils;
        await domAct(async () => {
            utils = mount(BetFeedDetail, messaging, { chainId: CHAIN, feedIndex });
            await drain();
        });
        return utils;
    }

    async function stakeOn(utils, outcomeLabel, amount) {
        await domAct(async () => {
            fireEvent.click(button(utils, new RegExp(`^${outcomeLabel}$`)));
            await drain();
        });
        await domAct(async () => {
            typeIn(utils, 'Stake (PEPECREATURE)', amount);
            await drain();
        });
    }

    it('projects a payout for the outcome NOBODY has backed yet', async () => {
        // The reported case exactly: the pool sits on outcome 0 and the user
        // backs outcome 1, which the explorer does not return a row for. Before
        // the fix the SDK rejected outcome 1 as past the end of a one-row list
        // and the screen fell back to silence.
        const { messaging, calls } = harness();
        const utils = await openMarket(messaging);
        await stakeOn(utils, 'Away', '5');

        const call = calls.filter((c) => c.method === 'betProjectPayout').pop();
        expect(call).toBeTruthy();
        // The count is what tells the payout math the unbacked outcome exists.
        expect(call.args.outcomeCount).toBe(2);
        expect(call.args.outcome).toBe(1);
        expect(call.args.stake).toBe('5');
        expect(call.args.feePct).toBe('1.00');

        // 10 already staked + 5 = 15 in, 1% oracle fee floors to 0.15, and the
        // lone winner takes the whole 14.85 pot.
        const shown = utils.getByTestId('bet-projection').textContent;
        expect(shown).toMatch(/If\s+Away\s+wins/);
        expect(shown).toContain('14.85000000 PEPECREATURE');
        expect(shown).toMatch(/profit of 9\.85/);
        expect(shown).toMatch(/2\.97x your stake/);
        // Never presented as a price: the pot is re-divided by every later bet.
        expect(shown).toMatch(/not a locked-in price/i);
    });

    it('projects the crowded side too, where the payout is barely above the stake', async () => {
        const { messaging } = harness();
        const utils = await openMarket(messaging);
        await stakeOn(utils, 'Home', '5');
        const shown = utils.getByTestId('bet-projection').textContent;
        expect(shown).toMatch(/If\s+Home\s+wins/);
        expect(shown).toContain('4.95000000 PEPECREATURE');
        // Backing the favourite at a 1% fee LOSES money if nobody joins the
        // other side. Saying so is the entire point of showing the number.
        expect(shown).toMatch(/0\.05 less than you staked/);
    });

    it('says in words when a stake would win and still pay nothing', async () => {
        // The screen already warned that payouts round down. That told the user
        // the risk exists without ever telling them they were in it.
        const { messaging } = harness({ betFeed: () => Promise.resolve({ data: [WHALE_FEED] }) });
        const utils = await openMarket(messaging, '1169');
        await stakeOn(utils, 'Home', '0.00000001');
        const shown = utils.getByTestId('bet-projection').textContent;
        expect(shown).toMatch(/would win and still pay/i);
        expect(shown).toMatch(/nothing/i);
        expect(shown).toMatch(/round down/i);
    });

    it('shows nothing at all until an outcome AND a stake are both chosen', async () => {
        const { messaging, calls } = harness();
        const utils = await openMarket(messaging);
        expect(utils.queryByTestId('bet-projection')).toBeNull();

        await domAct(async () => {
            fireEvent.click(button(utils, /^Away$/));
            await drain();
        });
        expect(utils.queryByTestId('bet-projection')).toBeNull();
        expect(calls.some((c) => c.method === 'betProjectPayout')).toBe(false);

        await stakeOn(utils, 'Away', '5');
        expect(utils.queryByTestId('bet-projection')).toBeTruthy();

        // Clearing the stake retracts the number rather than leaving a stale one
        // on screen next to an empty field.
        await domAct(async () => {
            typeIn(utils, 'Stake (PEPECREATURE)', '');
            await drain();
        });
        expect(utils.queryByTestId('bet-projection')).toBeNull();
    });

    it('stays quiet rather than erroring when the projection is unavailable', async () => {
        // A host that predates the projection, and a half-typed stake, are both
        // normal. Neither is something to shout at the user about, and neither
        // may take the place-bet form down with it.
        const { messaging } = harness({ betProjectPayout: undefined });
        const utils = await openMarket(messaging);
        await stakeOn(utils, 'Away', '5');
        expect(utils.queryByTestId('bet-projection')).toBeNull();
        expect(button(utils, /Review bet/i)).toBeTruthy();
    });
});

describe('every BET surface renders the confirm page it opens', () => {
    it('BetFeedDetail: reviewing a bet draws the confirm page rather than stranding it', async () => {
        const { messaging, calls } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(BetFeedDetail, messaging, { chainId: CHAIN, feedIndex: '2308' });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /^Home$/));
            await drain();
        });
        await domAct(async () => {
            typeIn(utils, 'Stake (PEPECREATURE)', '5');
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /Review bet/i));
            await drain();
        });
        expect(calls.find((c) => c.method === 'composeBetForConfirm').args.builder).toBe('placeBetParams');
        expect(utils.getByTestId('confirm-modal')).toBeTruthy();
        expect(utils.getByTestId('confirm-approve')).toBeTruthy();

        // The password is typed on the confirm page, AFTER Approve's closure was
        // captured, so it only arrives if the submit reads a live ref.
        await domAct(async () => {
            typeIn(utils, 'Password', 'hunter2');
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-approve'));
            await drain();
        });
        const submit = calls.find((c) => c.method === 'placeBetAction');
        expect(submit).toBeTruthy();
        expect(submit.args.password).toBe('hunter2');
    });

    it('OracleConsole: reviewing a resolve draws the confirm page rather than stranding it', async () => {
        const { messaging, calls } = harness();
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
        expect(calls.find((c) => c.method === 'composeBetForConfirm').args.builder).toBe('resolveMarketParams');
        expect(utils.getByTestId('confirm-modal')).toBeTruthy();

        await domAct(async () => {
            typeIn(utils, 'Password', 'hunter2');
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-approve'));
            await drain();
        });
        const submit = calls.find((c) => c.method === 'resolveMarketAction');
        expect(submit).toBeTruthy();
        expect(submit.args.password).toBe('hunter2');
        expect(submit.args.params).toMatchObject({ feedActionIndex: '2343', outcome: 0 });
    });
});

// The native-coin fee lane on the two FEE-BEARING BET formats.
//
// BET charges on create (v0, duration-priced) and on place (v2, one pre-funded
// payout credit), and it is a COMMON_ACTION, so both are offered on LTC and
// DOGE. Those chains have no XCHAIN fee lane at all: the indexer answers
// `rejected` for a fee-bearing action carrying no FEE_DESTINATION output. So a
// market opened or a bet placed there without the native output is broadcast,
// spends a real miner fee, and never indexes. These surfaces shipped with no
// toggle, no hook and no encoderOpts, which made that the ONLY outcome.
//
// The flag has to travel on BOTH lanes. Compose is where it matters most: the
// FEE_DESTINATION output has to be inside the PSBT the user previews and the
// tamper check verifies, not added afterwards.
describe('BET carries the native-coin fee lane', () => {
    const ltcHarness = () => harness({
        getAddressesByChain: () => Promise.resolve({ [LTC_CHAIN]: [HD_ADDRESS] }),
    });

    it('CreateBetFeedForm forces the fee on LTC and states it rather than offering a choice', async () => {
        const { messaging, calls } = ltcHarness();
        let utils;
        await domAct(async () => {
            utils = mount(CreateBetFeedForm, messaging, { chainId: LTC_CHAIN, presetTick: 'PEPECREATURE' });
            await drain();
        });
        await fillMarket(utils);

        // The default 14-day market is FREE, and this form holds the
        // quote that says so, so the row states that rather than promising an
        // LTC payment that is never made. A statement either way, never a
        // switch: there is nothing to choose between on this chain.
        expect(utils.container.textContent).toContain('This action has no protocol fee');
        expect(utils.queryByLabelText(/Pay protocol fee in LTC instead of XCHAIN/)).toBeNull();

        // Lengthen the publish window past the free days and the same row turns
        // definite, with the figure the quote returned.
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Time to publish the result'), {
                target: { value: String(YEAR_WINDOW) },
            });
            await drain();
        });
        expect(utils.container.textContent).toContain('Protocol fee is paid in LTC');
        expect(utils.container.textContent).toContain("This action's protocol fee is 0.165 XCHAIN.");

        await domAct(async () => {
            fireEvent.click(button(utils, /Review market/i));
            await drain();
        });
        const compose = calls.find((c) => c.method === 'composeBetForConfirm');
        expect(compose.args.payFeeInNativeCoin).toBe(true);

        await domAct(async () => {
            typeIn(utils, 'Password', 'hunter2');
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-approve'));
            await drain();
        });
        // Signing lane too: a compose-only thread would preview a fee output the
        // submit never rebuilt.
        expect(calls.find((c) => c.method === 'createMarketAction').args.payFeeInNativeCoin).toBe(true);
    });

    it('CreateBetFeedForm keeps it an opt-in on Bitcoin, off by default and honoured when ticked', async () => {
        const { messaging, calls } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(CreateBetFeedForm, messaging, { chainId: CHAIN, presetTick: 'PEPECREATURE' });
            await drain();
        });
        await fillMarket(utils);
        // A charged market, so there is a fee lane to choose between at all:
        // hides the switch when the quote prices the action at zero,
        // because both settings would then pay nothing.
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Time to publish the result'), {
                target: { value: String(YEAR_WINDOW) },
            });
            await drain();
        });

        await domAct(async () => {
            fireEvent.click(button(utils, /Review market/i));
            await drain();
        });
        // Bitcoin settles the fee from an XCHAIN balance unless asked otherwise,
        // and the flag is absent rather than false so the payload is untouched.
        expect(calls.find((c) => c.method === 'composeBetForConfirm').args.payFeeInNativeCoin)
            .toBeUndefined();

        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-reject'));
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByLabelText('Pay protocol fee in BTC instead of XCHAIN'));
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /Review market/i));
            await drain();
        });
        expect(calls.filter((c) => c.method === 'composeBetForConfirm').pop().args.payFeeInNativeCoin)
            .toBe(true);
    });

    it('BetFeedDetail pays the place-bet fee natively on LTC, through compose and submit', async () => {
        const { messaging, calls } = ltcHarness();
        let utils;
        await domAct(async () => {
            utils = mount(BetFeedDetail, messaging, { chainId: LTC_CHAIN, feedIndex: '2308' });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /^Home$/));
            await drain();
        });
        await domAct(async () => {
            typeIn(utils, 'Stake (PEPECREATURE)', '5');
            await drain();
        });
        // Placing a bet IS priced (BET_PER_CREDIT), but this surface
        // holds no quote for it, so the row states the chain's rule instead of
        // asserting a charge it has not been given.
        expect(utils.container.textContent).toContain('Protocol fees are paid in LTC');

        await domAct(async () => {
            fireEvent.click(button(utils, /Review bet/i));
            await drain();
        });
        const compose = calls.find((c) => c.method === 'composeBetForConfirm');
        expect(compose.args.builder).toBe('placeBetParams');
        expect(compose.args.payFeeInNativeCoin).toBe(true);

        await domAct(async () => {
            typeIn(utils, 'Password', 'hunter2');
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-approve'));
            await drain();
        });
        expect(calls.find((c) => c.method === 'placeBetAction').args.payFeeInNativeCoin).toBe(true);
    });

    it('leaves the FREE formats alone: an LTC resolve pays no protocol fee', async () => {
        // Resolve (v3) and cancel (v1) emit only credits that were pre-funded at
        // place time, so the chain charges nothing. Forcing a fee output there
        // would spend a user's coin on a fee that does not exist.
        const { messaging, calls } = harness({
            getAddressesByChain: () => Promise.resolve({ [LTC_CHAIN]: [HD_ADDRESS] }),
            betFeeds: () => Promise.resolve({ data: [OWN_CLOSED_FEED] }),
        });
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
        const compose = calls.find((c) => c.method === 'composeBetForConfirm');
        expect(compose.args.builder).toBe('resolveMarketParams');
        expect(compose.args.payFeeInNativeCoin).toBeUndefined();
        // No fee row at all, in either voice (a later change gave the unquoted case a
        // plural wording, which a `Protocol fee is paid in` check would miss).
        expect(utils.container.textContent).not.toMatch(/Protocol fees? (is|are) paid in/);
    });
});
