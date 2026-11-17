// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The bet market's Bet tab as one outcome list (operator ruling 2026-11-13):
// every outcome a row in one list card, led by a thumb (Yes, No) or a letter
// on its own colour, with its amount staked, a share fill, its chance and a
// chevron; the row opens Place Bet for that outcome. Activity leads each bet
// with the same mark, round. The list is drawn from the market's OUTCOMES,
// so any number of outcomes works, and it adds no reads.

import { afterEach, describe, expect, it } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { outcomeMarkOf } from '../../../packages/core/src/shared/routes/OutcomeList.jsx';

afterEach(() => {
    cleanup();
    resetWalletModes();
});

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const ORACLE = 'bc1qoracleoracleoracleoracleoracleoraclex';
const NOW = Math.floor(Date.now() / 1000);
const ADDRESS = { id: 'a0', address: OWN, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' };

const BASE = {
    source: ORACLE, tick: 'XCHAIN', fee: '1.5', timestamp: NOW - 10 * 86400,
    deadline: NOW + 6 * 86400, expire_at: NOW + 20 * 86400, feed_status: 'open',
    timeline: [{ status: 'open', block_index: 4217 }],
};

const YES_NO = Object.freeze({
    ...BASE,
    action_index: '700094',
    label: 'Will the screen review sample pass every wallet size?',
    outcomes: 'Yes,No',
    pools: [{ outcome: 0, pool: '783.5', bet_count: 26 }, { outcome: 1, pool: '561.5', bet_count: 19 }],
});

const TEMPERATURES = ['Under 65°F', '65 to 70°F', '70 to 75°F', '75 to 80°F', '80°F or more'];
const LA_HIGH = Object.freeze({
    ...BASE,
    action_index: '700130',
    label: 'What will the high be in Los Angeles today?',
    outcomes: TEMPERATURES.join(','),
    pools: [
        { outcome: 0, pool: '107', bet_count: 6 },
        { outcome: 1, pool: '295', bet_count: 14 },
        { outcome: 2, pool: '549', bet_count: 22 },
        { outcome: 3, pool: '281', bet_count: 13 },
        { outcome: 4, pool: '107', bet_count: 6 },
    ],
});

const bet = (n, outcome, amount, source = 'bc1qsomeoneelse') => ({
    action_index: 9000 + n, outcome, amount, source, timestamp: NOW - n * 3600, bet_status: 'open',
});
const YES_NO_BETS = [bet(1, 0, '50'), bet(2, 1, '120'), bet(3, 0, '25', OWN)];
const LA_BETS = [bet(1, 0, '10'), bet(2, 1, '20'), bet(3, 2, '40'), bet(4, 3, '30'), bet(5, 4, '15')];

async function drain(rounds = 30) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function press(element) {
    await domAct(async () => {
        fireEvent.click(element);
        await drain();
    });
}

/** A messaging stub that counts every read the page makes, by method. */
function betMessaging(feed, bets) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: () => Promise.resolve({}),
        listWallets: () => Promise.resolve([{ id: 'w', name: 'W', walletMode: 'full' }]),
        getTokenInfo: () => Promise.resolve({ tick: 'XCHAIN', divisibility: 8 }),
        betFeed: () => Promise.resolve({ data: [feed] }),
        bets: () => Promise.resolve({ data: bets }),
        composeBetForConfirm: () => new Promise(() => {}),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (typeof prop !== 'string') return t[prop];
            const fn = prop in t ? t[prop] : () => Promise.resolve({});
            return (...args) => {
                calls.push(prop);
                return fn(...args);
            };
        },
    });
    return { messaging, calls };
}

async function openMarket(feed, bets) {
    const { messaging, calls } = betMessaging(feed, bets);
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BetFeedDetail walletId="w" chainId={CHAIN} feedIndex={feed.action_index} onBack={() => {}} />
            </MessagingProvider>,
        );
        await drain();
    });
    return { utils, calls };
}

const outcomeList = () => screen.getByRole('list', { name: 'Outcome to back' });
const rows = () => within(outcomeList()).getAllByRole('button');
const marks = (root) => [...root.querySelectorAll('[data-outcome-mark]')].map((m) => ({
    mark: m.getAttribute('data-outcome-mark'),
    tone: m.getAttribute('data-outcome-tone'),
}));

