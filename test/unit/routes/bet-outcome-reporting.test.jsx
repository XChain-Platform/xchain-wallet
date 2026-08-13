// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A bet's outcome must outlive the form that placed it.
//
// Found by driving the deadline race (wallet E2E session 25): a bet composed
// while a market was open, approved a few minutes later after the deadline had
// passed. The wallet did exactly the right thing up to that point - the
// Approve-time re-check flipped the verdict to "Will likely fail: invalid:
// FEED_ACTION_INDEX (feed not open)" and put Approve behind an explicit "Sign
// anyway" - and then, once the bet WAS sent, said nothing whatsoever. No
// receipt, no txid, no error. The place-bet card is gated on
// `feed_status === 'open'`, the submit ends with reload(), and the reloaded feed
// came back `closed`, so the card unmounted and took the receipt with it.
//
// The bet was real: it landed on chain as action 1199 and the chain rejected it,
// after the payer had spent both a miner fee and a non-refundable protocol fee.
// A user in that position cannot tell "the wallet refused" from "the wallet sent
// it and it failed", and has no txid to look up either.
//
// The oracle side had the same hole from the other direction: publishing a
// result that pays out an entire pot reported nothing at all on success.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
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

const now = () => Math.floor(Date.now() / 1000);

function feed(status, extra = {}) {
    return {
        action_index: '1198',
        source: ORACLE,
        label: 'Does a bet composed before close survive to broadcast after close?',
        outcomes: 'Yes,No',
        tick: 'XCHAIN',
        fee: '0',
        deadline: status === 'open' ? now() + 600 : now() - 60,
        expire_at: now() + 86400,
        feed_status: status,
        pools: [],
        timeline: [{ status: 'open', block_index: 2270 }],
        chainId: CHAIN,
        ...extra,
    };
}

// A market this wallet runs, closed and inside the refund window: the one state
// where an oracle may both resolve and cancel.
function ownFeed(status = 'closed') {
    return { ...feed(status), action_index: '2343', source: OWN, label: 'Rain tomorrow?' };
}

beforeEach(() => { vi.useRealTimers(); });

/**
 * @param {object} opts
 * @param {string[]} [opts.feedStatuses] one status per betFeed() call, so the
 *   RELOAD that follows a submit can answer differently from the first read.
 *   That is the race: the market closes between compose and reload.
 */
function harness({ feedStatuses = ['open'], submitResult = { txid: 'cafebabe' }, submitThrows = null } = {}) {
    const calls = [];
    let reads = 0;
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [], unverified: [] }),
        composeBetForConfirm: (args) => {
            calls.push({ method: 'composeBetForConfirm', args });
            return Promise.resolve({
                psbt: 'aa00', encoding: 'psbt', actionString: 'BET|2|x', version: 2,
                betParams: { version: 2, ...(args?.params || {}) },
            });
        },
        placeBetAction: (args) => {
            calls.push({ method: 'placeBetAction', args });
            if (submitThrows) return Promise.reject(submitThrows);
            return Promise.resolve(submitResult);
        },
        resolveMarketAction: (args) => {
            calls.push({ method: 'resolveMarketAction', args });
            return Promise.resolve({ txid: 'f00dface' });
        },
        cancelMarketAction: (args) => {
            calls.push({ method: 'cancelMarketAction', args });
            return Promise.resolve({ txid: 'dec0ded1' });
        },
        betFeed: () => {
            const status = feedStatuses[Math.min(reads, feedStatuses.length - 1)];
            reads += 1;
            return Promise.resolve({ data: [feed(status)] });
        },
        betFeeds: () => Promise.resolve({ data: [ownFeed()] }),
        bets: () => Promise.resolve({ data: [] }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
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

// Drive a stake all the way through the confirm page's Approve.
async function placeBet(utils) {
    await domAct(async () => {
        fireEvent.click(button(utils, /^Yes$/));
        await drain();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText('Stake (XCHAIN)'), { target: { value: '100' } });
        await drain();
    });
    await domAct(async () => {
        fireEvent.click(button(utils, /Review bet/i));
        await drain();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByTestId('confirm-approve'));
        await drain();
    });
}

