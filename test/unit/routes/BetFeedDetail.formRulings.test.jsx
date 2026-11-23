// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The market page by ruling, the same as a poll: the page is information,
// and the Bet tab holds only the outcome choice (each side with its share)
// and one green Bet button. Bet opens the Buy a position step, a Form Standard
// form (From, the bet with the outcome and the stake, Memo, Network fee,
// Buy a position) in the same route; Back returns to the market with the outcome
// kept. Field explanations live in help tips and every button carries an icon.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act as domAct, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { selectOption } from '../../helpers/selectOption.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

afterEach(() => { resetWalletModes(); });
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
const ORACLE_ADDR = { id: 'ao', address: ORACLE, publicKey: '02cc', derivationPath: "m/84'/0'/0'/0/2", source: 'hd' };

function harness(walletMode = 'full', { addresses = ADDRS, active = 'a0', feed = FEED, balanceShape = null } = {}) {
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    const calls = { compose: [] };
    const getAddressBalances = vi.fn((chainId, address) => Promise.resolve(balanceShape || {
        tokens: [{
            tick: 'EXAMPLE',
            divisibility: 3,
            quantity: address === OWN ? '123456' : '789',
        }],
    }));
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: addresses }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: { id: active } }),
        getSettings: () => Promise.resolve({}),
        listWallets: () => Promise.resolve([{ id: 'w', name: 'W', walletMode }]),
        getTokenInfo: () => Promise.resolve({ tick: 'EXAMPLE', divisibility: 3 }),
        getAddressBalances,
        betFeed: () => Promise.resolve({ data: [feed] }),
        bets: () => Promise.resolve({ data: [] }),
        composeBetForConfirm: (args) => {
            calls.compose.push(args);
            return new Promise(() => {});
        },
    };
    const messaging = new Proxy(target, { get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); } });
    return { messaging, calls };
}

async function drain(rounds = 24) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function openMarket(walletMode, options) {
    const { messaging, calls } = harness(walletMode, options);
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(BetFeedDetail, { walletId: 'w', chainId: CHAIN, feedIndex: '730010', onBack() {} }),
        ));
        await drain();
    });
    // The page opens on Details; the outcome choice is on the Bet tab.
    await domAct(async () => {
        fireEvent.click(utils.getByRole('tab', { name: 'Buy' }));
        await drain();
    });
    utils.calls = calls;
    return utils;
}

async function press(element, rounds) {
    await domAct(async () => {
        fireEvent.click(element);
        await drain(rounds);
    });
}

// Tap an outcome's row on the Bet tab, which opens the Buy a position step with
// it chosen.
async function openPlaceBet(utils, outcome = 'No') {
    await press(within(utils.getByRole('list', { name: 'Outcome to back' })).getByRole('button', { name: new RegExp(`^Buy ${outcome},`) }));
    return utils.getByRole('form', { name: 'Buy a position' });
}

const buttons = (root) => [...root.querySelectorAll('button')];
const isInfoTrigger = (b) => b.getAttribute('aria-describedby') && b.textContent.trim() === '?';
const sectionTitles = (root) => [...root.querySelectorAll('[data-form-section-title]')].map((el) => el.textContent);
// Buy a position's outcome is a themed dropdown; its trigger is named
// "Outcome: <chosen outcome>".
const outcomeTrigger = (utils) => within(utils.getByRole('form', { name: 'Buy a position' }))
    .getByRole('button', { name: /^Outcome: / });
const pressed = (utils) => [outcomeTrigger(utils).getAttribute('aria-label').replace(/^Outcome: /, '')];

