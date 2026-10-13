// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
        await screen.findByRole('form', { name: 'Issue token' });
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
        await screen.findByRole('form', { name: 'Place a bet' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the loaded poll voting form', async () => {
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
        await screen.findByRole('form', { name: 'Cast ballot' });
        await expectNoSeriousAxeViolations(container);
    });
});
