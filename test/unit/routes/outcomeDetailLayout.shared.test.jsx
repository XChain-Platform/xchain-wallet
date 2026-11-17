// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The bet market and the governance poll share one page layout (Layout 1,
// "Leading Line Hero", ruled 2026-11-13): a blue chart hero when the item has
// a history to chart, else the outlined identity card (G16), then the shared tab
// strip (Bet or Vote, or Result once closed | Activity | Details), and a pick
// plus one green button that opens the item's Form Standard step. These
// tests drive that layout through both pages so the two cannot drift.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';

afterEach(() => {
    cleanup();
    resetWalletModes();
});

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const ORACLE = 'bc1qoracleoracleoracleoracleoracleoraclex';
const NOW = Math.floor(Date.now() / 1000);
const ADDRESS = { id: 'a0', address: OWN, publicKey: '02aa', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' };

const OPEN_BET = Object.freeze({
    action_index: '730010', source: ORACLE, label: 'Will BTC close above $100k on Dec 31?', outcomes: 'Yes,No',
    tick: 'EXAMPLE', fee: '2.5', timestamp: NOW - 10 * 86400,
    deadline: NOW + 12 * 86400 + 600, expire_at: NOW + 20 * 86400,
    feed_status: 'open',
    pools: [{ outcome: 0, pool: '62', bet_count: 1 }, { outcome: 1, pool: '38', bet_count: 1 }],
    timeline: [{ status: 'open', block_index: 4217 }],
});
// Two bets six days ago split the pot 58 / 42; the explorer's pools now
// read 62 / 38, so Yes has moved up 4 points over the week.
const BET_ROWS = [
    { action_index: 9001, outcome: 0, amount: '29', source: OWN, timestamp: NOW - 6 * 86400, bet_status: 'open' },
    { action_index: 9002, outcome: 1, amount: '21', source: 'bc1qsomeoneelse', timestamp: NOW - 6 * 86400 + 60, bet_status: 'open' },
];

const OPTIONS = ['Hardware wallet support', 'Faster sync', 'Address book import'];
const OPEN_POLL = Object.freeze({
    action_index: 7, tick: 'VOTE', question: 'Which wallet improvement should ship next?', options: OPTIONS,
    tally_mode: 'approval', weight_mode: 'balance', max_selections: 1, end_block: 120, poll_status: 'open',
    quorum: '0.2', source: 'bc1qcreator', block_index: 90,
});
const FINAL_POLL = Object.freeze({
    ...OPEN_POLL, poll_status: 'finalized', winning_option: 0, quorum_met: 1, total_voters: 47, total_weight: '128960',
});
const FINAL_RESULTS = [
    { option_index: 0, total_weight: '67059.2', voter_count: 25 },
    { option_index: 1, total_weight: '38688', voter_count: 14 },
    { option_index: 2, total_weight: '23212.8', voter_count: 8 },
];

async function drain(rounds = 30) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function proxy(target) {
    return new Proxy(target, { get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); } });
}

async function mount(element, messaging) {
    let utils;
    await domAct(async () => {
        utils = render(<MessagingProvider shell="web" messaging={messaging}>{element}</MessagingProvider>);
        await drain();
    });
    return utils;
}

async function press(element) {
    await domAct(async () => {
        fireEvent.click(element);
        await drain();
    });
}

function betMessaging(feed = OPEN_BET, bets = BET_ROWS) {
    return proxy({
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: () => Promise.resolve({}),
        listWallets: () => Promise.resolve([{ id: 'w', name: 'W', walletMode: 'full' }]),
        getTokenInfo: () => Promise.resolve({ tick: 'EXAMPLE', divisibility: 0 }),
        betFeed: () => Promise.resolve({ data: [feed] }),
        bets: () => Promise.resolve({ data: bets }),
        composeBetForConfirm: () => new Promise(() => {}),
    });
}

function pollMessaging({ poll = OPEN_POLL, results = null, height = 100, votes = [] } = {}) {
    return proxy({
        governancePoll: () => Promise.resolve(poll),
        governancePollResults: () => Promise.resolve({ data: results || [] }),
        getIndexerWatermark: () => Promise.resolve({ watermark: height }),
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN]: { id: ADDRESS.id } }),
        governanceVotes: () => Promise.resolve({ data: votes }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        listWallets: () => Promise.resolve([{ id: 'w', walletMode: 'full' }]),
        signerReady: () => Promise.resolve({ ready: true }),
    });
}

