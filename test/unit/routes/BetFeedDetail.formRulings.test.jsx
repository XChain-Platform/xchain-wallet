// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The place-bet form follows the form rulings: it starts with From, the
// read-only own-address field whose picker stays on the market's network;
// the main action is the one green button and names what it does (Place bet)
// with an icon; field explanations live in help tips; every button carries
// an icon.

import { describe, it, expect, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const SECOND = 'bc1qsecondsecondsecondsecondsecondsecondx';
const ORACLE = 'bc1qoracleoracleoracleoracleoracleoraclex';

const FEED = Object.freeze({
    action_index: '730010', source: ORACLE, label: 'Will it ship?', outcomes: 'Yes,No', tick: 'EXAMPLE', fee: '2.5',
    deadline: Math.floor(Date.now() / 1000) + 86400, expire_at: Math.floor(Date.now() / 1000) + 172800,
    feed_status: 'open', pools: [{ outcome: 0, pool: '150', bet_count: 2 }], timeline: [{ status: 'open', block_index: 4217 }],
});

const ADDRS = [
    { id: 'a0', address: OWN, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' },
    { id: 'a1', address: SECOND, publicKey: '02bb', derivationPath: "m/84'/0'/0'/0/1", source: 'hd' },
];

function harness(walletMode = 'full') {
    const getAddressBalances = vi.fn((chainId, address) => Promise.resolve({
        tokens: [{
            tick: 'EXAMPLE',
            divisibility: 3,
            quantity: address === OWN ? '123456' : '789',
        }],
    }));
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: ADDRS }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: { id: 'a0', address: OWN } }),
        getSettings: () => Promise.resolve({ walletMode }),
        getTokenInfo: () => Promise.resolve({ tick: 'EXAMPLE', divisibility: 3 }),
        getAddressBalances,
        betFeed: () => Promise.resolve({ data: [FEED] }),
        bets: () => Promise.resolve({ data: [] }),
    };
    return new Proxy(target, { get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); } });
}

async function drain(rounds = 24) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function openMarket(walletMode) {
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: harness(walletMode) },
            React.createElement(BetFeedDetail, { walletId: 'w', chainId: CHAIN, feedIndex: '730010', onBack() {} }),
        ));
        await drain();
    });
    return utils;
}

const buttons = (utils) => [...utils.container.querySelectorAll('button')];
const named = (utils, re) => buttons(utils).find((b) => re.test((b.getAttribute('aria-label') || b.textContent).trim()));
const isInfoTrigger = (b) => b.getAttribute('aria-describedby') && b.textContent.trim() === '?';

describe('Place a bet form rulings', () => {
    it('starts the bet form with the From field, ahead of the outcome picker', async () => {
        const utils = await openMarket();
        const form = utils.container.querySelector('form[aria-label="Place a bet"]') || utils.container.querySelector('form');
        const from = form.querySelector('input[readonly]');
        expect([OWN, SECOND]).toContain(from.value);
        const group = form.querySelector('[role="group"][aria-label="Outcome to back"]');
        expect(Boolean(from.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
        expect(named(utils, /^Choose source address$/)).toBeTruthy();
    });

    it('opens the own-address picker and bets from the picked address', async () => {
        const utils = await openMarket();
        const start = utils.container.querySelector('form input[readonly]').value;
        const other = start === OWN ? SECOND : OWN;
        await domAct(async () => { fireEvent.click(named(utils, /^Choose source address$/)); await drain(); });
        const row = await (async () => {
            for (let i = 0; i < 20; i += 1) {
                const hit = buttons(utils).find((b) => (b.textContent || '').includes(other.slice(-6)));
                if (hit) return hit;
                await domAct(async () => { await drain(); });
            }
            return null;
        })();
        expect(row).toBeTruthy();
        await domAct(async () => { fireEvent.click(row); await drain(); });
        const from = utils.container.querySelector('form input[readonly]');
        expect(from.value).toBe(other);
        expect(await utils.findByText('0.789 EXAMPLE available')).toBeTruthy();
        fireEvent.click(utils.getByRole('button', { name: /max available amount/i }));
        expect(utils.getByLabelText('Stake (EXAMPLE)')).toHaveValue('0.789');
    });

    it('uses the stake token divisibility and the From address balance', async () => {
        const utils = await openMarket();
        expect(await utils.findByText('123.456 EXAMPLE available')).toBeTruthy();
        const stake = utils.getByLabelText('Stake (EXAMPLE)');
        const max = utils.getByRole('button', { name: /max available amount/i });
        expect(max).toBeEnabled();
        fireEvent.click(max);
        expect(stake).toHaveValue('123.456');

        fireEvent.change(stake, { target: { value: '1.2345' } });
        expect(utils.getByText('Amount can have at most 3 decimal places.')).toBeTruthy();
        expect(stake).toHaveValue('123.456');
    });

    it('makes Place bet the one green action with an icon', async () => {
        const utils = await openMarket();
        const main = named(utils, /^Place bet$/);
        expect(main).toBeTruthy();
        expect(main.className).toMatch(/success/);
        expect(main.querySelector('svg')).toBeTruthy();
        expect(buttons(utils).filter((b) => /success/.test(b.className))).toHaveLength(1);
    });

    it('keeps the watcher build green with an icon', async () => {
        const utils = await openMarket('watcher');
        const main = named(utils, /^Create unsigned transaction$/);
        expect(main.className).toMatch(/success/);
        expect(main.querySelector('svg')).toBeTruthy();
    });

    it('carries field help in tips and drops the static line under the form', async () => {
        const utils = await openMarket();
        const tips = [...utils.container.querySelectorAll('[role="tooltip"]')].map((t) => t.textContent);
        expect(tips.some((t) => /cannot be cancelled or moved/.test(t))).toBe(true);
        expect(tips.some((t) => /receives any payout/.test(t))).toBe(true);
        expect(tips.some((t) => /splits the whole pot/.test(t))).toBe(true);
        const shown = [...utils.container.querySelectorAll('p')].filter((p) => !p.closest('[role="tooltip"]'));
        expect(shown.some((p) => /^Once confirmed, a bet cannot be cancelled/.test(p.textContent.trim()))).toBe(false);
    });

    it('gives every button in the bet form an icon', async () => {
        const utils = await openMarket();
        const form = utils.container.querySelector('form');
        for (const b of form.querySelectorAll('button')) {
            if (isInfoTrigger(b)) continue;
            if (/max available amount/i.test(b.getAttribute('aria-label') || '')) continue;
            expect(b.querySelector('svg'), `button "${(b.getAttribute('aria-label') || b.textContent).trim()}"`).toBeTruthy();
        }
    });
});
