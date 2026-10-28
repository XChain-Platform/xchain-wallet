// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Saving a duress passphrase checks the current wallet password by unlocking
// again, and the background announces every unlock to every extension page.
// An extension window that is already unlocked keeps the screen it shows on
// that announcement, so the Safety row stays on screen and confirms the save
// as it does on the other shells. A lock announcement still reloads.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function boot() {
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    localStorage.setItem('xchain.activeWallet', 'w1');
    localStorage.setItem('xc:activeAccount:w1', 'a1');
    const listeners = new Set();
    const state = { session: 'unlocked' };
    const sent = [];
    const deliver = (kind, payload) => {
        for (const listener of listeners) {
            listener({
                [SURFACE_STATE_STORAGE_KEY]: { newValue: { kind, payload, revision: String(Math.random()) } },
            }, 'session');
        }
    };
    vi.stubGlobal('chrome', {
        runtime: {
            lastError: undefined,
            getURL: (path) => `chrome-extension://wallet/${path}`,
            sendMessage: vi.fn((message, callback) => {
                sent.push(message.type);
                if (message.type === 'session.status') {
                    callback({ ok: true, result: { state: state.session } });
                } else if (message.type === 'wallet.unlock') {
                    // The background announces the unlock to every page, this
                    // one included, before its reply arrives.
                    deliver('session', { state: 'unlocked' });
                    setTimeout(() => callback({ ok: true, result: { unlocked: true, passphraseCaptureNeeded: [] } }), 0);
                } else if (message.type === 'wallet.list') {
                    callback({ ok: true, result: [{ id: 'w1', name: 'Alpha', format: 'bip39' }] });
                } else if (message.type === 'account.list') {
                    callback({ ok: true, result: [{ id: 'a1', walletId: 'w1', index: 0, name: 'Account 1' }] });
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
        deliver(kind, payload);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { state, sent, emit };
}

const count = (sent, type) => sent.filter((entry) => entry === type).length;

describe('an unlock announcement in an unlocked extension window', () => {
    it('keeps the screen it shows', { timeout: 40_000 }, async () => {
        const { sent, emit } = boot();
        render(<App />);
        await screen.findByRole('heading', { name: 'Home', level: 1 }, { timeout: 15_000 });
        // Home renders before the popup finishes loading the wallet, and the
        // end of that load can draw Home again over a screen opened during it,
        // so open the actions screen until it stays open.
        await waitFor(() => {
            if (screen.queryByRole('button', { name: 'Back to home' })) return;
            const more = screen.queryByRole('button', { name: 'More actions' });
            if (more) fireEvent.click(more);
            throw new Error('actions screen not open yet');
        }, { timeout: 15_000 });
        const before = count(sent, 'session.status');

        await emit('session', { state: 'unlocked' });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

        expect(screen.getByRole('button', { name: 'Back to home' })).toBeInTheDocument();
        expect(count(sent, 'session.status')).toBe(before);
    });

    it('reloads the session on a lock announcement', async () => {
        const { state, sent, emit } = boot();
        render(<App />);
        await screen.findByRole('heading', { name: 'Home', level: 1 }, { timeout: 15_000 });
        const before = count(sent, 'session.status');

        await emit('session', { state: 'unlocked' });
        expect(count(sent, 'session.status')).toBe(before);

        state.session = 'locked';
        await emit('session', { state: 'locked' });
        await waitFor(() => expect(count(sent, 'session.status')).toBe(before + 1));
    });
});
