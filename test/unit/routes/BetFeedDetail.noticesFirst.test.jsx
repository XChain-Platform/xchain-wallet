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
// place-bet error in the middle of the page under the market's terms and pool
// split, where a phone tapping Place bet from the bottom of the form never saw
// it. A demo wallet gets no standing notice at all (ruling 2026-11-13).

import { describe, it, expect, afterEach } from 'vitest';
import { render, act as domAct, within } from '@testing-library/react';
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
    it('asks for no outcome: the status slot sits under the outcome list, empty', async () => {
        const utils = await openMarket('w');
        // The outcome rows are on the Bet tab.
        await domAct(async () => {
            Array.from(utils.container.querySelectorAll('[role="tab"]'))
                .find((tab) => /^Buy$/.test((tab.textContent || '').trim()))
                .click();
            await drain();
        });
        const position = utils.getByRole('region', { name: 'Your position' });
        expect(within(position).getByRole('button', { name: 'Buy' })).toBeTruthy();
        expect(within(utils.getByRole('tabpanel', { name: 'Buy' })).queryByRole('button', { name: 'Buy' })).toBeNull();
        expect(utils.container.querySelectorAll('[role="alert"]')).toHaveLength(0);
        expect(utils.container.textContent).not.toMatch(/Choose an outcome/);
        const slot = utils.container.querySelector('[data-form-status]');
        expect(slot).not.toBeNull();
        expect(precedes(utils.getByRole('list', { name: 'Outcome to back' }), slot)).toBe(true);
    });

    it('shows no demo notice and keeps Bet enabled in a demo wallet', async () => {
        markDemoWallet('demo-wallet');
        const utils = await openMarket('demo-wallet');
        expect(utils.container.querySelectorAll('[data-variant]')).toHaveLength(0);
        expect(utils.container.textContent).not.toMatch(/Demo wallets can.t move funds/);
        await domAct(async () => {
            Array.from(utils.container.querySelectorAll('[role="tab"]'))
                .find((tab) => /^Buy$/.test((tab.textContent || '').trim()))
                .click();
            await drain();
        });
        // Place Bet refuses the submit; nothing disables an outcome for the demo alone.
        within(utils.getByRole('list', { name: 'Outcome to back' })).getAllByRole('button')
            .forEach((side) => expect(side).toBeEnabled());
    });
});
