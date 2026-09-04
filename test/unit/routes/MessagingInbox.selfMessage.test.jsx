// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A MESSAGE between two of the account's OWN addresses used to vanish: the
// conversation key is "whichever endpoint isn't ours", and when both are ours
// that was null, so the message was dropped from every bucket and the inbox
// rendered its empty state. The send confirmed on-chain and cost a real fee,
// which made the silence look like a send-side failure.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';

const CHAIN = 'bitcoin-testnet';
const OWN_A = 'tb1qownaownaownaownaownaownaownaownaowna';
const OWN_B = 'mownBownBownBownBownBownBownBow';
const STRANGER = 'tb1qstrangerstrangerstrangerstrangerstra';

function message(overrides) {
    return {
        format: 2, method: 1, chainId: CHAIN,
        timestamp: 1788300158, text: 'note to self',
        ...overrides,
    };
}

function mount(messages) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [
                { id: 'a1', address: OWN_A, source: 'hd', role: 'receive' },
                { id: 'a2', address: OWN_B, source: 'hd', role: 'receive' },
            ],
        }),
        listContacts: vi.fn().mockResolvedValue([]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getMessagingInboxSweep: vi.fn().mockResolvedValue({ messages, addresses: [], errors: [] }),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MessagingInbox, {
                walletId: 'w',
                onCompose() {},
                onBack() {},
            }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

describe('MessagingInbox self-addressed messages', () => {
    it('lists a message between two of the account\'s own addresses', async () => {
        mount([message({ from: OWN_A, to: OWN_B, txid: 'tx-self' })]);

        expect(await screen.findByText('note to self')).toBeInTheDocument();
        expect(screen.queryByText('No messages for this account yet.')).not.toBeInTheDocument();
    });

    it('labels the self conversation rather than showing a bare own address', async () => {
        mount([message({ from: OWN_A, to: OWN_B, txid: 'tx-self' })]);

        await screen.findByText('note to self');
        expect(screen.getByText(/You/)).toBeInTheDocument();
    });

    it('opens the self conversation as a thread carrying the message', async () => {
        mount([message({ from: OWN_A, to: OWN_B, txid: 'tx-self' })]);

        fireEvent.click(await screen.findByText('note to self'));

        // The thread filter keys on the same value, so an unfixed
        // counterpartyOf renders "No messages in this conversation."
        expect(await screen.findByText('note to self')).toBeInTheDocument();
        expect(screen.queryByText('No messages in this conversation.')).not.toBeInTheDocument();
    });

    it('still keys an ordinary conversation on the other party, not on us', async () => {
        mount([message({ from: STRANGER, to: OWN_A, txid: 'tx-in', text: 'from outside' })]);

        expect(await screen.findByText('from outside')).toBeInTheDocument();
        expect(screen.queryByText(/You/)).not.toBeInTheDocument();
    });
});
