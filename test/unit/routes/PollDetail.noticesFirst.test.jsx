// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every notice is the first item of the page content. The poll page drew the
// ballot error above the voting form but under the poll's terms and results,
// where a voter tapping Vote from the bottom of the page never saw it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PollDetail } from '../../../packages/core/src/shared/routes/PollDetail.jsx';
import { markDemoWallet, clearDemoWalletId } from '../../../packages/core/src/flows/demoMode.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qvotervotervotervotervotervoterxx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function messagingFor() {
    return {
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
    };
}

function precedes(a, b) {
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
});

describe('Poll page notices', () => {
    // The Form Standard puts a form's errors in one slot just above its
    // action. A choice row always opens Cast Vote with a choice made, so a
    // ballot error can only come from Sign Vote, and it sits just above it.
    it('shows the ballot error in the status slot just above Sign Vote', async () => {
        render(
            <MessagingProvider shell="web" messaging={messagingFor()}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={7} onBack={vi.fn()} />
            </MessagingProvider>,
        );
        const stable = await screen.findByRole('button', { name: 'Vote for Stable' });
        await waitFor(() => expect(stable).toBeEnabled());
        await act(async () => {
            fireEvent.click(stable);
        });
        const change = await screen.findByRole('button', { name: 'Change your choice' });
        await act(async () => {
            fireEvent.click(change);
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('checkbox', { name: '0: Stable' }));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Sign Vote' }));
        });
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('Choose at least one option');
        expect(alert.closest('[data-form-status]')).not.toBeNull();
        expect(precedes(alert, screen.getByRole('button', { name: 'Sign Vote' }))).toBe(true);
        expect(precedes(alert, screen.getByText('Choose a release channel'))).toBe(true);
    });

    // A demo wallet gets no standing notice (ruling 2026-11-13); whether Vote
    // refuses on press is PollDetail's own test.
    it('shows no demo notice in a demo wallet', async () => {
        markDemoWallet('wallet-1');
        render(
            <MessagingProvider shell="web" messaging={messagingFor()}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={7} onBack={vi.fn()} />
            </MessagingProvider>,
        );
        await screen.findByRole('button', { name: 'Vote for Stable' });
        expect(document.querySelectorAll('[data-variant]')).toHaveLength(0);
        expect(screen.queryByText(/Demo wallets can.t move funds/)).toBeNull();
    });
});
