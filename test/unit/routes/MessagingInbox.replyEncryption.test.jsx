// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A thread reply carries the conversation's encryption onto the compose
// form, locked. The SDK turns an indexer's unrecognised encryption_method
// into NaN, so an encrypted conversation can reach the inbox with no method
// it knows. Such a thread is still encrypted, and its replies stay encrypted.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';

const CHAIN = 'bitcoin-testnet';
const OWN = 'tb1qownaownaownaownaownaownaownaownaowna';
const STRANGER = 'tb1qstrangerstrangerstrangerstrangerstra';

function mount(messages) {
    const onCompose = vi.fn();
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'a1', address: OWN, source: 'hd', role: 'receive' }],
        }),
        listContacts: vi.fn().mockResolvedValue([]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getMessagingInboxSweep: vi.fn().mockResolvedValue({ messages, addresses: [OWN], errors: [] }),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MessagingInbox, { walletId: 'w', onCompose, onBack() {} }),
        ),
    );
    return onCompose;
}

async function replyFrom(messages) {
    const onCompose = mount(messages);
    fireEvent.click(await screen.findByText('🔒 Encrypted message'));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'reply body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onCompose).toHaveBeenCalledTimes(1);
    return onCompose.mock.calls[0][0];
}

function encrypted(overrides) {
    return {
        format: 2, chainId: CHAIN, from: STRANGER, to: OWN, txid: 'tx-1',
        timestamp: 1788300158, text: null, encrypted: true,
        ...overrides,
    };
}

afterEach(() => cleanup());

describe('MessagingInbox reply encryption', () => {
    it('keeps a reply encrypted when the thread method is not a number the inbox knows', async () => {
        const prefill = await replyFrom([encrypted({ method: Number.NaN })]);
        expect(prefill.fixedEncryption).toBe('ecies');
    });

    it('keeps a reply encrypted when an encrypted thread carries no method', async () => {
        const prefill = await replyFrom([encrypted({ method: null })]);
        expect(prefill.fixedEncryption).toBe('ecies');
    });

    it('locks a reply to plaintext only for a thread with no encrypted message', async () => {
        const onCompose = mount([{
            format: 3, chainId: CHAIN, from: STRANGER, to: OWN, txid: 'tx-p',
            timestamp: 1788300158, text: 'plain hello', encrypted: false, method: null,
        }]);
        fireEvent.click(await screen.findByText('plain hello'));
        fireEvent.change(await screen.findByRole('textbox', { name: 'Message' }), { target: { value: 'reply body' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onCompose.mock.calls[0][0].fixedEncryption).toBe('plaintext');
    });
});
