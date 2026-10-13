// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';
import { serializeMessageContent } from '../../../packages/core/src/shared/utils/messageContent.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = Object.freeze({
    id: 'owner-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    role: 'receive',
});
const REQUEST = Object.freeze({
    format: 0,
    chainId: CHAIN,
    from: 'bc1qdevmock02ddeeff',
    to: OWNER.address,
    txid: 'request-tx',
    timestamp: 1,
});

function messagingFor({ addresses = { [CHAIN]: [OWNER] }, messages = [], ready = true } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(addresses),
        listContacts: vi.fn().mockResolvedValue([]),
        signerReady: vi.fn().mockResolvedValue({ ready }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: ready ? 'unlocked' : 'locked' }),
        getMessagingInboxSweep: vi.fn().mockResolvedValue({ messages, addresses: [], errors: [] }),
    };
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue({ rows: [] });
        },
    });
}

function mount(messaging) {
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(MessagingInbox, {
            walletId: 'wallet-1',
            activeAccountId: 'account-1',
            onCompose() {},
            onBack() {},
        }),
    ));
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function inboxTree(messaging, activeAccountId) {
    return React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(MessagingInbox, {
            walletId: 'wallet-1',
            activeAccountId,
            onCompose() {},
            onBack() {},
        }),
    );
}

function incoming({ from, to = OWNER.address, txid, text, timestamp }) {
    return { format: 3, chainId: CHAIN, from, to, txid, text, timestamp };
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    delete navigator.clipboard;
});

