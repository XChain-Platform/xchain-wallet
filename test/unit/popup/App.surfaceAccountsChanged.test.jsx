// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An account added or renamed in another surface (the popup while the side
// panel is open, or the reverse) reaches this surface as an `accounts` event.
// The event is news about the wallet's account list, not a switch: this
// surface keeps acting for the account it shows, even though the other
// surface stored its own choice when it added the account.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../packages/extension/src/popup/App.jsx';
import { SURFACE_STATE_STORAGE_KEY } from '../../../packages/extension/src/shared/surfaceStateSync.js';

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

const ACCOUNT_SCOPED = new Set(['addresses.byChain', 'addresses.active', 'balances.wallet', 'addresses.newest']);

function boot({ accounts, deferBalanceAccountId = null }) {
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    const listeners = new Set();
    const state = { accounts: accounts.map((a) => ({ ...a })) };
    const sent = [];
    const deferredBalanceCallbacks = [];
    vi.stubGlobal('chrome', {
        runtime: {
            lastError: undefined,
            getURL: (path) => `chrome-extension://wallet/${path}`,
            sendMessage: vi.fn((message, callback) => {
                sent.push({ type: message.type, request: message.request ?? message.payload ?? message });
                if (message.type === 'session.status') {
                    callback({ ok: true, result: { state: 'unlocked' } });
                } else if (message.type === 'wallet.list') {
                    callback({ ok: true, result: [{ id: 'w1', name: 'Alpha' }] });
                } else if (message.type === 'account.list') {
                    callback({ ok: true, result: state.accounts.map((a) => ({ ...a })) });
                } else if (message.type === 'balances.wallet'
                    && message.request?.accountId === deferBalanceAccountId) {
                    deferredBalanceCallbacks.push(callback);
                } else {
                    callback({ ok: false, error: { name: 'Error', message: 'not available' } });
                }
            }),
        },
        storage: {
            onChanged: {
                addListener: (listener) => listeners.add(listener),
                removeListener: (listener) => listeners.delete(listener),
            },
            local: { get: (_key, callback) => callback({}) },
            session: { get: (_key, callback) => callback({}) },
        },
    });
    const emit = (kind, payload) => act(async () => {
        for (const listener of listeners) {
            listener({
                [SURFACE_STATE_STORAGE_KEY]: { newValue: { kind, payload, revision: String(Math.random()) } },
            }, 'session');
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const releaseDeferredBalances = () => act(async () => {
        for (const callback of deferredBalanceCallbacks.splice(0)) {
            callback({ ok: false, error: { name: 'Error', message: 'not available' } });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { state, sent, emit, releaseDeferredBalances };
}

// The account id carried by account-scoped reads made after `from`.
function accountIdsAfter(sent, from) {
    return sent.slice(from)
        .filter((entry) => ACCOUNT_SCOPED.has(entry.type))
        .map((entry) => entry.request?.accountId)
        .filter((id) => typeof id === 'string');
}

describe('an accounts event from another surface', () => {
    it('keeps this surface on its own account when the other surface adds one', async () => {
        const { state, sent, emit } = boot({ accounts: [{ id: 'a1', walletId: 'w1', index: 0, name: 'Account 1' }] });
        localStorage.setItem('xchain.activeWallet', 'w1');
        localStorage.setItem('xc:activeAccount:w1', 'a1');
        render(<App />);
        await waitFor(() => expect(accountIdsAfter(sent, 0)).toContain('a1'));

        // The other surface adds a2 and, as its Add account flow does, stores
        // a2 as its own active account in the storage both surfaces share.
        state.accounts.push({ id: 'a2', walletId: 'w1', index: 1, name: 'Account 2' });
        localStorage.setItem('xc:activeAccount:w1', 'a2');
        const mark = sent.length;
        await emit('accounts', { change: 'added', walletId: 'w1', accountId: 'a2' });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

        expect(accountIdsAfter(sent, mark)).not.toContain('a2');
    });

    it('moves to a surviving account when the one it shows is gone', async () => {
        const { state, sent, emit } = boot({ accounts: [
            { id: 'a1', walletId: 'w1', index: 0, name: 'Account 1' },
            { id: 'a2', walletId: 'w1', index: 1, name: 'Account 2' },
        ] });
        localStorage.setItem('xchain.activeWallet', 'w1');
        localStorage.setItem('xc:activeAccount:w1', 'a2');
        render(<App />);
        await waitFor(() => expect(accountIdsAfter(sent, 0)).toContain('a2'));
        // The first matching request does not mean the other initial Home
        // effects have run. Drain them so the mark starts at the event boundary.
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

        state.accounts = [{ id: 'a1', walletId: 'w1', index: 0, name: 'Account 1' }];
        const mark = sent.length;
        await emit('accounts', { change: 'renamed', walletId: 'w1', accountId: 'a1' });
        await waitFor(() => expect(accountIdsAfter(sent, mark)).toContain('a1'));
        expect(accountIdsAfter(sent, mark)).not.toContain('a2');
    });

    it('does not continue an in-flight load for the removed account', async () => {
        const { state, sent, emit, releaseDeferredBalances } = boot({
            accounts: [
                { id: 'a1', walletId: 'w1', index: 0, name: 'Account 1' },
                { id: 'a2', walletId: 'w1', index: 1, name: 'Account 2' },
            ],
            deferBalanceAccountId: 'a2',
        });
        localStorage.setItem('xchain.activeWallet', 'w1');
        localStorage.setItem('xc:activeAccount:w1', 'a2');
        render(<App />);
        await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({
            type: 'balances.wallet',
            request: expect.objectContaining({ accountId: 'a2' }),
        })));

        state.accounts = [{ id: 'a1', walletId: 'w1', index: 0, name: 'Account 1' }];
        await emit('accounts', { change: 'removed', walletId: 'w1', accountId: 'a2' });
        await waitFor(() => expect(accountIdsAfter(sent, 0)).toContain('a1'));
        const mark = sent.length;
        await releaseDeferredBalances();

        expect(accountIdsAfter(sent, mark)).not.toContain('a2');
    });
});

describe('a record event from another surface', () => {
    for (const [kind, payload] of [
        ['accounts', { change: 'added', walletId: 'w1', accountId: 'a2' }],
        ['accounts', { change: 'renamed', walletId: 'w1', accountId: 'a1' }],
        ['wallets', { change: 'renamed', walletId: 'w1' }],
    ]) {
        it(`leaves the open Home screen mounted on ${kind} ${payload.change}`, async () => {
            const { state, sent, emit } = boot({ accounts: [{ id: 'a1', walletId: 'w1', index: 0, name: 'Account 1' }] });
            localStorage.setItem('xchain.activeWallet', 'w1');
            localStorage.setItem('xc:activeAccount:w1', 'a1');
            render(<App />);
            await waitFor(() => expect(accountIdsAfter(sent, 0)).toContain('a1'));
            const heading = await screen.findByRole('heading', { name: 'Home', level: 1 });

            state.accounts.push({ id: 'a2', walletId: 'w1', index: 1, name: 'Account 2' });
            await emit(kind, payload);
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

            // A remount would replace the screen and drop whatever it holds.
            expect(heading.isConnected).toBe(true);
        });
    }
});