describe('Bet tab', () => {
    it('holds only one list row per outcome, with no pick list and no Bet button', async () => {
        const utils = await openMarket();
        const panel = utils.getByRole('tabpanel', { name: 'Buy' });

        const sides = within(within(panel).getByRole('list', { name: 'Outcome to back' })).getAllByRole('button');
        // Each row names its outcome, chance and stake; No has no positions yet.
        expect(sides.map((b) => b.getAttribute('aria-label'))).toEqual([
            'Buy Yes, 100 percent, 150 EXAMPLE total',
            'Buy No, 0 percent, 0 EXAMPLE total',
        ]);
        sides.forEach((side) => expect(side).toBeEnabled());
        expect(sides.map((b) => b.getAttribute('aria-pressed'))).toEqual([null, null]);
        expect(within(panel).queryByRole('button', { name: 'Buy' })).toBeNull();
        expect(buttons(utils.container).filter((b) => /success/.test(b.className))).toEqual([]);

        // No From, no stake, no form on the information page.
        expect(panel.querySelector('form')).toBeNull();
        expect(panel.querySelector('input')).toBeNull();
        expect(within(panel).queryByRole('button', { name: 'Choose source address' })).toBeNull();
        expect(within(panel).queryByRole('button', { name: 'Buy a position' })).toBeNull();
    });

    it('never asks for an outcome: tapping one opens Buy a position with it chosen', async () => {
        const utils = await openMarket();
        expect(utils.queryByText(/Choose an outcome/i)).toBeNull();
        expect(utils.queryByRole('alert')).toBeNull();

        await openPlaceBet(utils, 'Yes');
        expect(utils.getByRole('heading', { level: 1, name: 'Buy a Position' })).toBeTruthy();
        expect(pressed(utils)).toEqual(['Yes']);
        expect(utils.queryByText(/Choose an outcome/i)).toBeNull();
        expect(utils.calls.compose).toHaveLength(0);
    });

    it('shows why the market owner cannot bet, with no Bet button', async () => {
        const utils = await openMarket('full', { addresses: [ORACLE_ADDR, ...ADDRS], active: 'ao' });
        const panel = utils.getByRole('tabpanel', { name: 'Buy' });

        expect(within(panel).getByText(/^You run this market, so you cannot buy a position in it\./)).toBeTruthy();
        expect(within(panel).queryByRole('button', { name: 'Buy' })).toBeNull();
        expect(within(panel).queryByRole('list', { name: 'Outcome to back' })).toBeNull();
        // The From field stays so the wallet can switch to another address.
        expect(within(panel).getByDisplayValue(ORACLE)).toBeTruthy();
    });
});

describe('Bet opens Buy a position', () => {
    it('opens the Form Standard step with the outcome carried', async () => {
        const utils = await openMarket();
        const form = await openPlaceBet(utils, 'No');

        expect(utils.getByRole('heading', { level: 1, name: 'Buy a Position' })).toBeTruthy();
        expect(utils.queryByRole('tablist')).toBeNull();
        expect(sectionTitles(form)).toEqual(['From', 'Buy', 'Memo', 'Advanced', 'Speed and Fees']);
        expect(utils.getByRole('button', { name: /^Buy\b/, expanded: true })).toBeTruthy();
        expect(utils.getByRole('button', { name: /^From\b/, expanded: false })).toBeTruthy();
        expect(utils.getByRole('button', { name: /^Memo\b/, expanded: false })).toBeTruthy();
        expect(utils.getByRole('button', { name: /^Speed and Fees\b/, expanded: false })).toBeTruthy();
        expect(pressed(utils)).toEqual(['No']);
        expect(within(form).getByText('Will it ship?')).toBeTruthy();
        expect(within(form).getByDisplayValue(OWN)).toBeTruthy();
        expect(form.querySelectorAll('button[type="submit"]')).toHaveLength(1);
        const place = form.querySelector('button[type="submit"]');
        expect(place).toHaveAccessibleName('Buy No');
        expect(place.className).toMatch(/success/);
        expect(place.querySelector('svg')).not.toBeNull();
        // The confirm screen asks for the password; the form carries none.
        expect(utils.queryByLabelText('Password')).toBeNull();
    });

    it('lets the outcome change in the step and Back keeps it', async () => {
        const utils = await openMarket();
        await openPlaceBet(utils, 'No');
        await domAct(async () => { selectOption(outcomeTrigger(utils), { value: '0' }); await drain(); });
        expect(pressed(utils)).toEqual(['Yes']);

        await press(utils.getByRole('button', { name: 'Back to previous screen' }));
        expect(utils.getByRole('heading', { level: 1, name: 'Market' })).toBeTruthy();
        expect(utils.getByRole('tab', { name: 'Buy' })).toHaveAttribute('aria-selected', 'true');
        expect(utils.queryByRole('form', { name: 'Buy a position' })).toBeNull();

        // Tapping an outcome again opens the step with that outcome.
        await openPlaceBet(utils, 'No');
        expect(pressed(utils)).toEqual(['No']);
    });

    it('validates the stake before composing and reopens the Bet section', async () => {
        const utils = await openMarket();
        const form = await openPlaceBet(utils, 'Yes');
        // Close the Bet section, so the error has to reopen it.
        await press(utils.getByRole('button', { name: /^Buy\b/, expanded: true }));
        await press(form.querySelector('button[type="submit"]'));

        expect(utils.getByLabelText('Form errors')).toHaveTextContent('Enter a positive position amount using digits and an optional decimal point.');
        expect(utils.getByRole('button', { name: /^Buy\b/, expanded: true })).toBeTruthy();
        expect(utils.calls.compose).toHaveLength(0);
    });

    it('composes the carried outcome, stake and memo through the BET builder', async () => {
        const utils = await openMarket();
        const form = await openPlaceBet(utils, 'No');
        fireEvent.change(utils.getByLabelText('Amount (EXAMPLE)'), { target: { value: '12' } });
        await press(utils.getByRole('button', { name: /^Memo\b/, expanded: false }));
        fireEvent.change(within(form).getByRole('textbox', { name: 'Memo' }), { target: { value: 'gl' } });
        await press(form.querySelector('button[type="submit"]'), 60);

        expect(utils.calls.compose).toHaveLength(1);
        expect(utils.calls.compose[0].builder).toBe('placeBetParams');
        expect(utils.calls.compose[0].params).toEqual({
            feedActionIndex: '730010', outcome: 1, amount: '12', outcomes: ['Yes', 'No'], memo: 'gl',
        });
        expect(utils.calls.compose[0].feePerKb).toBe(6_000);
    });

    it('forwards a selected Fast fee rate to the transaction compose', async () => {
        const utils = await openMarket();
        const form = await openPlaceBet(utils, 'Yes');
        fireEvent.change(utils.getByLabelText('Amount (EXAMPLE)'), { target: { value: '12' } });
        await press(utils.getByRole('button', { name: /^Speed and Fees\b/, expanded: false }));
        await press(utils.container.querySelector('button[aria-label="Fast"]'));
        expect(utils.getByRole('slider', { name: 'Network fee' })).toHaveAttribute(
            'aria-valuetext', expect.stringMatching(/^Fast: /),
        );

        await press(form.querySelector('button[type="submit"]'), 60);
        expect(utils.calls.compose).toHaveLength(1);
        expect(utils.calls.compose[0].feePerKb).toBe(12_000);
    });
});

