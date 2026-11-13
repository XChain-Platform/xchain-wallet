// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The poll page's ballot, the parallel action queue and the operator
// publisher sit on the Form Standard, and each routes its fee through the
// shared Network fee section, so the fee shows its fiat value like every
// other form.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';
import { OperatorPublisherMode } from '../../../packages/core/src/shared/components/OperatorPublisherMode.jsx';

const useFeeFiatMock = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: (...args) => useFeeFiatMock(...args),
}));
useFeeFiatMock.mockReturnValue({
    formatNativeFee: () => '~$0.42',
    formatProtocolFee: () => null,
    formatFeeTotal: () => null,
});

afterEach(cleanup);

const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function titles(root = document) {
    return [...root.querySelectorAll('[data-form-section-title]')].map((el) => el.textContent);
}

function openFee() {
    fireEvent.click(screen.getByRole('button', { name: /^Network fee/, expanded: false }));
}

describe('Poll page ballot', () => {
    it('casts through From, the ballot, Memo, a Network fee section with fiat, and one Vote action', async () => {
        const chain = 'bitcoin-mainnet';
        render(
            <MessagingProvider shell="web" messaging={{
                governancePoll: vi.fn().mockResolvedValue({
                    action_index: 7, tick: 'VOTE', question: 'Pick one', options: ['A', 'B'],
                    tally_mode: 'approval', weight_mode: 'balance', max_selections: 1, end_block: 120, poll_status: 'open',
                }),
                getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
                getAddressesByChain: vi.fn().mockResolvedValue({ [chain]: [ADDRESS] }),
                getActiveAddresses: vi.fn().mockResolvedValue({ [chain]: { id: ADDRESS.id } }),
                governanceVotes: vi.fn().mockResolvedValue([]),
                getSettings: vi.fn().mockResolvedValue({}),
                signerReady: vi.fn().mockResolvedValue({ ready: true }),
            }}>
                <PollDetail walletId="wallet-1" chainId={chain} pollIndex={7} onBack={vi.fn()} />
            </MessagingProvider>,
        );
        await screen.findByRole('checkbox', { name: '0: A' });
        const form = screen.getByRole('form', { name: 'Vote' });
        expect(titles(form)).toEqual(['From', 'Memo', 'Network fee']);
        openFee();
        expect(screen.getAllByText(/~\$0\.42/).length).toBeGreaterThan(0);
        const vote = screen.getByRole('button', { name: 'Vote' });
        expect(vote.querySelector('svg')).not.toBeNull();
        expect(form.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    });
});

describe('Parallel action queue', () => {
    const chain = 'bitcoin-regtest';
    function mount() {
        const messaging = {
            getAddressesByChain: vi.fn(async () => ({ [chain]: [ADDRESS] })),
            getActiveAddresses: vi.fn(async () => ({ [chain]: ADDRESS })),
            listActions: vi.fn(async () => ['SEND']),
            getSettings: vi.fn(async () => ({})),
            signerReady: vi.fn(async () => ({ ready: true })),
            validateAction: vi.fn(async () => ({ valid: true, errors: [] })),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ParallelComposer
                    walletId="wallet-1"
                    onBack={() => {}}
                    initialRows={[
                        { chainId: chain, action: 'SEND', params: { VERSION: '0', TICK: 'TOKEN', AMOUNT: '1', DESTINATION: 'bc1qdestination' } },
                        { chainId: chain, action: 'SEND', params: { VERSION: '0', TICK: 'TOKEN', AMOUNT: '2', DESTINATION: 'bc1qdestination' } },
                    ]}
                />
            </MessagingProvider>,
        );
    }

    it('composes one collapsible section per row with Add action under them and one submit', async () => {
        mount();
        const form = await screen.findByRole('form', { name: 'Compose parallel actions' });
        expect(titles(form)).toEqual(['Row 1', 'Row 2']);
        const rowOne = screen.getByRole('button', { name: /^Row 1/ });
        expect(rowOne).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(rowOne);
        expect(rowOne).toHaveTextContent(/SEND|Send/);
        const add = screen.getByRole('button', { name: 'Add Action' });
        const sections = form.querySelectorAll('[data-form-section]');
        expect(sections[sections.length - 1].compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(form.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    });

    it('signs each row with the fee in the Network fee section, fiat included', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Sign and Send Queue' }));
        // The no-rollback fact is a notice on the review page, never an acknowledgement gate.
        const signAll = await screen.findByRole('button', { name: 'Sign all' });
        expect(screen.queryByRole('checkbox')).toBeNull();
        fireEvent.click(signAll);
        const form = await screen.findByRole('form', { name: 'Sign parallel actions' });
        expect(titles(form)).toEqual(['Network fee']);
        openFee();
        expect(screen.getAllByText(/~\$0\.42/).length).toBeGreaterThan(0);
    });
});

describe('Operator publisher', () => {
    it('publishes through From, the feed update, a Network fee section with fiat, and one action', async () => {
        const chain = 'bitcoin-mainnet';
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [chain]: [ADDRESS] }),
            getSettings: vi.fn().mockResolvedValue({}),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <OperatorPublisherMode
                    walletId="wallet-1"
                    chainId={chain}
                    address={ADDRESS.address}
                    feed={{ action_index: 41 }}
                    messaging={messaging}
                    variant="page"
                />
            </MessagingProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Enter publisher mode' }));
        const form = await screen.findByRole('form', { name: 'Publisher mode' });
        expect(titles(form)).toEqual(['From', 'Feed Update', 'Network fee']);
        expect(screen.getByRole('button', { name: /^Feed Update/ })).toHaveAttribute('aria-expanded', 'true');
        openFee();
        expect(screen.getAllByText(/~\$0\.42/).length).toBeGreaterThan(0);
        const publish = screen.getByRole('button', { name: 'Publish Value' });
        expect(publish.querySelector('svg')).not.toBeNull();
        expect(form.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    });
});
