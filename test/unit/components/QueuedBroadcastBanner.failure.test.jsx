// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A failed "Broadcast now" re-lists the queue, so a row the host removed
// before throwing leaves at once, and the user reads plain words for what happened.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

let queue = [];
let broadcastImpl = async () => {};
let discardImpl = async () => {};
const toasts = [];

// One stable messaging object, as the provider gives: a fresh one per render
// re-arms the banner's list effect on every render.
const messaging = {
    listQueuedBroadcasts: async () => queue,
    broadcastQueuedRequest: (req) => broadcastImpl(req),
    discardQueuedRequest: (req) => discardImpl(req),
};
const toastApi = { showToast: (t) => { toasts.push(t); } };

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({ overall: 'normal' }),
}));

vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => toastApi,
}));

const { QueuedBroadcastBanner, queuedBroadcastFailure } = await import(
    '../../../packages/core/src/shared/components/QueuedBroadcastBanner.jsx');

afterEach(() => {
    cleanup();
    queue = [];
    toasts.length = 0;
    broadcastImpl = async () => {};
    discardImpl = async () => {};
});

function entry(id, summary) {
    return { id, chainId: 'bitcoin-mainnet', summary, signedAt: Date.now() };
}

function named(name, message) {
    const err = new Error(message);
    err.name = name;
    return err;
}

async function renderWith(rows) {
    queue = rows;
    render(<QueuedBroadcastBanner walletId="w1" intervalMs={0} />);
    await screen.findByText(rows[0].summary);
}

function pressBroadcast(index = 0) {
    fireEvent.click(screen.getAllByRole('button', { name: /broadcast now/i })[index]);
}

describe('QueuedBroadcastBanner after a failed broadcast', () => {
    it('drops a permanently rejected row at once and says it was removed', async () => {
        await renderWith([entry('a', 'Send 1 XCP'), entry('b', 'Send 2 XCP')]);
        broadcastImpl = async ({ id }) => {
            queue = queue.filter((e) => e.id !== id);
            throw named('BroadcastFailedPermanentError', 'Encoder RPC error: bad-txns-inputs-missingorspent');
        };
        pressBroadcast();
        await waitFor(() => expect(screen.queryByText('Send 1 XCP')).toBeNull());
        expect(screen.getByText('Send 2 XCP')).toBeTruthy();
        expect(toasts).toHaveLength(1);
        expect(toasts[0].message).toMatch(/removed from the queue/);
        expect(toasts[0].message).not.toMatch(/Encoder RPC/);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('keeps a transiently failed row and says it is still queued', async () => {
        await renderWith([entry('a', 'Send 1 XCP')]);
        broadcastImpl = async () => {
            throw named('BroadcastFailedTransientError', 'Encoder RPC error: ETIMEDOUT');
        };
        pressBroadcast();
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/still queued/);
        expect(alert.textContent).not.toMatch(/automatically/);
        expect(screen.getByText('Send 1 XCP')).toBeTruthy();
        expect(toasts).toHaveLength(0);
    });

    it('drops a row the host refused as no longer queued without telling the user to compose again', async () => {
        await renderWith([entry('a', 'Send 1 XCP')]);
        broadcastImpl = async ({ id }) => {
            queue = queue.filter((e) => e.id !== id);
            throw new Error(`broadcast.queue: entry "${id}" is no longer queued in the vault, so its bytes were not sent; compose a fresh transaction`);
        };
        pressBroadcast();
        await waitFor(() => expect(screen.queryByText('Send 1 XCP')).toBeNull());
        expect(toasts).toHaveLength(1);
        expect(toasts[0].message).toMatch(/no longer in the queue/);
        expect(toasts[0].message).not.toMatch(/broadcast\.queue:|compose/i);
    });

    it('shows an unrelated error as before while the row is still queued', async () => {
        await renderWith([entry('a', 'Send 1 XCP')]);
        broadcastImpl = async () => { throw new Error('boom'); };
        pressBroadcast();
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toBe('boom');
        expect(screen.getByText('Send 1 XCP')).toBeTruthy();
    });

    it('re-lists after a failed discard so a row the host already removed leaves', async () => {
        await renderWith([entry('a', 'Send 1 XCP'), entry('b', 'Send 2 XCP')]);
        discardImpl = async ({ id }) => {
            queue = queue.filter((e) => e.id !== id);
            throw new Error('vault refused');
        };
        fireEvent.click(screen.getAllByRole('button', { name: /discard/i })[0]);
        await waitFor(() => expect(screen.queryByText('Send 1 XCP')).toBeNull());
        expect(screen.getByText('Send 2 XCP')).toBeTruthy();
    });
});

describe('queuedBroadcastFailure', () => {
    it('treats a permanent verdict as removed when the queue could not be re-read', () => {
        const out = queuedBroadcastFailure(named('BroadcastFailedPermanentError', 'x'), null, 'a');
        expect(out.removed).toBe(true);
    });

    it('trusts a re-listed queue that still holds the row', () => {
        const out = queuedBroadcastFailure(named('BroadcastFailedPermanentError', 'x'), [{ id: 'a' }], 'a');
        expect(out).toEqual({ removed: false, message: 'x' });
    });
});