describe('MessagingInbox audit states', () => {
    it('renders the address empty state when the account has no messageable addresses', async () => {
        mount(messagingFor({ addresses: {} }));

        expect(await screen.findByText(/No messaging addresses/)).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('prompts a locked wallet for its password before loading messages', async () => {
        const messaging = messagingFor({ ready: false });
        mount(messaging);

        const password = await screen.findByLabelText('Password');
        const unlock = screen.getByRole('button', { name: 'Unlock inbox' });
        expect(unlock.disabled).toBe(true);

        fireEvent.change(password, { target: { value: 'secret' } });
        fireEvent.click(unlock);

        await waitFor(() => expect(messaging.getMessagingInboxSweep).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            addressIds: ['owner-1'],
            type: 'all',
            password: 'secret',
        }));
    });

    it('declines a session request and keeps it dismissed after reopening the inbox', async () => {
        const messaging = messagingFor({ messages: [REQUEST] });
        const first = mount(messaging);

        fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull());
        expect(screen.getByText('No messages yet')).toBeTruthy();

        first.unmount();
        mount(messaging);
        await screen.findByText('No messages yet');
        expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
    });

    it('does not offer an already-accepted session request again', async () => {
        mount(messagingFor({
            messages: [
                REQUEST,
                {
                    format: 1,
                    chainId: CHAIN,
                    from: OWNER.address,
                    to: REQUEST.from,
                    txid: 'response-tx',
                    timestamp: 2,
                },
            ],
        }));

        await screen.findByText('No messages yet');
        expect(screen.queryByRole('button', { name: 'Share my key' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
    });

    it('wraps long text, links only HTTP(S), opens links safely, and copies the message', async () => {
        const text = `A${'verylongword'.repeat(80)} https://example.com/path javascript:alert(1)`;
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        mount(messagingFor({ messages: [{
            format: 3,
            chainId: CHAIN,
            from: REQUEST.from,
            to: OWNER.address,
            txid: 'safe-link-tx',
            timestamp: 2,
            text,
        }] }));

        fireEvent.click(await screen.findByText(text));

        const safeLink = await screen.findByRole('link', { name: 'https://example.com/path' });
        expect(safeLink).toHaveAttribute('href', 'https://example.com/path');
        expect(safeLink).toHaveAttribute('target', '_blank');
        expect(safeLink.getAttribute('rel')).toContain('noopener');
        expect(screen.queryByRole('link', { name: /javascript:/i })).toBeNull();
        expect(getComputedStyle(safeLink.closest('div')).overflowWrap).toBe('anywhere');

        fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
    });

    it('renders a validated attachment as a download and omits its envelope from the preview', async () => {
        const text = serializeMessageContent('Quarterly notes', {
            name: 'notes.txt',
            type: 'text/plain',
            dataUrl: 'data:text/plain;base64,aGVsbG8=',
            size: 5,
        });
        mount(messagingFor({ messages: [{
            format: 3,
            chainId: CHAIN,
            from: REQUEST.from,
            to: OWNER.address,
            txid: 'attachment-tx',
            timestamp: 2,
            text,
        }] }));

        fireEvent.click(await screen.findByText('Quarterly notes'));

        const attachment = await screen.findByRole('link', { name: /notes\.txt \(5 bytes\)/ });
        expect(attachment).toHaveAttribute('download', 'notes.txt');
        expect(attachment.getAttribute('href')).toBe('data:text/plain;base64,aGVsbG8=');
        expect(document.body.textContent).not.toContain('xchain-attachment:v1');
    });
});

describe('MessagingInbox scope and thread isolation', () => {
    it('ignores an older account sweep after the next account finishes loading', async () => {
        const sweeps = { 'owner-a': deferred(), 'owner-b': deferred() };
        const messaging = messagingFor();
        messaging.getAddressesByChain.mockImplementation((_walletId, accountId) => Promise.resolve({
            [CHAIN]: [{ ...OWNER, id: `owner-${accountId}` }],
        }));
        messaging.getMessagingInboxSweep.mockImplementation(({ addressIds }) => (
            sweeps[addressIds[0]].promise
        ));

        const utils = render(inboxTree(messaging, 'a'));
        await waitFor(() => expect(messaging.getMessagingInboxSweep).toHaveBeenCalledWith(
            expect.objectContaining({ addressIds: ['owner-a'] }),
        ));

        utils.rerender(inboxTree(messaging, 'b'));
        await waitFor(() => expect(messaging.getMessagingInboxSweep).toHaveBeenCalledWith(
            expect.objectContaining({ addressIds: ['owner-b'] }),
        ));

        await act(async () => {
            sweeps['owner-b'].resolve({
                messages: [incoming({ from: 'peer-b', txid: 'tx-b', text: 'account B', timestamp: 2 })],
            });
            await Promise.resolve();
        });
        expect(await screen.findByText('account B')).toBeTruthy();

        await act(async () => {
            sweeps['owner-a'].resolve({
                messages: [incoming({ from: 'peer-a', txid: 'tx-a', text: 'account A', timestamp: 3 })],
            });
            await Promise.resolve();
        });
        expect(screen.getByText('account B')).toBeTruthy();
        expect(screen.queryByText('account A')).toBeNull();
    });

    it('writes opened-thread read state only to the active account scope', async () => {
        const messaging = messagingFor();
        messaging.getAddressesByChain.mockImplementation((_walletId, accountId) => Promise.resolve({
            [CHAIN]: [{ ...OWNER, id: `owner-${accountId}` }],
        }));
        messaging.getMessagingInboxSweep.mockImplementation(({ addressIds }) => {
            const suffix = addressIds[0].slice(-1);
            return Promise.resolve({
                messages: [incoming({
                    from: `peer-${suffix}`,
                    txid: `tx-${suffix}`,
                    text: `account ${suffix.toUpperCase()}`,
                    timestamp: suffix === 'a' ? 1 : 2,
                })],
            });
        });

        const utils = render(inboxTree(messaging, 'a'));
        expect(await screen.findByText('account A')).toBeTruthy();
        utils.rerender(inboxTree(messaging, 'b'));
        fireEvent.click(await screen.findByText('account B'));

        const accountB = JSON.parse(localStorage.getItem('xc:msgRead:wallet-1:b'));
        expect(accountB).toEqual({ 'peer-b': ['tx-b'] });
        expect(localStorage.getItem('xc:msgRead:wallet-1:a')).toBeNull();
    });

    it('keeps a separate docked-composer draft for each conversation', async () => {
        mount(messagingFor({ messages: [
            incoming({ from: 'peer-a', txid: 'tx-a', text: 'message A', timestamp: 2 }),
            incoming({ from: 'peer-b', txid: 'tx-b', text: 'message B', timestamp: 1 }),
        ] }));

        fireEvent.click(await screen.findByText('message A'));
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'draft for A' } });
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        fireEvent.click(screen.getByText('message B'));
        expect(screen.getByLabelText('Message').value).toBe('');
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'draft for B' } });
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        fireEvent.click(screen.getByText('message A'));
        expect(screen.getByLabelText('Message').value).toBe('draft for A');
    });
});
