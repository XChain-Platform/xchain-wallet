// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qvotervotervotervotervotervoterxx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(cleanup);

describe('PollDetail rendering', () => {
    it('renders an open ballot as the choice list, a row opening Cast Vote with that choice', async () => {
        const messaging = {
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 7,
                tick: 'VOTE',
                question: 'Choose a release channel',
                options: ['Stable', 'Preview'],
                tally_mode: 'approval',
                weight_mode: 'balance',
                max_selections: 1,
                end_block: 120,
                poll_status: 'open',
            }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            governanceVotes: vi.fn().mockResolvedValue([]),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            composeForConfirm: vi.fn(),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={7} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        // "Poll", as the bet page's header reads "Market".
        expect(await screen.findByRole('heading', { name: 'Poll' })).toBeInTheDocument();
        // The shared outcome hero uses the fixed 0 to 100 probability chart:
        // status and time left, the question, and "Counted at close" while
        // the protocol has no frozen token-weighted tally.
        const hero = document.querySelector('[data-outcome-hero]');
        expect(hero.hasAttribute('data-outcome-chart-hero')).toBe(true);
        expect([...hero.querySelectorAll('[data-outcome-chip]')].map((chip) => chip.textContent))
            .toEqual(['Open', 'Closes in 3 h']);
        expect(screen.getByRole('heading', { level: 2, name: 'Choose a release channel' })).toBeInTheDocument();
        expect(hero.querySelector('[data-outcome-lead]').textContent).toBe('Counted at close');
        expect(hero.querySelector('[data-outcome-bar]')).toBeNull();
        expect(hero.querySelectorAll('[data-outcome-line]')).toHaveLength(2);
        const counts = hero.querySelector('[data-poll-hero-counts]');
        expect(counts.textContent.startsWith('0 votes · 0 voters')).toBe(true);
        // The votes and voters line is read-only: no help icon on it (G121).
        expect(within(counts).queryByRole('button', { name: 'About ballot choices' })).toBeNull();
        await screen.findByText('No vote from this wallet.');
        const yourVote = screen.getByRole('region', { name: 'Your vote' });
        expect(yourVote).toHaveTextContent('No vote from this wallet.');
        expect(within(yourVote).getByRole('button', { name: 'Vote' })).toBeEnabled();
        const follows = Node.DOCUMENT_POSITION_FOLLOWING;
        const toggle = screen.getByRole('tablist', { name: 'Poll sections' });
        expect(within(toggle).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Vote', 'Activity', 'Details']);
        expect(screen.getByRole('tab', { name: 'Vote' })).toHaveAttribute('aria-selected', 'true');
        expect(hero.compareDocumentPosition(toggle) & follows).toBeTruthy();
        // The Vote tab holds only the choice list (the bet market's outcome
        // list): the poll page has no form, no From, Memo or fee sections,
        // no checkbox and no separate Vote button.
        expect(document.querySelector('form')).toBeNull();
        expect(document.querySelectorAll('[data-form-section-title]')).toHaveLength(0);
        const panel = screen.getByRole('tabpanel', { name: 'Vote' });
        const list = screen.getByRole('list', { name: 'Choice to vote for' });
        expect(panel).toContainElement(list);
        // No "Your Vote" head, "Choose 1" line or tap hint above or under the rows.
        expect(within(panel).queryByText('Your Vote')).toBeNull();
        expect(within(panel).queryByText(/^Choose (1|up to)/)).toBeNull();
        expect(within(panel).queryByText(/Tap a choice/)).toBeNull();
        expect(panel.querySelector('[data-poll-tap-hint]')).toBeNull();
        expect(within(panel).queryByRole('button', { name: 'About ballot choices' })).toBeNull();
        expect(within(panel).queryAllByRole('checkbox')).toHaveLength(0);
        expect(within(panel).queryByRole('button', { name: 'Vote' })).toBeNull();
        const stable = await screen.findByRole('button', { name: 'Vote for Stable' });
        expect(stable).toHaveAttribute('type', 'button');
        expect(stable.querySelector('svg')).not.toBeNull();
        expect(within(list).getAllByRole('button')).toHaveLength(2);

        // Details shows the poll's facts in the same place, the list gone.
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(screen.getByRole('tabpanel', { name: 'Details' })).toHaveTextContent('20 blocks remaining');
        expect(screen.queryByRole('list', { name: 'Choice to vote for' })).toBeNull();

        // Back on Vote, one tap on a row opens Cast Vote with that choice.
        fireEvent.click(screen.getByRole('tab', { name: 'Vote' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Vote for Preview' }));
        expect(await screen.findByRole('form', { name: 'Cast Vote' })).toBeInTheDocument();
        expect([...document.querySelectorAll('[data-poll-chosen] li')].map((li) => li.textContent)).toEqual(['1: Preview']);

        fireEvent.click(screen.getByRole('button', { name: 'Change your choice' }));
        fireEvent.click(screen.getByRole('checkbox', { name: /Preview/ }));
        const sign = screen.getByRole('button', { name: 'Sign Vote' });
        expect(sign).toBeEnabled();
        fireEvent.click(sign);
        expect(screen.getByLabelText('Form errors')).toHaveTextContent(/Choose/);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('shows exact final weighted results, the latest own vote, and no closed-poll action', async () => {
        const messaging = {
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 8,
                tick: 'VOTE',
                question: 'Choose one',
                options: ['Alpha', 'Beta', 'Gamma'],
                tally_mode: 'approval',
                weight_mode: 'quadratic',
                max_selections: 1,
                end_block: 120,
                poll_status: 'finalized',
                winning_option: 0,
            }),
            governancePollResults: vi.fn().mockResolvedValue({
                data: [
                    { option_index: 0, total_weight: '9007199254740993', voter_count: 12 },
                    { option_index: 1, total_weight: '9007199254740993', voter_count: 2 },
                    { option_index: 2, total_weight: '9007199254740993', voter_count: 1 },
                ],
            }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 121 }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            governanceVotes: vi.fn().mockResolvedValue({
                data: [
                    {
                        action_index: '9007199254740992', source: ADDRESS.address,
                        poll_index: 8, choice: 0, share: '1',
                    },
                    {
                        action_index: '9007199254740993', source: ADDRESS.address,
                        poll_index: 8, choice: 1, share: '1', weight: '1200',
                    },
                    {
                        action_index: '9007199254740994', source: 'bc1qdelegate',
                        poll_index: 8, choice: 2, share: '1',
                    },
                ],
            }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={8} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        // A closed poll's strip offers Result in place of Vote, and no Vote
        // button shows.
        expect(await screen.findByRole('tab', { name: 'Result' })).toHaveAttribute('aria-selected', 'true');
        const toggle = screen.getByRole('tablist', { name: 'Poll sections' });
        expect(within(toggle).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Result', 'Activity', 'Details']);
        expect(screen.queryByRole('button', { name: /^(Vote|Change Vote)$/ })).toBeNull();
        // Result says what this wallet voted: its latest ballot.
        expect(await screen.findByText('You voted: 1: Beta')).toBeInTheDocument();
        expect(screen.getByText('Voting weight: 1,200 VOTE')).toBeInTheDocument();
        // Result states the outcome and the winner with its share, then the
        // final results, the winner marked.
        const verdict = within(screen.getByRole('tabpanel', { name: 'Result' })).getByRole('note');
        expect(verdict).toHaveTextContent('Decided');
        expect(verdict).toHaveTextContent('Winner: 0: Alpha, 34%');
        const results = screen.getByRole('region', { name: 'Final Results' });
        expect([...results.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
            '0: AlphaWinner34%9,007,199,254,740,993 weight, 12 voters',
            '1: Beta33%9,007,199,254,740,993 weight, 2 voters',
            '2: Gamma33%9,007,199,254,740,993 weight, 1 voter',
        ]);
        // Frozen token-weighted shares render as one flat line per answer on
        // the same fixed probability chart as prediction markets.
        const hero = document.querySelector('[data-outcome-hero]');
        expect(hero.hasAttribute('data-outcome-chart-hero')).toBe(true);
        expect(hero.querySelector('[data-outcome-lead]').textContent).toBe('34%AlphaFinal');
        expect(within(hero).getByRole('list', { name: 'Share of each option' }).textContent).toBe('Alpha34%Beta33%Gamma33%');
        expect([...hero.querySelectorAll('[data-outcome-line]')].map((line) => line.getAttribute('data-outcome-line')))
            .toEqual(['0', '1', '2']);
        expect(messaging.governancePollResults).toHaveBeenCalledWith({ chainId: CHAIN, pollIndex: 8 });
    });

    it('refuses a poll definition whose action index does not match the requested poll', async () => {
        const messaging = {
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 99,
                tick: 'VOTE',
                question: 'Wrong poll',
                options: ['Yes', 'No'],
                tally_mode: 'approval',
                poll_status: 'open',
            }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            governanceVotes: vi.fn().mockResolvedValue([]),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={7} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        expect(await screen.findByText('Poll not found.')).toBeInTheDocument();
        expect(screen.queryByText('Wrong poll')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Vote' })).toBeNull();
    });

    it('neutralizes and bounds hostile poll text while tolerating structured fields', async () => {
        const rlo = String.fromCharCode(0x202e);
        const questionPrefix = `Approve ${rlo}hidden`;
        const messaging = {
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 7,
                tick: 'VOTE',
                question: `${questionPrefix}${'Q'.repeat(100_000)}`,
                options: ['<img src=x onerror=alert(1)>', { malformed: true }],
                tally_mode: 'approval',
                weight_mode: { malformed: true },
                max_selections: 1,
                end_block: 120,
                poll_status: 'open',
            }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            governanceVotes: vi.fn().mockResolvedValue([]),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };

        const view = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={7} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        const question = await screen.findByText((text) => text.startsWith('Approve '));
        expect(question.textContent).not.toContain(rlo);
        expect(question.textContent).toContain('\u2426');
        expect(question.textContent.length).toBeLessThanOrEqual(1_024);
        expect(await screen.findByRole('button', { name: 'Vote for <img src=x onerror=alert(1)>' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Vote for Unavailable option' })).toBeInTheDocument();
        expect(view.container.querySelector('img[onerror]')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        // A malformed weight mode reads as unavailable, never as an object.
        const weight = [...document.querySelectorAll('dt')].find((dt) => dt.textContent === 'Voting weight');
        expect(weight.nextElementSibling.textContent).toBe('unavailable');
    });
});
