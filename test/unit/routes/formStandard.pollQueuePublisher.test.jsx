// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The poll page's ballot and the parallel action queue sit on the Form
// Standard, and each routes its fee through the shared Network fee section,
// so the fee shows its fiat value like every other form.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';

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
    fireEvent.click(screen.getByRole('button', { name: /^Speed and Fees/, expanded: false }));
}

describe('Poll page ballot', () => {
    it('casts on Cast Vote through From, the vote, Memo, a Network fee section with fiat, and one Sign Vote action', async () => {
        const chain = 'bitcoin-mainnet';
        const governanceVotes = vi.fn().mockResolvedValue([]);
        render(
            <MessagingProvider shell="web" messaging={{
                governancePoll: vi.fn().mockResolvedValue({
                    action_index: 7, tick: 'VOTE', question: 'Pick one', options: ['A', 'B'],
                    tally_mode: 'approval', weight_mode: 'balance', max_selections: 1, end_block: 120, poll_status: 'open',
                }),
                getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
                getAddressesByChain: vi.fn().mockResolvedValue({ [chain]: [ADDRESS] }),
                getActiveAddresses: vi.fn().mockResolvedValue({ [chain]: { id: ADDRESS.id } }),
                governanceVotes,
                getSettings: vi.fn().mockResolvedValue({}),
                signerReady: vi.fn().mockResolvedValue({ ready: true }),
            }}>
                <PollDetail walletId="wallet-1" chainId={chain} pollIndex={7} onBack={vi.fn()} />
            </MessagingProvider>,
        );
        // The page reads this wallet's own vote per address, then settles.
        await waitFor(() => expect(governanceVotes).toHaveBeenCalledWith({ chainId: chain, query: ADDRESS.address, type: 'address' }));
        await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
        // The poll page holds no form; a choice row opens the Cast Vote form.
        expect(document.querySelector('form')).toBeNull();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Vote for A' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Vote for A' }));
        const form = await screen.findByRole('form', { name: 'Cast Vote' });
        expect(titles(form)).toEqual(['From', 'Vote', 'Memo', 'Advanced', 'Speed and Fees']);
        openFee();
        expect(screen.getAllByText(/~\$0\.42/).length).toBeGreaterThan(0);
        const sign = screen.getByRole('button', { name: 'Sign Vote' });
        expect(sign.querySelector('svg')).not.toBeNull();
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
        // Each queued row is its own confirmation, so the queue page offers
        // no Advanced choices (FeeSection advanced={false}).
        expect(titles(form)).toEqual(['Speed and Fees']);
        openFee();
        expect(screen.getAllByText(/~\$0\.42/).length).toBeGreaterThan(0);
    });
});
