// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  P8: the BET authoring surfaces, driven as a user drives them.
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

const CHAIN = 'bitcoin-mainnet';
// : a chain with NO XCHAIN fee lane, where a native-coin output is the
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
        betProjectPayout: () => Promise.resolve('13.86000000'),
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

describe(' CreateBetFeedForm: the live market-cost quote', () => {
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

describe(' CreateBetFeedForm: compose and submit', () => {
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

describe(' every BET surface renders the confirm page it opens', () => {
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

// : the native-coin fee lane on the two FEE-BEARING BET formats.
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
describe(' BET carries the native-coin fee lane', () => {
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

        // A statement, not a switch: there is nothing to choose between.
        expect(utils.container.textContent).toContain('Protocol fee is paid in LTC');
        expect(utils.queryByLabelText(/Pay protocol fee in LTC instead of XCHAIN/)).toBeNull();

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
        expect(utils.container.textContent).toContain('Protocol fee is paid in LTC');

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
        expect(utils.container.textContent).not.toContain('Protocol fee is paid in');
    });
});