const openBet = (feed, bets) => mount(
    <BetFeedDetail walletId="w" chainId={CHAIN} feedIndex="730010" onBack={() => {}} />,
    betMessaging(feed, bets),
);
const openPoll = (options) => mount(
    <PollDetail walletId="w" chainId={CHAIN} pollIndex={7} onBack={() => {}} />,
    pollMessaging(options),
);

const hero = () => document.querySelector('[data-outcome-hero]');
const chips = () => [...hero().querySelectorAll('[data-outcome-chip]')].map((chip) => chip.textContent);
const lead = () => hero().querySelector('[data-outcome-lead]').textContent;
const rangeChips = () => within(hero()).getAllByRole('tab');
const sectionTabs = (name) => within(screen.getByRole('tablist', { name })).getAllByRole('tab');
const panel = () => document.querySelector('[data-outcome-panel]');

/** An Activity panel that is the row list alone: no heading, no other block. */
function expectRowsOnly(activity) {
    expect(within(activity).queryAllByRole('heading').map((h) => h.textContent)).toEqual([]);
    expect([...activity.children].map((el) => el.hasAttribute('data-outcome-activity'))).toEqual([true]);
}

/** The G16 identity card: no blue hero class, no chart, no range chips. */
function expectIdentityCard() {
    const card = hero();
    expect(card.hasAttribute('data-outcome-identity')).toBe(true);
    expect(card.hasAttribute('data-outcome-chart-hero')).toBe(false);
    expect(card.className).not.toMatch(/heroStack/);
    expect(card.closest('[class*="heroStack"]')?.className ?? null).toBeNull();
    // The chips keep their small icons; the chart is the labelled image.
    expect(card.querySelector('svg[role="img"], [data-chart-behind], [data-outcome-line]')?.outerHTML ?? null).toBeNull();
    expect(within(card).queryAllByRole('tab').map((tab) => tab.textContent)).toEqual([]);
    expect(within(card).queryByRole('tablist')?.outerHTML ?? null).toBeNull();
    for (const range of ['24h', '1W', '1M', '3M', '6M', '1Y', 'All']) {
        expect(within(card).queryByText(range)?.outerHTML ?? null).toBeNull();
    }
}

