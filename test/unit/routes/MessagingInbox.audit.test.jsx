// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MessagingInbox } from '../../../packages/core/src/shared/routes/MessagingInbox.jsx';

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

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('MessagingInbox audit states', () => {
    it('renders the address empty state when the account has no messageable addresses', async () => {
        mount(messagingFor({ addresses: {} }));

        expect(await screen.findByText(/This account has no addresses/)).toBeTruthy();
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
});
