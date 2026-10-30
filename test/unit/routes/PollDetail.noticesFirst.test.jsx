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
// ballot error, and in a demo wallet the demo note, above the voting form but
// under the poll's terms and results, where a voter tapping Vote from the
// bottom of the page never saw them.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
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
    it('shows the ballot error before the poll terms', async () => {
        render(
            <MessagingProvider shell="web" messaging={messagingFor()}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={7} onBack={vi.fn()} />
            </MessagingProvider>,
        );
        await screen.findByRole('checkbox', { name: '0: Stable' });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Vote' }));
        });
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('Choose at least one option');
        expect(precedes(alert, screen.getByText('Choose a release channel'))).toBe(true);
    });

    it('shows the demo note once, before the poll terms, and keeps Vote disabled', async () => {
        markDemoWallet('wallet-1');
        render(
            <MessagingProvider shell="web" messaging={messagingFor()}>
                <PollDetail walletId="wallet-1" chainId={CHAIN} pollIndex={7} onBack={vi.fn()} />
            </MessagingProvider>,
        );
        await screen.findByRole('checkbox', { name: '0: Stable' });
        const notes = document.querySelectorAll('[data-variant]');
        expect(notes.length).toBe(1);
        expect(precedes(notes[0], screen.getByText('Choose a release channel'))).toBe(true);
        expect(screen.getByRole('button', { name: 'Vote' })).toBeDisabled();
    });
});