describe('BetFeedDetail reports the outcome of a bet the market has outlived', () => {
    it('keeps the receipt and the txid when the market closes between compose and reload', async () => {
        // First read: open, so the form is there to bet from. The reload after
        // the submit answers `closed` - the deadline passed while the user was
        // on the confirm page, which is the whole race.
        const { messaging, calls } = harness({ feedStatuses: ['open', 'closed'] });
        let utils;
        await domAct(async () => {
            utils = mount(BetFeedDetail, messaging, { chainId: CHAIN, feedIndex: '1198' });
            await drain();
        });
        await placeBet(utils);

        expect(calls.find((c) => c.method === 'placeBetAction')).toBeTruthy();
        // The card the receipt used to live in is correctly gone.
        expect(utils.container.textContent).not.toContain('Place a bet');
        // The receipt is not.
        const receipt = utils.getByTestId('bet-result');
        expect(receipt.textContent).toContain('cafebabe');
        expect(receipt.textContent).toMatch(/betting closed while you were confirming/i);
    });

    it('says plainly that a bet placed on a still-open market went through', async () => {
        const { messaging } = harness({ feedStatuses: ['open'] });
        let utils;
        await domAct(async () => {
            utils = mount(BetFeedDetail, messaging, { chainId: CHAIN, feedIndex: '1198' });
            await drain();
        });
        await placeBet(utils);

        const receipt = utils.getByTestId('bet-result');
        expect(receipt.textContent).toContain('Bet placed.');
        expect(receipt.textContent).toContain('cafebabe');
        expect(receipt.textContent).not.toMatch(/betting closed while you were confirming/i);
    });

    // leg (a), applied to the receipt this file introduced. useConfirmAction
    // resolves a TRANSIENT post-sign broadcast failure with { queued: true } rather
    // than throwing, so a receipt that keys on "we got a result" reports a bet that
    // never reached the network as placed - the exact shape D-99(a) swept out of
    // thirteen other forms.
    it('does not call a signed-but-unbroadcast bet placed', async () => {
        const { messaging } = harness({
            feedStatuses: ['open'],
            submitResult: { queued: true, broadcast: 'queued' },
        });
        let utils;
        await domAct(async () => {
            utils = mount(BetFeedDetail, messaging, { chainId: CHAIN, feedIndex: '1198' });
            await drain();
        });
        await placeBet(utils);

        const receipt = utils.getByTestId('bet-result');
        expect(receipt.textContent).not.toContain('Bet placed.');
        // : the receipt promises a reminder, never an automatic send.
        expect(receipt.textContent).toMatch(/waiting in the queued-transactions banner/i);
        expect(receipt.textContent).not.toMatch(/automatically/i);
        // No txid row: there is no txid, and "n/a" beside a Txid label reads as a
        // broadcast that lost its receipt rather than one that never happened.
        expect(receipt.textContent).not.toContain('Txid');
    });

    it('shows a failed submit even when the market has stopped taking bets', async () => {
        const { messaging } = harness({
            feedStatuses: ['open', 'closed'],
            submitThrows: Object.assign(new Error('Broadcast refused by the node.'), { name: 'Error' }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(BetFeedDetail, messaging, { chainId: CHAIN, feedIndex: '1198' });
            await drain();
        });
        await placeBet(utils);

        const alert = utils.container.querySelector('[role="alert"]');
        expect(alert).toBeTruthy();
        expect(alert.textContent).toContain('Broadcast refused by the node.');
        expect(utils.queryByTestId('bet-result')).toBeNull();
    });
});

describe('OracleConsole confirms the two actions that settle a market', () => {
    async function openConsole(messaging) {
        let utils;
        await domAct(async () => {
            utils = mount(OracleConsole, messaging, {});
            await drain();
        });
        return utils;
    }

    it('reports a published result with its txid instead of silently reloading', async () => {
        const { messaging } = harness();
        const utils = await openConsole(messaging);

        await domAct(async () => { fireEvent.click(button(utils, /^Resolve$/)); await drain(); });
        await domAct(async () => { fireEvent.click(button(utils, /^Yes$/)); await drain(); });
        await domAct(async () => { fireEvent.click(button(utils, /Review resolve/i)); await drain(); });
        await domAct(async () => { fireEvent.click(utils.getByTestId('confirm-approve')); await drain(); });

        const receipt = utils.getByTestId('oracle-result');
        expect(receipt.textContent).toContain('#2343');
        expect(receipt.textContent).toContain('f00dface');
        expect(receipt.textContent).toMatch(/paid out/i);
    });

    it('does not tell an oracle a queued result was sent', async () => {
        // The oracle half of the same rule, and the one with a price: an oracle that
        // believes it published waits out its own refund window, at which point the
        // market expires, refunds everyone and pays the oracle nothing.
        const { messaging } = harness();
        messaging.resolveMarketAction = () => Promise.resolve({ queued: true, broadcast: 'queued' });
        const utils = await openConsole(messaging);

        await domAct(async () => { fireEvent.click(button(utils, /^Resolve$/)); await drain(); });
        await domAct(async () => { fireEvent.click(button(utils, /^Yes$/)); await drain(); });
        await domAct(async () => { fireEvent.click(button(utils, /Review resolve/i)); await drain(); });
        await domAct(async () => { fireEvent.click(utils.getByTestId('confirm-approve')); await drain(); });

        const receipt = utils.getByTestId('oracle-result');
        expect(receipt.textContent).not.toMatch(/Result sent/);
        expect(receipt.textContent).toMatch(/waiting in the\s+queued-transactions banner/i);
        expect(receipt.textContent).not.toMatch(/automatically/i);
        expect(receipt.textContent).toContain('#2343');
    });

    it('reports a cancel as a refund rather than as a payout', async () => {
        const { messaging } = harness();
        const utils = await openConsole(messaging);

        await domAct(async () => { fireEvent.click(button(utils, /Cancel and refund/i)); await drain(); });
        await domAct(async () => { fireEvent.click(button(utils, /Review cancel/i)); await drain(); });
        await domAct(async () => { fireEvent.click(utils.getByTestId('confirm-approve')); await drain(); });

        const receipt = utils.getByTestId('oracle-result');
        expect(receipt.textContent).toContain('dec0ded1');
        expect(receipt.textContent).toMatch(/refunded in full/i);
        expect(receipt.textContent).not.toMatch(/paid out/i);
    });
});