describe('the Bet tab outcome list', () => {
    it('draws Yes and No as one list of two rows, each led by its thumb', async () => {
        await openMarket(YES_NO, YES_NO_BETS);
        const panel = screen.getByRole('tabpanel', { name: 'Bet' });

        // One list card, one list item per outcome, no side-by-side boxes.
        expect(within(panel).getAllByRole('list')).toHaveLength(1);
        expect(within(outcomeList()).getAllByRole('listitem')).toHaveLength(2);
        expect(panel.querySelector('[data-outcome-buttons]')).toBeNull();

        expect(marks(outcomeList())).toEqual([
            { mark: 'thumbs-up', tone: 'yes' },
            { mark: 'thumbs-down', tone: 'no' },
        ]);
        // Each thumb is the kit icon (an svg), not a letter.
        for (const m of outcomeList().querySelectorAll('[data-outcome-mark]')) {
            expect(m.querySelector('svg')).not.toBeNull();
            expect(m.textContent).toBe('');
        }
        // The name, its stake under it, the whole-percent chance and a chevron.
        expect(rows().map((r) => r.textContent)).toEqual(['Yes783.5 XCHAIN staked58%', 'No561.5 XCHAIN staked42%']);
        for (const r of rows()) expect(r.querySelectorAll('svg')).toHaveLength(2);

        // No tap hint under the list (as on a poll's Vote tab, 2026-11-15); the
        // wallet's own holding still follows it.
        expect(within(panel).queryByText(/Tap an outcome/)).toBeNull();
        expect(panel.querySelector('[data-bet-tap-hint]')).toBeNull();
        const held = within(panel).getByText((_, el) => el?.tagName === 'P' && /^You hold/.test(el.textContent));
        expect(held.textContent).toBe('You hold 25 XCHAIN on Yes');
        expect(outcomeList().compareDocumentPosition(held) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('fills each row to its exact share of the pool, decoratively', async () => {
        await openMarket(YES_NO, YES_NO_BETS);
        const fills = [...outcomeList().querySelectorAll('[data-outcome-fill]')];
        expect(fills).toHaveLength(2);
        // 783.5 of 1345 is 58.25%; the label rounds, the fill does not.
        expect(fills.map((f) => f.style.width)).toEqual(['58.2528%', '41.7472%']);
        for (const f of fills) expect(f.getAttribute('aria-hidden')).toBe('true');
        // The fill sits beside the row button, not inside its name.
        for (const f of fills) expect(f.closest('button')).toBeNull();
    });

    it('draws a five-outcome market as five lettered rows, each on its own colour', async () => {
        await openMarket(LA_HIGH, LA_BETS);
        expect(within(outcomeList()).getAllByRole('listitem')).toHaveLength(5);
        expect(marks(outcomeList())).toEqual([
            { mark: 'A', tone: 'p0' },
            { mark: 'B', tone: 'p1' },
            { mark: 'C', tone: 'p2' },
            { mark: 'D', tone: 'p3' },
            { mark: 'E', tone: 'p4' },
        ]);
        expect(rows().map((r) => r.querySelector('[data-outcome-mark]').textContent)).toEqual(['A', 'B', 'C', 'D', 'E']);
        expect(rows().map((r) => r.textContent)).toEqual([
            'AUnder 65°F107 XCHAIN staked8%',
            'B65 to 70°F295 XCHAIN staked22%',
            'C70 to 75°F549 XCHAIN staked41%',
            'D75 to 80°F281 XCHAIN staked21%',
            'E80°F or more107 XCHAIN staked8%',
        ]);
    });

    it('opens the bet flow for the outcome of each row', async () => {
        await openMarket(LA_HIGH, LA_BETS);
        for (let i = 0; i < TEMPERATURES.length; i += 1) {
            expect(rows()[i]).toBeEnabled();
            await press(rows()[i]);
            const form = screen.getByRole('form', { name: 'Place Bet' });
            const picker = within(form).getByRole('button', { name: /^Outcome: / });
            expect(picker.getAttribute('aria-label')).toBe(`Outcome: ${TEMPERATURES[i]}`);
            await press(screen.getByRole('button', { name: 'Back to previous screen' }));
            expect(screen.queryByRole('form', { name: 'Place Bet' })).toBeNull();
        }
    });

    it('names each row by its outcome, chance and stake', async () => {
        await openMarket(YES_NO, YES_NO_BETS);
        expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual([
            'Bet on Yes, 58 percent, 783.5 XCHAIN staked',
            'Bet on No, 42 percent, 561.5 XCHAIN staked',
        ]);
        expect(screen.getByRole('button', { name: 'Bet on Yes, 58 percent, 783.5 XCHAIN staked' })).toBeTruthy();
        // The mark and the chevron add nothing to the name.
        for (const r of rows()) {
            expect(r.querySelector('[data-outcome-mark]').getAttribute('aria-hidden')).toBe('true');
        }
        cleanup();

        await openMarket(LA_HIGH, LA_BETS);
        expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual([
            'Bet on Under 65°F, 8 percent, 107 XCHAIN staked',
            'Bet on 65 to 70°F, 22 percent, 295 XCHAIN staked',
            'Bet on 70 to 75°F, 41 percent, 549 XCHAIN staked',
            'Bet on 75 to 80°F, 21 percent, 281 XCHAIN staked',
            'Bet on 80°F or more, 8 percent, 107 XCHAIN staked',
        ]);
    });

    it('shows no chance and no fill on a market nothing has been staked on yet', async () => {
        await openMarket({ ...YES_NO, pools: [] }, []);
        expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual([
            'Bet on Yes, 0 XCHAIN staked',
            'Bet on No, 0 XCHAIN staked',
        ]);
        expect(rows().map((r) => r.textContent)).toEqual(['Yes0 XCHAIN staked', 'No0 XCHAIN staked']);
        expect([...outcomeList().querySelectorAll('[data-outcome-fill]')].map((f) => f.style.width)).toEqual(['0%', '0%']);
    });

    it('adds no reads: a five-outcome market costs what a two-outcome one does', async () => {
        const two = await openMarket(YES_NO, YES_NO_BETS);
        const twoCalls = [...two.calls].sort();
        cleanup();
        const five = await openMarket(LA_HIGH, LA_BETS);
        const fiveCalls = [...five.calls].sort();
        expect(fiveCalls).toEqual(twoCalls);
        // One market read and one bet read, whatever the outcome count.
        expect(fiveCalls.filter((c) => c === 'betFeed')).toHaveLength(1);
        expect(fiveCalls.filter((c) => c === 'bets')).toHaveLength(1);
    });
});

describe('the Activity tab outcome marks', () => {
    it('leads each Yes or No bet with a round thumb on its colour', async () => {
        await openMarket(YES_NO, YES_NO_BETS);
        await press(screen.getByRole('tab', { name: 'Activity' }));
        const activity = screen.getByRole('tabpanel', { name: 'Activity' });
        const items = [...activity.querySelectorAll('[data-outcome-activity] li')];
        // Newest first: Yes (9003), No (9002), Yes (9001).
        expect(items.map((li) => marks(li))).toEqual([
            [{ mark: 'thumbs-up', tone: 'yes' }],
            [{ mark: 'thumbs-down', tone: 'no' }],
            [{ mark: 'thumbs-up', tone: 'yes' }],
        ]);
        for (const li of items) {
            const mark = li.querySelector('[data-outcome-mark]');
            expect(mark.className).toMatch(/markRound/);
            expect(mark.closest('[aria-hidden="true"]')).not.toBeNull();
        }
        // The rest of the row stays: the outcome's name and the amount.
        expect(items[0].textContent).toMatch(/^Yes25 XCHAIN/);
    });

    it('leads each other bet with its outcome letter, and an unknown outcome with a question mark', async () => {
        await openMarket(LA_HIGH, [...LA_BETS, bet(6, 9, '5')]);
        await press(screen.getByRole('tab', { name: 'Activity' }));
        const activity = screen.getByRole('tabpanel', { name: 'Activity' });
        const items = [...activity.querySelectorAll('[data-outcome-activity] li')];
        // Newest (highest action index) first, so the unknown outcome leads.
        expect(items.map((li) => marks(li)[0])).toEqual([
            { mark: '?', tone: 'unknown' },
            { mark: 'E', tone: 'p4' },
            { mark: 'D', tone: 'p3' },
            { mark: 'C', tone: 'p2' },
            { mark: 'B', tone: 'p1' },
            { mark: 'A', tone: 'p0' },
        ]);
    });
});

describe('outcomeMarkOf', () => {
    it('finds Yes and No by their labels, wherever they sit, and letters the rest by place', () => {
        expect(outcomeMarkOf(['No', 'Yes'], 0)).toEqual({ tone: 'no', letter: '' });
        expect(outcomeMarkOf(['No', 'Yes'], 1)).toEqual({ tone: 'yes', letter: '' });
        expect(outcomeMarkOf([' YES ', 'no'], 0).tone).toBe('yes');
        expect(outcomeMarkOf(['Yes', 'No', 'Void'], 2)).toEqual({ tone: 2, letter: 'C' });
        // Sixteen outcomes (BET's ceiling) run A to P, the palette's eight hues twice.
        const sixteen = Array.from({ length: 16 }, (_, i) => `Range ${i}`);
        expect(sixteen.map((_, i) => outcomeMarkOf(sixteen, i).letter).join('')).toBe('ABCDEFGHIJKLMNOP');
        expect(outcomeMarkOf(sixteen, 9).tone).toBe(1);
        expect(outcomeMarkOf(['Yes', 'No'], 2)).toEqual({ tone: 'unknown', letter: '?' });
        expect(outcomeMarkOf(['Yes', 'No'], 'x')).toEqual({ tone: 'unknown', letter: '?' });
    });
});
