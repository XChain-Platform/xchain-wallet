// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A failed send re-lists the queue, so a row the host removed
// before throwing leaves at once, and the user reads plain words for what happened.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

let queue = [];
let broadcastImpl = async () => {};
let discardImpl = async () => {};
let listImpl = async () => queue;
let reachabilityOverall = 'normal';
const toasts = [];

// One stable messaging object, as the provider gives: a fresh one per render
// re-arms the banner's list effect on every render.
const messaging = {
    listQueuedBroadcasts: (req) => listImpl(req),
    broadcastQueuedRequest: (req) => broadcastImpl(req),
    discardQueuedRequest: (req) => discardImpl(req),
};
const toastApi = { showToast: (t) => { toasts.push(t); } };

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({ overall: reachabilityOverall }),
}));

vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => toastApi,
}));

const { QueuedBroadcastBanner, queuedBroadcastFailure } = await import(
    '../../../packages/core/src/shared/components/QueuedBroadcastBanner.jsx');

afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('data-xc-reduced-motion');
    queue = [];
    toasts.length = 0;
    broadcastImpl = async () => {};
    discardImpl = async () => {};
    listImpl = async () => queue;
    reachabilityOverall = 'normal';
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
    fireEvent.click(screen.getAllByRole('button', { name: /send now/i })[index]);
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

    it('hides an unrelated host error while the row is still waiting to send', async () => {
        await renderWith([entry('a', 'Send 1 XCP')]);
        broadcastImpl = async () => { throw new Error('boom'); };
        pressBroadcast();
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toBe('Could not send this transaction. It is still waiting to send. Try again.');
        expect(screen.getByText('Send 1 XCP')).toBeTruthy();
    });

    it('re-lists after a failed discard so a row the host already removed leaves', async () => {
        await renderWith([entry('a', 'Send 1 XCP'), entry('b', 'Send 2 XCP')]);
        discardImpl = async ({ id }) => {
            queue = queue.filter((e) => e.id !== id);
            throw new Error('vault refused');
        };
        fireEvent.click(screen.getAllByRole('button', { name: /remove from queue/i })[0]);
        await waitFor(() => expect(screen.queryByText('Send 1 XCP')).toBeNull());
        expect(screen.getByText('Send 2 XCP')).toBeTruthy();
        expect(toasts.at(-1)?.message).toBe('Transaction removed from the queue.');
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('QueuedBroadcastBanner actions and announcements', () => {
    it('renders only one action row for a duplicate queue id', async () => {
        await renderWith([entry('same', 'First copy'), entry('same', 'Duplicate copy')]);
        expect(screen.getByText('First copy')).toBeTruthy();
        expect(screen.queryByText('Duplicate copy')).toBeNull();
        expect(screen.getAllByRole('button', { name: /send now/i })).toHaveLength(1);
    });

    it('admits only one broadcast when clicks are batched before a rerender', async () => {
        let finish;
        broadcastImpl = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        await renderWith([entry('a', 'Send 1 XCP')]);
        const button = screen.getByRole('button', { name: 'Send now: Send 1 XCP' });

        act(() => {
            button.click();
            button.click();
        });

        expect(broadcastImpl).toHaveBeenCalledTimes(1);
        finish();
        await waitFor(() => expect(toasts.some((toast) => toast.message === 'Transaction sent.')).toBe(true));
    });

    it('does not let an old wallet refresh replace the current wallet queue', async () => {
        let resolveFirst;
        let resolveSecond;
        listImpl = ({ walletId }) => new Promise((resolve) => {
            if (walletId === 'w1') resolveFirst = resolve;
            else resolveSecond = resolve;
        });
        const view = render(<QueuedBroadcastBanner walletId="w1" intervalMs={0} />);
        view.rerender(<QueuedBroadcastBanner walletId="w2" intervalMs={0} />);

        await act(async () => { resolveSecond([entry('new', 'Current wallet send')]); });
        expect(screen.getByText('Current wallet send')).toBeTruthy();
        await act(async () => { resolveFirst([entry('old', 'Old wallet send')]); });

        expect(screen.getByText('Current wallet send')).toBeTruthy();
        expect(screen.queryByText('Old wallet send')).toBeNull();
    });

    it('does not refresh or toast after a broadcast finishes following unmount', async () => {
        let finish;
        let listCalls = 0;
        listImpl = async () => {
            listCalls += 1;
            return queue;
        };
        broadcastImpl = () => new Promise((resolve) => { finish = resolve; });
        queue = [entry('a', 'Send 1 XCP')];
        const view = render(<QueuedBroadcastBanner walletId="w1" intervalMs={0} />);
        await screen.findByText('Send 1 XCP');
        pressBroadcast();
        view.unmount();

        await act(async () => { finish(); });

        expect(listCalls).toBe(1);
        expect(toasts).toHaveLength(0);
    });

    it('keeps the static queue count out of a competing live region', async () => {
        await renderWith([entry('a', 'Send 1 XCP')]);
        expect(screen.getByText('Waiting to send (1)')).not.toHaveAttribute('aria-live');
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.getByRole('button', { name: 'Send now: Send 1 XCP' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Remove from queue: Send 1 XCP' })).toBeEnabled();
    });

    it('disables every row action while one transaction is being sent', async () => {
        let finish;
        broadcastImpl = () => new Promise((resolve) => { finish = resolve; });
        await renderWith([entry('a', 'Send 1 XCP'), entry('b', 'Send 2 XCP')]);
        pressBroadcast();
        await waitFor(() => {
            for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
        });
        expect(screen.getByRole('button', { name: 'Sending: Send 1 XCP' })).toBeDisabled();
        finish();
        await waitFor(() => expect(toasts.some((toast) => toast.message === 'Transaction sent.')).toBe(true));
    });

    it('removes a successfully handled row when the follow-up list cannot be read', async () => {
        await renderWith([entry('a', 'Send 1 XCP')]);
        listImpl = async () => { throw new Error('list unavailable'); };
        pressBroadcast();
        await waitFor(() => expect(screen.queryByText('Send 1 XCP')).toBeNull());
        expect(toasts.at(-1)).toMatchObject({ message: 'Transaction sent.', variant: 'success' });
    });

    it('moves focus without smooth scrolling when app reduced motion is active', async () => {
        document.documentElement.setAttribute('data-xc-reduced-motion', 'reduce');
        reachabilityOverall = 'offline';
        queue = [entry('a', 'Send 1 XCP')];
        const view = render(<QueuedBroadcastBanner walletId="w1" intervalMs={0} />);
        await screen.findByText('Send 1 XCP');
        const scrollIntoView = vi.fn();
        HTMLElement.prototype.scrollIntoView = scrollIntoView;

        reachabilityOverall = 'normal';
        view.rerender(<QueuedBroadcastBanner walletId="w1" intervalMs={0} />);
        await waitFor(() => expect(toasts.at(-1)?.actionLabel).toBe('Review'));
        toasts.at(-1).onAction();

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Send now: Send 1 XCP' }));
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    });
});

describe('queuedBroadcastFailure', () => {
    it('treats a permanent verdict as removed when the queue could not be re-read', () => {
        const out = queuedBroadcastFailure(named('BroadcastFailedPermanentError', 'x'), null, 'a');
        expect(out.removed).toBe(true);
    });

    it('trusts a re-listed queue that still holds the row', () => {
        const out = queuedBroadcastFailure(named('BroadcastFailedPermanentError', 'x'), [{ id: 'a' }], 'a');
        expect(out).toEqual({
            removed: false,
            message: 'Could not send this transaction. It is still waiting to send. Try again.',
        });
    });
});
