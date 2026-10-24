// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A popup or side panel that shows a wallet another surface removed leaves it:
// it reloads the session and lands on a surviving wallet or on Welcome, and
// never keeps acting on the removed wallet.

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

function boot({ wallets }) {
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    const listeners = new Set();
    const state = { wallets: wallets.map((w) => ({ ...w })), session: 'unlocked' };
    const sent = [];
    vi.stubGlobal('chrome', {
        runtime: {
            lastError: undefined,
            getURL: (path) => `chrome-extension://wallet/${path}`,
            sendMessage: vi.fn((message, callback) => {
                sent.push(message.type);
                if (message.type === 'session.status') {
                    callback({ ok: true, result: { state: state.session } });
                } else if (message.type === 'wallet.list') {
                    callback({ ok: true, result: state.wallets });
                } else if (message.type === 'account.list') {
                    callback({ ok: true, result: [] });
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
    return { state, sent, emit };
}

const count = (sent, type) => sent.filter((entry) => entry === type).length;

describe('popup reacts to a wallet removed in another surface', () => {
    it('lands on Welcome when the removed wallet was the last one', async () => {
        const { state, sent, emit } = boot({ wallets: [{ id: 'w1', name: 'Alpha' }] });
        localStorage.setItem('xchain.activeWallet', 'w1');
        render(<App />);
        await waitFor(() => expect(count(sent, 'wallet.list')).toBeGreaterThan(0));

        state.wallets = [];
        state.session = 'no-wallet';
        const sessionReads = count(sent, 'session.status');
        await emit('wallets', { change: 'removed', walletId: 'w1' });

        expect(await screen.findByRole('button', { name: 'Create new wallet' })).toBeInTheDocument();
        expect(count(sent, 'session.status')).toBeGreaterThan(sessionReads);
    });

    it('reloads the session when the shown wallet is removed and a wallet remains', async () => {
        const { state, sent, emit } = boot({
            wallets: [{ id: 'w1', name: 'Alpha' }, { id: 'w2', name: 'Beta' }],
        });
        render(<App />);
        await waitFor(() => expect(count(sent, 'wallet.list')).toBeGreaterThan(0));

        state.wallets = [{ id: 'w2', name: 'Beta' }];
        const sessionReads = count(sent, 'session.status');
        const listReads = count(sent, 'wallet.list');
        await emit('wallets', { change: 'removed', walletId: 'w1' });

        await waitFor(() => expect(count(sent, 'session.status')).toBeGreaterThan(sessionReads));
        await waitFor(() => expect(count(sent, 'wallet.list')).toBeGreaterThan(listReads));
    });

    it('keeps the session when a wallet that is not shown is removed', async () => {
        const { state, sent, emit } = boot({
            wallets: [{ id: 'w1', name: 'Alpha' }, { id: 'w2', name: 'Beta' }],
        });
        render(<App />);
        await waitFor(() => expect(count(sent, 'wallet.list')).toBeGreaterThan(0));

        state.wallets = [{ id: 'w1', name: 'Alpha' }];
        const sessionReads = count(sent, 'session.status');
        const listReads = count(sent, 'wallet.list');
        await emit('wallets', { change: 'removed', walletId: 'w2' });

        await waitFor(() => expect(count(sent, 'wallet.list')).toBeGreaterThan(listReads));
        expect(count(sent, 'session.status')).toBe(sessionReads);
    });
});

describe('popup reacts to account changes made in another surface', () => {
    it('reloads the accounts of the shown wallet', async () => {
        const { sent, emit } = boot({ wallets: [{ id: 'w1', name: 'Alpha' }] });
        render(<App />);
        await waitFor(() => expect(count(sent, 'account.list')).toBeGreaterThan(0));

        const reads = count(sent, 'account.list');
        await emit('accounts', { change: 'added', walletId: 'w1', accountId: 'a2' });

        await waitFor(() => expect(count(sent, 'account.list')).toBeGreaterThan(reads));
    });

    it('leaves the accounts alone when another wallet changed', async () => {
        const { sent, emit } = boot({ wallets: [{ id: 'w1', name: 'Alpha' }] });
        render(<App />);
        await waitFor(() => expect(count(sent, 'account.list')).toBeGreaterThan(0));

        const reads = count(sent, 'account.list');
        await emit('accounts', { change: 'renamed', walletId: 'w9', accountId: 'a9' });

        expect(count(sent, 'account.list')).toBe(reads);
    });
});
