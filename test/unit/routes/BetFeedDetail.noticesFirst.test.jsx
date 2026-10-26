// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every notice is the first item of the page content. The market page drew the
// place-bet error, and in a demo wallet the demo note, in the middle of the page
// under the market's terms and pool split, where a phone tapping Review bet
// from the bottom of the form never saw them.

import { describe, it, expect, afterEach } from 'vitest';
import { render, act as domAct } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { markDemoWallet, clearDemoWalletId } from '../../../packages/core/src/flows/demoMode.js';

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

function harness() {
    const target = {
        getAddressesByChain: () => Promise.resolve({
            [CHAIN]: [{ id: 'a0', address: OWN, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        betFeed: () => Promise.resolve({ data: [FEED] }),
        bets: () => Promise.resolve({ data: [] }),
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function openMarket(walletId) {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging: harness() },
                React.createElement(BetFeedDetail, { walletId, chainId: CHAIN, feedIndex: '730010', onBack() {} }),
            ),
        );
        await drain();
    });
    return utils;
}

function precedes(a, b) {
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

afterEach(() => {
    clearDemoWalletId();
});

describe('Market page notices', () => {
    it('shows the place-bet error before the market terms', async () => {
        const utils = await openMarket('w');
        const review = Array.from(utils.container.querySelectorAll('button'))
            .find((b) => /Review bet/.test(b.textContent || ''));
        await domAct(async () => {
            review.click();
            await drain();
        });
        const alert = utils.container.querySelector('[role="alert"]');
        const heading = utils.container.querySelector('h2');
        expect(alert).toBeTruthy();
        expect(alert.textContent).toContain('Choose an outcome');
        expect(precedes(alert, heading)).toBe(true);
    });

    it('shows the demo note once, before the market terms', async () => {
        markDemoWallet('demo-wallet');
        const utils = await openMarket('demo-wallet');
        const notes = utils.container.querySelectorAll('[data-variant]');
        expect(notes.length).toBe(1);
        expect(precedes(notes[0], utils.container.querySelector('h2'))).toBe(true);
        expect(notes[0].textContent).toMatch(/demo/i);
    });
});
