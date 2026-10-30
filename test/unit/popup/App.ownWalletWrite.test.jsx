// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The background announces every unlock to every extension surface, the
// window whose own import caused it included. An onboarding lane that imports
// the first wallet and then shows more of its own flow (the pairing code
// exchange, the donation notice) must keep the window until it hands back.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../packages/extension/src/popup/App.jsx';
import { SURFACE_STATE_STORAGE_KEY } from '../../../packages/extension/src/shared/surfaceStateSync.js';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

function boot() {
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-10-27T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedAt', '2026-10-27T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    const listeners = new Set();
    const state = { session: 'no-wallet' };
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
                } else if (message.type === 'wallet.import') {
                    // The background publishes the unlock, which reaches every
                    // surface as a later storage event, and then replies.
                    setTimeout(() => {
                        state.session = 'unlocked';
                        deliver('session', { state: 'unlocked' });
                        setTimeout(() => callback({
                            ok: true,
                            result: { walletId: 'w-1', walletName: 'Paired Wallet', format: 'bip39', labelSyncToken: null },
                        }), 0);
                    }, 0);
                } else if (message.type === 'pairing.payload') {
                    callback({ ok: true, result: { encoded: 'XCW-PAIR:ZmFrZQ', payload: null } });
                } else if (message.type === 'wallet.list') {
                    callback({ ok: true, result: [{ id: 'w-1', name: 'Paired Wallet' }] });
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
        deliver(kind, payload);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { state, sent, emit };
}

const count = (sent, type) => sent.filter((entry) => entry === type).length;

describe('popup onboarding lanes keep the window through their own first-wallet write', () => {
    it('reaches the pairing code exchange after the lane imports the shared phrase', async () => {
        const { sent } = boot();
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Pair a watcher or signer' }));
        fireEvent.click(screen.getByRole('button', { name: 'This device watches. Pair a signer' }));
        fireEvent.change(screen.getByLabelText('Shared recovery phrase'), { target: { value: PHRASE } });
        fireEvent.change(screen.getByLabelText('Password for this device'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        const sessionReads = count(sent, 'session.status');
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(await screen.findByText('XCW-PAIR:ZmFrZQ')).toBeInTheDocument();
        expect(screen.getByLabelText("Paste the other wallet's code")).toBeInTheDocument();
        expect(count(sent, 'pairing.payload')).toBe(1);
        expect(count(sent, 'session.status')).toBe(sessionReads);
    });

    it('shows the donation notice after the lane imports a recovery phrase', async () => {
        const { sent } = boot();
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Import wallet' }));
        fireEvent.change(await screen.findByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText(/^Confirm( password)?$/), { target: { value: PASSWORD } });
        const sessionReads = count(sent, 'session.status');
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(await screen.findByRole('heading', { name: 'Automatic Donation System' })).toBeInTheDocument();
        expect(count(sent, 'session.status')).toBe(sessionReads);
    });

    it('still follows an unlock from another window while the lane has written nothing', async () => {
        const { state, sent, emit } = boot();
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Import wallet' }));
        await screen.findByLabelText('Recovery phrase');
        const sessionReads = count(sent, 'session.status');

        state.session = 'locked';
        await emit('session', { state: 'locked' });

        await waitFor(() => expect(count(sent, 'session.status')).toBeGreaterThan(sessionReads));
        await waitFor(() => expect(screen.queryByLabelText('Recovery phrase')).toBeNull());
    });
});
