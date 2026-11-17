// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';
import { BetFeedDetail } from '../../../packages/core/src/shared/routes/BetFeedDetail.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
});

function messaging(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue(createDefaultSettings()),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        listContacts: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
}

function renderRoute(route, host = messaging()) {
    return render(
        <MessagingProvider shell="web" messaging={host}>
            {route}
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('protocol form accessibility', () => {
    it('scans the loaded token issue form', async () => {
        const { container } = renderRoute(
            <IssueTokenForm walletId="wallet-1" onBack={() => {}} />,
        );
        await screen.findByRole('form', { name: 'Issue Token' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the loaded dispenser form', async () => {
        const { container } = renderRoute(
            <DispenserForm walletId="wallet-1" onBack={() => {}} />,
        );
        await screen.findByRole('form', { name: 'Create dispenser' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the loaded order form', async () => {
        const { container } = renderRoute(
            <CreateOrderForm walletId="wallet-1" onBack={() => {}} />,
        );
        await screen.findByRole('form', { name: 'Create order' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the loaded bet composer', async () => {
        const host = messaging({
            betFeed: vi.fn().mockResolvedValue({
                action_index: 17,
                source: 'bc1qoracleoracleoracleoracleoracleoraclex',
                label: 'Will it ship?',
                outcomes: 'Yes,No',
                tick: 'A11Y',
                min_amount: '1',
                fee: '0',
                feed_status: 'open',
                pools: [],
                timeline: [],
            }),
        });
        const { container } = renderRoute(
            <BetFeedDetail walletId="wallet-1" chainId={CHAIN} feedIndex={17} onBack={() => {}} />,
            host,
        );
        // The Bet tab holds one list row per outcome, and tapping one opens
        // the Place Bet form with it.
        fireEvent.click(await screen.findByRole('tab', { name: 'Bet' }));
        const outcomes = await screen.findByRole('list', { name: 'Outcome to back' });
        await expectNoSeriousAxeViolations(container);
        const yes = within(outcomes).getByRole('button', { name: /^Bet on Yes,/ });
        await waitFor(() => expect(yes).toBeEnabled());
        fireEvent.click(yes);
        await screen.findByRole('form', { name: 'Place Bet' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans a five-outcome market\'s outcome list and its Activity marks', async () => {
        const outcomes = ['Under 65°F', '65 to 70°F', '70 to 75°F', '75 to 80°F', '80°F or more'];
        const host = messaging({
            betFeed: vi.fn().mockResolvedValue({
                action_index: 18,
                source: 'bc1qoracleoracleoracleoracleoracleoraclex',
                label: 'What will the high be in Los Angeles today?',
                outcomes: outcomes.join(','),
                tick: 'A11Y',
                min_amount: '1',
                fee: '0',
                feed_status: 'open',
                pools: outcomes.map((_, i) => ({ outcome: i, pool: String(100 + i * 50), bet_count: 2 })),
                timeline: [],
            }),
            bets: vi.fn().mockResolvedValue({
                data: outcomes.map((_, i) => ({
                    action_index: 900 + i, outcome: i, amount: '10', source: 'bc1qsomeoneelse', bet_status: 'open',
                })),
            }),
        });
        const { container } = renderRoute(
            <BetFeedDetail walletId="wallet-1" chainId={CHAIN} feedIndex={18} onBack={() => {}} />,
            host,
        );
        const list = await screen.findByRole('list', { name: 'Outcome to back' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(5);
        expect(within(list).getByRole('button', { name: /^Bet on 70 to 75°F, \d+ percent, 200 A11Y staked$/ })).toBeTruthy();
        await expectNoSeriousAxeViolations(container);
        fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
        await waitFor(() => expect(container.querySelectorAll('[data-outcome-activity] [data-outcome-mark]')).toHaveLength(5));
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the poll page ballot and the Cast Vote form', async () => {
        const host = messaging({
            governancePoll: vi.fn().mockResolvedValue({
                action_index: 23,
                tick: 'A11Y',
                question: 'Ship the accessibility fixes?',
                poll_status: 'open',
                options: ['Yes', 'No'],
                tally_mode: 'approval',
                weight_mode: 'balance',
                max_selections: 1,
                end_block: 200,
            }),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
            governanceVotes: vi.fn().mockResolvedValue([]),
        });
        const { container } = renderRoute(
            <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={23} onBack={() => {}} />,
            host,
        );
        // The poll page: the identity card, then the Vote | Activity |
        // Details strip on Vote, the choice list, once this wallet's own
        // vote read settles.
        await screen.findByRole('tabpanel', { name: 'Vote' });
        await waitFor(() => expect(host.governanceVotes).toHaveBeenCalledWith(expect.objectContaining({ type: 'address' })));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Vote for Yes' })).toBeEnabled());
        await expectNoSeriousAxeViolations(container);
        // A choice row opens the Cast Vote form with that choice.
        fireEvent.click(screen.getByRole('button', { name: 'Vote for Yes' }));
        await screen.findByRole('form', { name: 'Cast Vote' });
        await expectNoSeriousAxeViolations(container);
    });
});
