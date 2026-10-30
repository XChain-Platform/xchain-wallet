// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The market page reads its market once, at open. A market that closed or was
// cancelled while the page sat open still showed the bet form, and Review bet
// composed a bet against it: with pre-flight off or local nothing warned, and
// the bet paid the miner fee and the protocol fee and joined no pool.

import { describe, it, expect } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const ORACLE = 'bc1qoracleoracleoracleoracleoracleoraclex';

const FEED = Object.freeze({
    action_index: '730010',
    source: ORACLE,
    label: 'Will it ship?',
    outcomes: 'Yes,No',
    tick: 'EXAMPLE',
    fee: '2.5',
    min_amount: '25',
    deadline: Math.floor(Date.now() / 1000) + 86400,
    expire_at: Math.floor(Date.now() / 1000) + 172800,
    feed_status: 'open',
    pools: [{ outcome: 0, pool: '150', bet_count: 2 }],
    timeline: [{ status: 'open', block_index: 4217 }],
});

function harness({ later }) {
    const calls = { compose: 0, feedReads: 0 };
    const target = {
        getAddressesByChain: () => Promise.resolve({
            [CHAIN]: [{ id: 'a0', address: OWN, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        betFeed: () => {
            calls.feedReads += 1;
            if (calls.feedReads === 1) return Promise.resolve({ data: [FEED] });
            return typeof later === 'function' ? later() : Promise.resolve({ data: [later] });
        },
        bets: () => Promise.resolve({ data: [] }),
        composeBetForConfirm: () => {
            calls.compose += 1;
            return new Promise(() => {});
        },
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return { messaging, calls };
}

async function drain(rounds = 24) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function reviewBet(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(BetFeedDetail, { walletId: 'w', chainId: CHAIN, feedIndex: '730010', onBack() {} }),
            ),
        );
        await drain();
    });
    const yes = utils.getByRole('button', { name: 'Yes' });
    await domAct(async () => { yes.click(); await drain(); });
    fireEvent.change(utils.getByLabelText(/Stake/), { target: { value: '30' } });
    const review = utils.getByRole('button', { name: /Review bet/ });
    await domAct(async () => { review.click(); await drain(); });
    return utils;
}

describe('Market page: a market that closed since the page opened', () => {
    it('refuses the bet before composing and shows the market as closed', async () => {
        const { messaging, calls } = harness({ later: { ...FEED, feed_status: 'closed' } });
        const utils = await reviewBet(messaging);
        expect(calls.compose).toBe(0);
        const alert = utils.container.querySelector('[role="alert"]');
        expect(alert?.textContent).toMatch(/no longer takes bets.*Nothing was sent/);
        expect(utils.queryByRole('button', { name: /Review bet/ })).toBeNull();
    });

    it('refuses a cancelled market too', async () => {
        const { messaging, calls } = harness({ later: { ...FEED, feed_status: 'cancelled' } });
        await reviewBet(messaging);
        expect(calls.compose).toBe(0);
    });

    it('composes when the market still reads open', async () => {
        const { messaging, calls } = harness({ later: FEED });
        await reviewBet(messaging);
        expect(calls.compose).toBe(1);
    });

    it('composes when the fresh read fails, which says nothing about the market', async () => {
        const { messaging, calls } = harness({ later: () => Promise.reject(new Error('offline')) });
        await reviewBet(messaging);
        expect(calls.compose).toBe(1);
    });
});