describe('Market header and the outcome dropdown', () => {
    const MULTI = Object.freeze({
        ...FEED,
        label: 'Who wins the derby?',
        outcomes: 'Northfield,Harbor City,Eastgate',
        pools: [{ outcome: 0, pool: '100', bet_count: 1 }, { outcome: 1, pool: '50', bet_count: 1 }],
    });

    it('draws no oracle line in the header', async () => {
        const utils = await openMarket();
        const stats = utils.container.querySelector('[data-bet-hero-stats]');
        expect(stats).not.toBeNull();
        expect(stats.textContent).toMatch(/Total/);
        expect(stats.textContent).not.toMatch(/Oracle/i);
        expect(stats.textContent).not.toContain(ORACLE);
        expect(utils.container.querySelector('[data-bet-hero-stats]').parentElement.textContent).not.toMatch(/Oracle:/);
    });

    it('opens Buy a position with the tapped outcome already chosen', async () => {
        const utils = await openMarket('full', { feed: MULTI });
        await openPlaceBet(utils, 'Harbor City');
        expect(utils.getByRole('heading', { level: 1, name: 'Buy a Position' })).toBeTruthy();
        expect(pressed(utils)).toEqual(['Harbor City']);
        expect(utils.calls.compose).toHaveLength(0);
    });

    it('shows the outcome as a dropdown holding every option, never a segmented control', async () => {
        const utils = await openMarket('full', { feed: MULTI });
        const form = await openPlaceBet(utils, 'Eastgate');
        expect(form.querySelector('[role="group"][aria-label="Outcome to back"]')).toBeNull();

        const trigger = outcomeTrigger(utils);
        expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
        await domAct(async () => { fireEvent.click(trigger); await drain(); });
        const options = [...document.getElementById(trigger.getAttribute('aria-controls')).querySelectorAll('[role="option"]')];
        expect(options.map((o) => o.getAttribute('data-value'))).toEqual(['0', '1', '2']);
        expect(options.map((o) => o.textContent)).toEqual([
            expect.stringContaining('Northfield'), expect.stringContaining('Harbor City'), expect.stringContaining('Eastgate'),
        ]);
        expect(options.every((o) => o.querySelector('svg'))).toBe(true);

        await domAct(async () => { fireEvent.click(options[0]); await drain(); });
        expect(pressed(utils)).toEqual(['Northfield']);
    });
});

