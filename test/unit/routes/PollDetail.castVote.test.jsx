// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The poll page by ruling: the identity card, then a Vote | Activity |
// Details toggle whose content shows in one place. Vote is the bet market's
// outcome list (operator ruling 2026-11-13): one row per choice, and the
// whole row opens the Cast Vote step (From, the vote, Memo, Network fee,
// Sign Vote) with that choice made; there is no checkbox and no separate
// Vote button on the poll page. A closed poll has no Vote tab and its
// Result rows are not buttons.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

// The From picker is its own screen; a stand-in picks the second address.
vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ onPick }) => (
        <button type="button" onClick={() => onPick({ id: 'address-2' })}>Pick the second address</button>
    ),
}));
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';
import { resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qvotervotervotervotervotervoterxx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const OPEN_POLL = Object.freeze({
    action_index: 7,
    tick: 'VOTE',
    question: 'Choose a release channel',
    options: ['Stable', 'Preview', 'Nightly'],
    tally_mode: 'approval',
    weight_mode: 'balance',
    max_selections: 2,
    end_block: 120,
    block_index: 90,
    source: 'bc1qcreatorcreatorcreatorcreatorcrea',
    quorum: '0.2',
    min_voters: 10,
    poll_status: 'open',
});
const YES_NO_POLL = Object.freeze({ ...OPEN_POLL, options: ['Yes', 'No'], max_selections: 1 });
const COMPOSED = Object.freeze({ psbt: 'bb00', encoding: 'psbt', actionString: 'VOTE|0|7|0,2', version: 1 });

afterEach(() => {
    cleanup();
    resetWalletModes();
});

async function drain(rounds = 30) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

const SECOND = Object.freeze({ ...ADDRESS, id: 'address-2', address: 'bc1qsecondsecondsecondsecondsecondsec' });

function harness({ poll = OPEN_POLL, votes = [], height = 100, addresses = [ADDRESS] } = {}) {
    const calls = { compose: [], cast: [] };
    const target = {
        governancePoll: () => Promise.resolve(poll),
        getIndexerWatermark: () => Promise.resolve({ watermark: height }),
        governancePollResults: () => Promise.resolve({
            data: [
                { option_index: 0, total_weight: '60', voter_count: 6 },
                { option_index: 1, total_weight: '40', voter_count: 4 },
            ],
        }),
        getAddressesByChain: () => Promise.resolve(addresses.length ? { [CHAIN]: addresses } : {}),
        getActiveAddresses: () => Promise.resolve(addresses.length ? { [CHAIN]: { id: ADDRESS.id } } : {}),
        // The poll's own read (Activity) takes every ballot; an address read
        // takes that address's.
        governanceVotes: ({ query, type }) => Promise.resolve({
            data: type === 'poll' ? votes : votes.filter((vote) => vote.source === query),
        }),
        getSettings: () => Promise.resolve({ walletMode: 'full', preflightPrivacy: 'off' }),
        listWallets: () => Promise.resolve([{ id: 'wallet-1', walletMode: 'full' }]),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        composeVoteForConfirm: (args) => {
            calls.compose.push(args);
            return Promise.resolve(COMPOSED);
        },
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
        castBallotAction: (args) => {
            calls.cast.push(args);
            return Promise.resolve({ txid: 'tx-vote' });
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

async function mountPoll(messaging) {
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={7} onBack={() => {}} />
            </MessagingProvider>,
        );
        await drain();
    });
    return utils;
}

async function click(element, rounds = 30) {
    await domAct(async () => {
        fireEvent.click(element);
        await drain(rounds);
    });
}

function sectionTitles(root) {
    return [...root.querySelectorAll('[data-form-section-title]')].map((el) => el.textContent);
}

// The poll page's own tab strip (the hero's range chips are a second tablist).
const sectionTabs = () => within(screen.getByRole('tablist', { name: 'Poll sections' })).getAllByRole('tab');
const sectionPanel = () => document.querySelector('[data-outcome-panel]');
const choiceList = () => screen.getByRole('list', { name: 'Choice to vote for' });
const choiceRow = (name) => screen.getByRole('button', { name: `Vote for ${name}` });

describe('Poll page tabs', () => {
    it('opens on Vote for an open poll and shows Activity and Details in the same place', async () => {
        const { messaging } = harness();
        await mountPoll(messaging);

        const tabs = sectionTabs();
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Vote', 'Activity', 'Details']);
        expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
        for (const tab of tabs) expect(tab.querySelector('svg')).not.toBeNull();
        const panel = screen.getByRole('tabpanel', { name: 'Vote' });
        expect(panel).toHaveAttribute('data-outcome-panel', 'vote');
        expect(panel).toContainElement(choiceList());
        expect(within(panel).queryByRole('button', { name: 'Vote' })).toBeNull();

        await click(screen.getByRole('tab', { name: 'Activity' }));
        const activity = screen.getByRole('tabpanel', { name: 'Activity' });
        expect(activity.id).toBe(panel.id);
        expect(activity).toHaveAttribute('data-outcome-panel', 'activity');
        // The bet page's EmptyState, worded for votes.
        expect(activity.querySelector('[data-poll-activity-empty]')).toHaveTextContent('No votes yetVotes cast on this poll appear here.');
        expect(screen.queryByRole('list', { name: 'Choice to vote for' })).toBeNull();

        // Details is one fact list in the bet page's order: when it closes,
        // how it is counted, the counts, the poll-only terms (token, voting
        // weight, ballot), the rules, then the number last.
        await click(screen.getByRole('tab', { name: 'Details' }));
        const details = screen.getByRole('tabpanel', { name: 'Details' });
        expect(details.id).toBe(panel.id);
        expect(details).toHaveAttribute('data-outcome-panel', 'details');
        const facts = Object.fromEntries([...details.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
        expect(Object.keys(facts)).toEqual([
            'Closes at block', 'Voting window', 'Results counted', 'Creator', 'Votes cast', 'Voters',
            'Token', 'Voting weight', 'Ballot', 'Quorum', 'Minimum voters', 'Network', 'Created at block', 'Poll number',
        ]);
        expect(facts['Closes at block']).toBe('120');
        expect(facts['Voting window']).toBe('20 blocks remaining');
        expect(facts['Results counted']).toBe('At the close block');
        expect(facts['Votes cast']).toBe('0');
        expect(facts.Voters).toBe('0');
        expect(facts['Voting weight']).toBe('VOTE balance at the close block');
        expect(facts.Ballot).toBe('Choose up to 2');
        expect(facts.Quorum).toBe('20% of supply');
        expect(facts['Minimum voters']).toBe('10');
        expect(facts['Poll number']).toBe('#7');
    });

    it('offers Result in place of Vote on a closed poll, its rows not buttons', async () => {
        const { messaging } = harness({
            poll: { ...YES_NO_POLL, poll_status: 'finalized', winning_option: 0, quorum_met: 1 },
            height: 130,
            votes: [{ action_index: 50, source: ADDRESS.address, poll_index: 7, choice: 0, share: '1' }],
        });
        await mountPoll(messaging);

        const tabs = sectionTabs();
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Result', 'Activity', 'Details']);
        expect(screen.getByRole('tab', { name: 'Result' })).toHaveAttribute('aria-selected', 'true');
        expect(sectionPanel()).toHaveAttribute('data-outcome-panel', 'result');
        expect(screen.queryByRole('button', { name: /^(Vote|Change Vote)$/ })).toBeNull();
        // Like a closed bet market: no choice list and no row to tap.
        expect(screen.queryByRole('list', { name: 'Choice to vote for' })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Vote for / })).toBeNull();
        expect(document.querySelectorAll('[data-outcome-option]')).toHaveLength(0);
        const panel = screen.getByRole('tabpanel', { name: 'Result' });
        const verdict = within(panel).getByRole('note');
        expect(verdict).toHaveTextContent('Approved');
        expect(verdict).toHaveTextContent('Winner: 0: Yes, 60%');
        const results = screen.getByRole('region', { name: 'Final Results' });
        expect([...results.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
            '0: YesWinner60%60 weight, 6 voters',
            '1: No40%40 weight, 4 voters',
        ]);
        expect(within(results).queryAllByRole('button')).toHaveLength(0);
        expect(within(results).getByText('You voted: 0: Yes')).toBeTruthy();
    });
});

describe('Vote tab: the bet market outcome list', () => {
    it('draws one row per choice with its mark, its name and a chevron, and no tally before the close', async () => {
        const { messaging } = harness({ poll: YES_NO_POLL });
        await mountPoll(messaging);

        const panel = screen.getByRole('tabpanel', { name: 'Vote' });
        // No "Your Vote" title, "Choose 1" line or tap hint: the rows follow the tab.
        // The hero's votes and voters line is read-only: no help icon (G121).
        expect(within(panel).queryByRole('button', { name: 'About ballot choices' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'About ballot choices' })).toBeNull();
        expect(within(panel).queryByText('Your Vote')).toBeNull();
        expect(panel).not.toHaveTextContent('Choose 1');
        expect(panel).not.toHaveTextContent('Tap a choice');
        // No checkbox and no separate Vote button.
        expect(within(panel).queryAllByRole('checkbox')).toHaveLength(0);
        expect(within(panel).queryByRole('button', { name: /^(Vote|Change Vote)$/ })).toBeNull();

        const rows = within(choiceList()).getAllByRole('button');
        expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Vote for Yes', 'Vote for No']);
        // The name only, never "0: Yes"; weight counts at the close, so no
        // votes, share or fill shows rather than a made-up 0%.
        expect(rows.map((row) => row.textContent)).toEqual(['Yes', 'No']);
        expect([...panel.querySelectorAll('[data-outcome-fill]')].map((fill) => fill.getAttribute('data-outcome-fill')))
            .toEqual(['0', '0']);
        expect(panel.textContent).not.toMatch(/\d%/);
        // Yes leads with a thumbs-up, No with a thumbs-down.
        expect([...panel.querySelectorAll('[data-outcome-mark]')].map((mark) => mark.getAttribute('data-outcome-mark')))
            .toEqual(['thumbs-up', 'thumbs-down']);
        expect(panel.querySelector('[data-poll-tap-hint]')).toBeNull();
    });

    it('leads any other choice with its letter', async () => {
        const { messaging } = harness();
        await mountPoll(messaging);

        expect([...choiceList().querySelectorAll('[data-outcome-mark]')].map((mark) => mark.getAttribute('data-outcome-mark')))
            .toEqual(['A', 'B', 'C']);
        expect(screen.getByRole('tabpanel', { name: 'Vote' })).not.toHaveTextContent('Choose up to');
    });

    it('opens Cast Vote from a one-choice row with that choice made, and signs it', async () => {
        const { messaging, calls } = harness({ poll: YES_NO_POLL });
        await mountPoll(messaging);
        await click(choiceRow('No'));

        // Cast Vote: the Form Standard form, From first, the vote open, then
        // Memo, Advanced (G98, directly above fees) and Network fee closed,
        // and one Sign Vote action.
        expect(screen.getByRole('heading', { name: 'Cast Vote' })).toBeTruthy();
        const form = screen.getByRole('form', { name: 'Cast Vote' });
        expect(sectionTitles(form)).toEqual(['From', 'Vote', 'Memo', 'Advanced', 'Speed and Fees']);
        expect(screen.getByRole('button', { name: /^Vote\b/, expanded: true })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^From\b/, expanded: false })).toBeTruthy();
        const chosen = form.querySelector('[data-poll-chosen]');
        expect([...chosen.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['1: No']);
        expect(within(form).queryAllByRole('checkbox')).toHaveLength(0);
        expect(within(form).getByText('Choose a release channel')).toBeTruthy();
        expect(form.querySelectorAll('button[type="submit"]')).toHaveLength(1);
        expect(screen.queryByRole('tablist')).toBeNull();

        await click(within(form).getByRole('button', { name: 'Sign Vote' }));
        expect(calls.compose).toHaveLength(1);
        expect(calls.compose[0].builder).toBe('castBallotParams');
        expect(calls.compose[0].params).toEqual({ pollRef: 7, ballot: [1] });
        await click(screen.getByTestId('confirm-approve'), 60);

        expect(calls.cast).toHaveLength(1);
        expect(calls.cast[0].params).toEqual({ pollRef: 7, ballot: [1] });
        expect(calls.cast[0].prebuiltPsbt).toMatchObject({ psbtHex: 'bb00', encoding: 'psbt' });
        expect(screen.getByText('1: No', { selector: 'dd' })).toBeTruthy();
        expect(screen.getByText('tx-vote', { selector: 'dd' })).toBeTruthy();
    });

    it('opens a choose-N ballot with the tapped choice in it, where the voter adds others', async () => {
        const { messaging, calls } = harness();
        await mountPoll(messaging);
        await click(choiceRow('Stable'));

        // The ballot is open on Cast Vote, the tapped choice ticked, so a
        // second choice is added there, never by a second tap on the list.
        const form = screen.getByRole('form', { name: 'Cast Vote' });
        expect(within(form).getByRole('group', { name: 'Choose up to 2 options' })).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: '0: Stable' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: '1: Preview' })).not.toBeChecked();
        await click(screen.getByRole('checkbox', { name: '2: Nightly' }));
        expect(screen.getByRole('checkbox', { name: '1: Preview' })).toBeDisabled();

        await click(screen.getByRole('button', { name: 'Sign Vote' }));
        expect(calls.compose).toHaveLength(1);
        expect(calls.compose[0].params).toEqual({ pollRef: 7, ballot: [0, 2] });
        await click(screen.getByTestId('confirm-approve'), 60);
        expect(calls.cast[0].params).toEqual({ pollRef: 7, ballot: [0, 2] });
        expect(screen.getByText('0: Stable · 2: Nightly', { selector: 'dd' })).toBeTruthy();
    });

    it('gives a tapped split choice the whole weight, editable on Cast Vote', async () => {
        const { messaging, calls } = harness({ poll: { ...OPEN_POLL, tally_mode: 'split', max_selections: 3 } });
        await mountPoll(messaging);
        expect(screen.getByRole('tabpanel', { name: 'Vote' })).not.toHaveTextContent('Split your weight');
        await click(choiceRow('Preview'));

        expect(screen.getByRole('heading', { name: 'Cast Vote' })).toBeTruthy();
        expect(screen.getByLabelText('1: Preview')).toHaveValue('1');
        expect(screen.getByLabelText('0: Stable')).toHaveValue('');
        await click(screen.getByRole('button', { name: 'Sign Vote' }));
        expect(calls.compose[0].params).toEqual({ pollRef: 7, ballot: [{ option: 1, share: '1' }] });
    });

    it('returns to the list on Back from Cast Vote', async () => {
        const { messaging } = harness({ poll: YES_NO_POLL });
        await mountPoll(messaging);
        await click(choiceRow('Yes'));
        expect(screen.getByRole('heading', { name: 'Cast Vote' })).toBeTruthy();

        await click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByRole('heading', { name: 'Poll' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Vote' })).toHaveAttribute('aria-selected', 'true');
        expect(choiceRow('Yes')).toBeEnabled();
        expect(document.querySelector('form')).toBeNull();
    });

    it('keeps the rows tappable after a vote, names it under the list, and a tap replaces it', async () => {
        const { messaging, calls } = harness({
            poll: YES_NO_POLL,
            votes: [{ action_index: 50, source: ADDRESS.address, poll_index: 7, choice: 0, share: '1' }],
        });
        await mountPoll(messaging);

        const panel = screen.getByRole('tabpanel', { name: 'Vote' });
        expect(within(panel).getByText('You voted: 0: Yes')).toBeTruthy();
        expect(within(panel).getByText(/You can change this address's vote until the poll closes/)).toBeTruthy();
        expect(choiceList().compareDocumentPosition(within(panel).getByText('You voted: 0: Yes'))
            & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // The earlier vote never seeds the ballot: the tapped choice is the one cast.
        await click(choiceRow('No'));
        await click(screen.getByRole('button', { name: 'Sign Vote' }));
        expect(calls.compose[0].params).toEqual({ pollRef: 7, ballot: [1] });
    });

    it('keeps the tapped choice when From changes to an address with its own vote', async () => {
        const { messaging, calls } = harness({
            addresses: [ADDRESS, SECOND],
            votes: [{ action_index: 51, source: SECOND.address, poll_index: 7, choice: 1, share: '1' }],
        });
        await mountPoll(messaging);
        await click(choiceRow('Stable'));

        await click(screen.getByRole('button', { name: /^From\b/ }));
        await click(screen.getByRole('button', { name: 'Choose voting address' }));
        await click(screen.getByRole('button', { name: 'Pick the second address' }));

        expect(screen.getByRole('heading', { name: 'Cast Vote' })).toBeTruthy();
        expect(screen.getByDisplayValue(SECOND.address)).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: '0: Stable' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: '1: Preview' })).not.toBeChecked();
        await click(screen.getByRole('button', { name: 'Sign Vote' }));
        expect(calls.compose[0].params).toEqual({ pollRef: 7, ballot: [0] });
    });

    it('says why the rows are off when the wallet has no address on this network', async () => {
        const { messaging } = harness({ addresses: [] });
        await mountPoll(messaging);

        const panel = screen.getByRole('tabpanel', { name: 'Vote' });
        expect(panel.querySelector('[data-poll-no-address]')?.textContent)
            .toBe('No address on this network. Use Receive to generate one, then vote.');
        for (const row of within(choiceList()).getAllByRole('button')) expect(row).toBeDisabled();
        expect(panel.querySelector('[data-poll-tap-hint]')).toBeNull();
    });

    it('sends a ballot error from Sign Vote into the open vote editor', async () => {
        const { messaging, calls } = harness();
        await mountPoll(messaging);
        await click(choiceRow('Stable'));
        await click(screen.getByRole('checkbox', { name: '0: Stable' }));
        await click(screen.getByRole('button', { name: 'Sign Vote' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one option.');
        expect(screen.getByRole('group', { name: 'Choose up to 2 options' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Cast Vote' })).toBeTruthy();
        expect(calls.compose).toHaveLength(0);
    });
});

describe('Activity marks', () => {
    it('leads each vote with the same thumb or letter as the choice list', async () => {
        const { messaging } = harness({
            poll: YES_NO_POLL,
            votes: [
                { action_index: 60, source: 'bc1qothervoterothervoterothervoterot', poll_index: 7, choice: 1, share: '1', block_index: 101 },
                { action_index: 61, source: ADDRESS.address, poll_index: 7, choice: 0, share: '1', block_index: 102 },
            ],
        });
        await mountPoll(messaging);
        await click(screen.getByRole('tab', { name: 'Activity' }));

        const activity = screen.getByRole('tabpanel', { name: 'Activity' });
        const rows = [...activity.querySelectorAll('[data-outcome-activity] > li')];
        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.querySelector('[data-outcome-mark]')?.getAttribute('data-outcome-mark')))
            .toEqual(['thumbs-up', 'thumbs-down']);
    });
});