describe('the shared outcome hero', () => {
    it('draws a bet: status and closing chips, the question, the leader and its move, the pool, range chips', async () => {
        await openBet();

        expect(chips()).toEqual(['Open', 'Closes in 12 days']);
        expect(screen.getByRole('heading', { level: 2, name: 'Will BTC close above $100k on Dec 31?' })).toBeTruthy();
        expect(lead()).toBe('62%Yes▲ 4 pts 1W');
        // No oracle or its address in the header (walk note on screen 97).
        expect(hero().querySelector('[data-bet-hero-stats]').textContent).toBe('Pool 100 EXAMPLE · 2 bets');
        // A two-sided market draws the leading side alone, filled.
        expect(hero().querySelectorAll('[data-outcome-line]')).toHaveLength(1);
        expect(hero().querySelector('polygon')).not.toBeNull();
        expect(rangeChips().map((tab) => tab.textContent)).toEqual(['24h', '1W', '1M', '3M', '6M', '1Y', 'All']);
        expect(rangeChips().map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false', 'false']);
    });

    it('draws a closed bet: Settled and how long ago it closed, the winner\'s share', async () => {
        await openBet({
            ...OPEN_BET, feed_status: 'resolved', winning_outcome: 0, deadline: NOW - 2 * 86400 - 600,
        });

        expect(chips()).toEqual(['Settled', 'Closed 2 days ago']);
        expect(lead()).toBe('62%Yes▲ 4 pts 1W');
    });

    it('draws a finalized poll with the bet hero\'s content: status and closed chips, the winner\'s share, the split bar, votes and voters, quorum (G16 surface)', async () => {
        await openPoll({
            poll: FINAL_POLL,
            results: FINAL_RESULTS,
            height: 264,
            votes: [
                { action_index: 50, source: OWN, poll_index: 7, choice: 0, share: '1', block_index: 110 },
                { action_index: 51, source: 'bc1qvoterone', poll_index: 7, choice: 1, share: '1', block_index: 111 },
            ],
        });

        expectIdentityCard();
        // Status and closing chips only, as the bet's; the token is a Details fact.
        expect(chips()).toEqual(['Decided', 'Closed 1 day ago']);
        expect(screen.getByRole('heading', { level: 2, name: 'Which wallet improvement should ship next?' })).toBeTruthy();
        // The winner's share big, its plain name, and the Final pill.
        expect(lead()).toBe('52%Hardware wallet supportFinal');
        expect(hero().querySelector('[data-outcome-lead] [aria-label="Final result"]').textContent).toBe('Final');
        // The stacked bar, a segment per option, named by the legend.
        expect([...hero().querySelectorAll('[data-outcome-segment]')].map((s) => s.style.width)).toEqual(['52%', '30%', '18%']);
        expect(hero().querySelector('[data-outcome-bar]').getAttribute('aria-hidden')).toBe('true');
        expect(within(hero()).getByRole('list', { name: 'Share of each option' }).textContent)
            .toBe('Hardware wallet support52%Faster sync30%Address book import18%');
        // Votes and voters where the bet shows pool and bets, and the
        // indexer's own quorum verdict where it shows the oracle; the row
        // carries no close-block supply, so no turnout share is drawn.
        expect(hero().querySelector('[data-poll-hero-stats]').textContent).toBe('2 votes · 47 votersQuorum 20% met');
        expect(hero().textContent).not.toMatch(/of supply/);
    });

    it('draws an open poll with "Counted at close" in place of a share, its votes and voters, and the quorum still needed', async () => {
        await openPoll();

        expectIdentityCard();
        expect(chips()).toEqual(['Open', 'Closes in 3 h']);
        expect(screen.getByRole('heading', { level: 2, name: 'Which wallet improvement should ship next?' })).toBeTruthy();
        expect(lead()).toBe('Counted at close');
        expect(hero().querySelector('[data-outcome-bar]')).toBeNull();
        // G121: the read-only votes and voters line carries no help tip.
        expect(hero().querySelector('[data-poll-hero-stats]').textContent).toBe('0 votes · 0 votersQuorum 20% of supply needed');
    });

    it('says a closed poll is being finalized, or is tied, in place of the share', async () => {
        // Past the end block, not yet finalized, no results yet.
        await openPoll({ height: 130 });
        expect(chips()[0]).toBe('Awaiting finalization');
        expect(chips()[1]).toMatch(/^Closed /);
        expect(lead()).toBe('Final results are being finalized.');
        expect(hero().querySelector('[data-outcome-bar]')).toBeNull();
        cleanup();

        await openPoll({
            height: 130,
            results: [
                { option_index: 0, total_weight: '50', voter_count: 2 },
                { option_index: 1, total_weight: '50', voter_count: 2 },
            ],
        });
        expect(lead()).toBe('Tied at the top');
        expect([...hero().querySelectorAll('[data-outcome-segment]')].map((s) => s.style.width)).toEqual(['50%', '50%']);
    });

    it('draws a market with no bet history on the same surface: its split as the share, the bar and the legend', async () => {
        await openBet(OPEN_BET, []);
        expectIdentityCard();
        expect(lead()).toBe('62%Yes');
        expect([...hero().querySelectorAll('[data-outcome-segment]')].map((s) => s.style.width)).toEqual(['62%', '38%']);
        expect(within(hero()).getByRole('list', { name: 'Chance of each outcome' }).textContent).toBe('Yes62%No38%');
    });

    it('keeps the blue chart hero for a market with bet history, and draws the identity card for one with none', async () => {
        await openBet();
        expect(hero().hasAttribute('data-outcome-chart-hero')).toBe(true);
        expect(hero().className).toMatch(/heroStack/);
        expect(hero().querySelector('[data-chart-behind]')).not.toBeNull();
        expect(hero().querySelector('svg[role="img"]')).not.toBeNull();
        expect(rangeChips()).toHaveLength(7);
        cleanup();

        // Pools but no bet rows: nothing to rebuild a history from.
        await openBet(OPEN_BET, []);
        expectIdentityCard();
        expect(chips()).toEqual(['Open', 'Closes in 12 days']);
        expect(hero().querySelector('[data-bet-hero-stats]').textContent).toBe('Pool 100 EXAMPLE · 2 bets');
    });

    it('counts an open poll\'s votes and voters from accepted ballots only, and drops the counts when the read is a full page', async () => {
        await openPoll({
            votes: [
                { action_index: 51, source: 'bc1qvoterone', poll_index: 7, choice: 0, share: '1', block_index: 101 },
                { action_index: 52, source: 'bc1qvoterone', poll_index: 7, choice: 1, share: '1', block_index: 101 },
                { action_index: 53, source: 'bc1qvotertwo', poll_index: 7, choice: 2, share: '1', block_index: 102 },
                { action_index: 54, source: 'bc1qrejected', poll_index: 7, choice: 0, share: '1', block_index: 103, status: 'invalid: balance' },
            ],
        });
        // Three accepted ballots from two addresses; the rejected one counts for nobody.
        expect(hero().querySelector('[data-poll-hero-stats]').textContent).toBe('3 votes · 2 votersQuorum 20% of supply needed');
        cleanup();

        // An approval ballot listed as a row per choice is one vote.
        await openPoll({
            poll: { ...OPEN_POLL, max_selections: 2 },
            votes: [
                { action_index: 61, source: 'bc1qvoterone', poll_index: 7, choice: 0, share: '1', block_index: 101 },
                { action_index: 61, source: 'bc1qvoterone', poll_index: 7, choice: 2, share: '1', block_index: 101 },
            ],
        });
        expect(hero().querySelector('[data-poll-hero-counts]').textContent).toBe('1 vote · 1 voter');
        cleanup();

        const page = Array.from({ length: 500 }, (_, i) => ({
            action_index: 1000 + i, source: `bc1qvoter${i}`, poll_index: 7, choice: 0, share: '1', block_index: 101,
        }));
        await openPoll({ votes: page });
        expect(hero().querySelector('[data-poll-hero-stats]').textContent).toBe('Quorum 20% of supply needed');
        expect(hero().querySelector('[data-poll-hero-counts]')).toBeNull();
    });
});

describe('the 8px rhythm around the tab row (G13)', () => {
    const cssRule = (file, selector) => {
        const css = readFileSync(file, 'utf8');
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = css.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
        return match ? match[2] : null;
    };
    const OUTCOME_CSS = 'packages/core/src/shared/components/outcomeDetail/OutcomeDetail.module.css';

    it('stacks the hero or identity card, the tab row and the panel in one column 8px apart', async () => {
        for (const open of [() => openBet(), () => openPoll()]) {
            await open();
            const stack = document.querySelector('[data-outcome-stack]');
            const children = [...stack.children];
            expect(children[0]).toBe(hero());
            expect(children[1].getAttribute('role')).toBe('tablist');
            expect(children[2]).toBe(panel());
            expect(stack.className).toMatch(/stack/);
            cleanup();
        }
        // The column's gap is the 8px space token, and nothing between the
        // three adds a margin of its own.
        expect(readFileSync('packages/core/src/ui/tokens.css', 'utf8')).toMatch(/--xc-space-2:\s*8px/);
        expect(cssRule(OUTCOME_CSS, '.stack')).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(cssRule(OUTCOME_CSS, '.panel')).not.toMatch(/margin|padding/);
        expect(cssRule(OUTCOME_CSS, '.identity')).not.toMatch(/margin/);
        expect(cssRule(OUTCOME_CSS, '.heroStack')).not.toMatch(/margin/);
        expect(cssRule('packages/core/src/ui/SegmentedControl.module.css', '.segmented')).toMatch(/margin:\s*0;/);
    });
});

describe('the shared tab strip', () => {
    it('reads Bet | Activity | Details on an open market and Result | Activity | Details once settled', async () => {
        await openBet();
        expect(sectionTabs('Market sections').map((tab) => tab.textContent)).toEqual(['Bet', 'Activity', 'Details']);
        expect(screen.getByRole('tab', { name: 'Bet' })).toHaveAttribute('aria-selected', 'true');
        expect(panel()).toHaveAttribute('data-outcome-panel', 'bet');
        cleanup();

        await openBet({ ...OPEN_BET, feed_status: 'resolved', winning_outcome: 0, deadline: NOW - 86400 });
        expect(sectionTabs('Market sections').map((tab) => tab.textContent)).toEqual(['Result', 'Activity', 'Details']);
        expect(panel()).toHaveAttribute('data-outcome-panel', 'result');
        const result = screen.getByRole('tabpanel', { name: 'Result' });
        expect(within(result).getByTestId('bet-settlement')).toHaveTextContent('Winning outcome: "Yes" (outcome 0)');
        const rows = within(screen.getByRole('region', { name: 'Final split' })).getAllByRole('listitem');
        expect(rows.map((row) => row.textContent)).toEqual([
            '0: YesWinner62.0%62 EXAMPLE, 1 bet',
            '1: No38.0%38 EXAMPLE, 1 bet',
        ]);
        expect(within(result).getByText((_, el) => el?.getAttribute('data-bet-you-bet') === '' && el.textContent === 'You bet 29 EXAMPLE on Yes')).toBeTruthy();
    });

    it('reads Vote | Activity | Details on an open poll and Result | Activity | Details once closed', async () => {
        await openPoll();
        expect(sectionTabs('Poll sections').map((tab) => tab.textContent)).toEqual(['Vote', 'Activity', 'Details']);
        expect(panel()).toHaveAttribute('data-outcome-panel', 'vote');
        cleanup();

        await openPoll({
            poll: FINAL_POLL,
            results: FINAL_RESULTS,
            height: 264,
            votes: [{ action_index: 50, source: OWN, poll_index: 7, choice: 0, share: '1', block_index: 110 }],
        });
        expect(sectionTabs('Poll sections').map((tab) => tab.textContent)).toEqual(['Result', 'Activity', 'Details']);
        const result = screen.getByRole('tabpanel', { name: 'Result' });
        const verdict = within(result).getByRole('note');
        // The success notice's own icon (an SVG since the 2026-11-15 Notice
        // Standard), its lead, then the sentences.
        expect(verdict.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
        expect(verdict).toHaveTextContent('Winner: 0: Hardware wallet support, 52%. Turnout: 47 voters, Quorum 20% met', { normalizeWhitespace: true });
        const rows = within(screen.getByRole('region', { name: 'Final Results' })).getAllByRole('listitem');
        expect(rows.map((row) => row.textContent)).toEqual([
            '0: Hardware wallet supportWinner52%67,059.2 weight, 25 voters',
            '1: Faster sync30%38,688 weight, 14 voters',
            '2: Address book import18%23,212.8 weight, 8 voters',
        ]);
        expect(within(result).getByText('You voted: 0: Hardware wallet support')).toBeTruthy();

        // Activity lists the votes cast, this wallet's marked, each led by
        // its choice's mark as a bet row is (the first choice's letter).
        await press(screen.getByRole('tab', { name: 'Activity' }));
        const activity = screen.getByRole('tabpanel', { name: 'Activity' });
        const voteRows = [...activity.querySelectorAll('[data-outcome-activity] li')];
        expect(voteRows.map((li) => li.querySelector('[data-outcome-mark]').getAttribute('data-outcome-mark'))).toEqual(['A']);
        expect(voteRows.map((li) => li.textContent)).toEqual([
            `A0: Hardware wallet support${OWN}Youblock 110`,
        ]);
        expectRowsOnly(activity);
    });

    it('lists the market\'s bets on Activity and its facts on Details', async () => {
        await openBet();
        await press(screen.getByRole('tab', { name: 'Activity' }));
        const activity = screen.getByRole('tabpanel', { name: 'Activity' });
        // Each bet leads with its outcome's mark: a thumb down for No, up for Yes.
        const betRows = [...activity.querySelectorAll('[data-outcome-activity] li')];
        expect(betRows.map((li) => li.querySelector('[data-outcome-mark]').getAttribute('data-outcome-mark')))
            .toEqual(['thumbs-down', 'thumbs-up']);
        expect(betRows.map((li) => li.querySelector('span:not([aria-hidden]) > span').textContent))
            .toEqual(['No21 EXAMPLE', 'Yes29 EXAMPLE']);
        // Only the rows: no "Recent bets" title and no status-history footer.
        expectRowsOnly(activity);
        expect(activity.textContent).not.toMatch(/Recent bets|History|Taking bets|block 4217/i);

        await press(screen.getByRole('tab', { name: 'Details' }));
        const details = screen.getByRole('tabpanel', { name: 'Details' });
        expect([...details.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
            'Betting closes', 'Resolution source', 'Run by', 'Pool', 'Bets placed', 'Oracle fee', 'Refunds if unresolved by', 'Market',
        ]);
    });
});

describe('the pick and its one green button', () => {
    it('bet: one list row per outcome with its stake and chance, and no pick list, Bet button or pick prompt', async () => {
        await openBet();
        const betPanel = screen.getByRole('tabpanel', { name: 'Bet' });
        const list = within(betPanel).getByRole('list', { name: 'Outcome to back' });
        expect(list.hasAttribute('data-outcome-list')).toBe(true);
        const sides = within(list).getAllByRole('button');
        expect(sides.map((b) => b.getAttribute('aria-label'))).toEqual([
            'Bet on Yes, 62 percent, 62 EXAMPLE staked',
            'Bet on No, 38 percent, 38 EXAMPLE staked',
        ]);
        expect(sides.map((b) => b.textContent)).toEqual(['Yes62 EXAMPLE staked62%', 'No38 EXAMPLE staked38%']);
        // Each row leads with its thumb and is tinted to its share.
        expect(sides.map((b) => b.querySelector('[data-outcome-mark]').getAttribute('data-outcome-mark'))).toEqual(['thumbs-up', 'thumbs-down']);
        expect([...list.querySelectorAll('[data-outcome-fill]')].map((f) => f.style.width)).toEqual(['62%', '38%']);
        // No radio or toggle pick, no Bet button, no "choose an outcome" text.
        expect(within(betPanel).queryAllByRole('radio')).toHaveLength(0);
        expect(sides.map((b) => b.getAttribute('aria-pressed'))).toEqual([null, null]);
        expect(within(betPanel).queryByRole('button', { name: 'Bet' })).toBeNull();
        expect(betPanel.textContent).not.toMatch(/Your Pick|Pick a side|Choose an outcome/i);
        // No tap hint either: the chevron rows say it (2026-11-15, as on a poll).
        expect(betPanel.textContent).not.toContain('Tap an outcome');
    });

    it('bet: tapping Yes opens Place Bet with Yes chosen, and Back returns to the market', async () => {
        await openBet();
        await press(within(screen.getByRole('list', { name: 'Outcome to back' })).getByRole('button', { name: /^Bet on Yes,/ }));
        const form = screen.getByRole('form', { name: 'Place Bet' });
        expect(screen.queryByRole('tablist', { name: 'Market sections' })).toBeNull();
        // Outcome is the themed dropdown field (G119, walk note on screen 97),
        // arriving with the tapped outcome chosen.
        expect(within(form).getByRole('button', { name: /^Outcome: Yes\b/ })).toBeTruthy();
        expect(screen.queryByText('Choose an outcome.')).toBeNull();

        await press(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.queryByRole('form', { name: 'Place Bet' })).toBeNull();
        expect(screen.getByRole('tablist', { name: 'Market sections' })).toBeTruthy();
        expect(within(screen.getByRole('tabpanel', { name: 'Bet' })).getAllByRole('button').map((b) => b.getAttribute('aria-label').split(',')[0])).toEqual(['Bet on Yes', 'Bet on No']);
    });

    it('bet: keeps "You hold ..." under the outcome list', async () => {
        await openBet();
        const betPanel = screen.getByRole('tabpanel', { name: 'Bet' });
        const held = within(betPanel).getByText((_, el) => el?.tagName === 'P' && /^You hold/.test(el.textContent));
        expect(held.textContent).toBe('You hold 29 EXAMPLE on Yes');
        const group = within(betPanel).getByRole('list', { name: 'Outcome to back' });
        expect(group.compareDocumentPosition(held) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('wraps the Details notes in the shared notice card: the bet\'s parimutuel note and the poll\'s no-rules note', async () => {
        const { default: warningStyles } = await import('../../../packages/core/src/shared/components/WarningCard.module.css');
        await openBet();
        await press(screen.getByRole('tab', { name: 'Details' }));
        const note = document.querySelector('[data-bet-parimutuel-note]');
        expect(note.textContent).toMatch(/^This is a parimutuel market/);
        expect(note.getAttribute('data-warning-line')).toBe('plain');
        const card = note.closest('[data-bet-details-note]');
        expect(card.className).toContain(warningStyles.card);
        // 8px under the facts: the next block in the panel's 8px column.
        expect(card.previousElementSibling.tagName).toBe('DL');
        expect(card.parentElement).toBe(panel());
        cleanup();

        await openPoll({ poll: { ...OPEN_POLL, quorum: null } });
        await press(screen.getByRole('tab', { name: 'Details' }));
        const pollCard = document.querySelector('[data-poll-details-note]');
        expect(pollCard.className).toContain(warningStyles.card);
        expect(pollCard.querySelector('[data-warning-line="plain"]').textContent).toBe('This poll sets no turnout rules.');
        expect(pollCard.previousElementSibling.tagName).toBe('DL');
    });

    it('poll: names this wallet\'s standing vote under the choice list while the poll is open', async () => {
        await openPoll({ votes: [{ action_index: 50, source: OWN, poll_index: 7, choice: 2, share: '1', block_index: 110 }] });
        const votePanel = screen.getByRole('tabpanel', { name: 'Vote' });
        // A vote changes until the close, so the rows stay buttons, as bet
        // rows do after a bet, and the vote is named under the list.
        const list = within(votePanel).getByRole('list', { name: 'Choice to vote for' });
        const youVoted = within(votePanel).getByText('You voted: 2: Address book import');
        expect(list.compareDocumentPosition(youVoted) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(within(list).getByRole('button', { name: 'Vote for Address book import' })).toBeEnabled();
        expect(within(votePanel).queryByRole('button', { name: 'Change Vote' })).toBeNull();
        expect(within(votePanel).queryAllByRole('checkbox')).toHaveLength(0);
    });

    it('poll: one list row per choice, like the bet list, and a row opens Cast Vote with it', async () => {
        await openPoll();
        const votePanel = screen.getByRole('tabpanel', { name: 'Vote' });
        // No Your vote label, Choose line or tap hint: the choices lead straight
        // to voting (walk notes on screen 56, 2026-11-15Z).
        expect(within(votePanel).queryByText(/^Your Vote$/i)).toBeNull();
        expect(within(votePanel).queryByText(/^Choose \d+$/)).toBeNull();
        expect(votePanel.textContent).not.toMatch(/Tap a choice/);
        const list = within(votePanel).getByRole('list', { name: 'Choice to vote for' });
        expect(list.hasAttribute('data-outcome-list')).toBe(true);
        const rows = within(list).getAllByRole('button');
        expect(rows.map((b) => b.getAttribute('aria-label'))).toEqual([
            'Vote for Hardware wallet support', 'Vote for Faster sync', 'Vote for Address book import',
        ]);
        expect(rows.map((b) => b.querySelector('[data-outcome-mark]').getAttribute('data-outcome-mark'))).toEqual(['A', 'B', 'C']);
        // No checkbox, no pick toggle and no separate Vote button.
        expect(within(votePanel).queryAllByRole('checkbox')).toHaveLength(0);
        expect(rows.map((b) => b.getAttribute('aria-pressed'))).toEqual([null, null, null]);
        expect(within(votePanel).queryByRole('button', { name: 'Vote' })).toBeNull();

        await press(within(list).getByRole('button', { name: 'Vote for Faster sync' }));
        expect(screen.getByRole('form', { name: 'Cast Vote' })).toBeTruthy();
        expect([...document.querySelectorAll('[data-poll-chosen] li')].map((li) => li.textContent)).toEqual(['1: Faster sync']);

        await press(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.queryByRole('form', { name: 'Cast Vote' })).toBeNull();
        expect(within(screen.getByRole('tabpanel', { name: 'Vote' })).getAllByRole('button', { name: /^Vote for / })).toHaveLength(3);
    });
});