describe('Buy a position form rulings', () => {
    it('opens the own-address picker and bets from the picked address', async () => {
        const utils = await openMarket();
        await openPlaceBet(utils);
        await press(utils.getByRole('button', { name: /^From\b/ }));
        await press(utils.getByRole('button', { name: 'Choose source address' }));
        const row = await (async () => {
            for (let i = 0; i < 20; i += 1) {
                const hit = buttons(utils.container).find((b) => (b.textContent || '').includes(SECOND.slice(-6)));
                if (hit) return hit;
                await domAct(async () => { await drain(); });
            }
            return null;
        })();
        expect(row).toBeTruthy();
        await press(row);
        expect(utils.getByRole('heading', { level: 1, name: 'Buy a Position' })).toBeTruthy();
        expect(utils.getByDisplayValue(SECOND)).toBeTruthy();
        expect(await utils.findByText('0.789 EXAMPLE available')).toBeTruthy();
        fireEvent.click(utils.getByRole('button', { name: /max available amount/i }));
        expect(utils.getByLabelText('Amount (EXAMPLE)')).toHaveValue('0.789');
    });

    it('uses the stake token divisibility and the From address balance', async () => {
        const utils = await openMarket();
        await openPlaceBet(utils);
        expect(await utils.findByText('123.456 EXAMPLE available')).toBeTruthy();
        const stake = utils.getByLabelText('Amount (EXAMPLE)');
        const max = utils.getByRole('button', { name: /max available amount/i });
        expect(max).toBeEnabled();
        fireEvent.click(max);
        expect(stake).toHaveValue('123.456');

        fireEvent.change(stake, { target: { value: '1.2345' } });
        expect(utils.getByText('Amount can have at most 3 decimal places.')).toBeTruthy();
        expect(stake).toHaveValue('123.456');
    });

    it('keeps Max disabled when the token balance read is unavailable', async () => {
        const balanceShape = {
            native: { tick: 'BTC', quantity: '1', divisibility: 8 },
            tokens: [], unavailable: ['tokens'],
        };
        const utils = await openMarket('full', { balanceShape });
        await openPlaceBet(utils);
        expect(utils.queryByText(/EXAMPLE available/)).toBeNull();
        expect(utils.getByRole('button', { name: /max available amount/i })).toBeDisabled();
    });

    it('keeps the watcher build green with an icon', async () => {
        const utils = await openMarket('watcher');
        const form = await openPlaceBet(utils);
        const main = within(form).getByRole('button', { name: 'Create Unsigned Transaction' });
        expect(main.className).toMatch(/success/);
        expect(main.querySelector('svg')).toBeTruthy();
    });

    it('carries field help in tips and drops the static line under the form', async () => {
        const utils = await openMarket();
        await openPlaceBet(utils);
        const tips = [...utils.container.querySelectorAll('[role="tooltip"]')].map((t) => t.textContent);
        expect(tips.some((t) => /cannot be cancelled or moved/.test(t))).toBe(true);
        expect(tips.some((t) => /receives any payout/.test(t))).toBe(true);
        expect(tips.some((t) => /splits the whole pot/.test(t))).toBe(true);
        const shown = [...utils.container.querySelectorAll('p')].filter((p) => !p.closest('[role="tooltip"]'));
        expect(shown.some((p) => /^Once confirmed, a position cannot be cancelled/.test(p.textContent.trim()))).toBe(false);
    });

    it('gives every button in the Buy a position form an icon', async () => {
        const utils = await openMarket();
        const form = await openPlaceBet(utils);
        for (const b of form.querySelectorAll('button')) {
            if (isInfoTrigger(b)) continue;
            if (/max available amount/i.test(b.getAttribute('aria-label') || '')) continue;
            // The 25, 50, 75 and 100 percent stake chips and Max are amount shortcuts.
            if (/^(max|\d+%)$/i.test(b.textContent.trim())) continue;
            expect(b.querySelector('svg'), `button "${(b.getAttribute('aria-label') || b.textContent).trim()}"`).toBeTruthy();
        }
    });
});
