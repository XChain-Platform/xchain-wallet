// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The popup gates one session refresh on two onboarding holds: an import or
// pairing lane's own first-wallet write, and the create screen's held phrase
// or write in flight. Each hold keeps the window where it is, and a window
// that holds nothing still follows an unlock made elsewhere.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CREATED_PHRASE = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
const IMPORTED_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';
const STALE_NOTICE = /recovery phrase shown in this window was not saved/;

const mocks = vi.hoisted(() => ({
    generateBip39Mnemonic: vi.fn(),
    nextPaint: vi.fn(),
    pickQuizPositions: vi.fn(),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, generateBip39Mnemonic: mocks.generateBip39Mnemonic },
    };
});
vi.mock('../../../packages/core/src/shared/utils/nextPaint.js', () => ({ nextPaint: mocks.nextPaint }));
vi.mock('../../../packages/core/src/shared/utils/pickQuizPositions.js', () => ({
    pickQuizPositions: mocks.pickQuizPositions,
}));

import { App } from '../../../packages/extension/src/popup/App.jsx';
import { SURFACE_STATE_STORAGE_KEY } from '../../../packages/extension/src/shared/surfaceStateSync.js';

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.generateBip39Mnemonic.mockReset().mockReturnValue(CREATED_PHRASE);
    mocks.nextPaint.mockReset().mockResolvedValue();
    mocks.pickQuizPositions.mockReset().mockReturnValue([2, 4, 6]);
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

/**
 * @param {{ announce?: 'before-reply' | 'after-reply' }} [options]
 *   when the background's unlock announcement reaches this window relative
 *   to the reply to its own `wallet.import`
 */
function boot({ announce = 'before-reply' } = {}) {
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
    const reply = (callback) => callback({
        ok: true,
        result: { walletId: 'w-1', walletName: 'Main Wallet', format: 'bip39', labelSyncToken: null },
    });
    vi.stubGlobal('chrome', {
        runtime: {
            lastError: undefined,
            getURL: (path) => `chrome-extension://wallet/${path}`,
            sendMessage: vi.fn((message, callback) => {
                sent.push(message.type);
                if (message.type === 'session.status') {
                    callback({ ok: true, result: { state: state.session } });
                } else if (message.type === 'wallet.import') {
                    setTimeout(() => {
                        state.session = 'unlocked';
                        if (announce === 'before-reply') {
                            deliver('session', { state: 'unlocked' });
                            setTimeout(() => reply(callback), 0);
                        } else {
                            reply(callback);
                            // The announcement lands once the screen shows
                            // what follows the write.
                            setTimeout(() => deliver('session', { state: 'unlocked' }), 30);
                        }
                    }, 0);
                } else if (message.type === 'wallet.list') {
                    callback({ ok: true, result: [{ id: 'w-1', name: 'Main Wallet' }] });
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
    const settle = (ms) => act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms));
    });
    return { state, sent, emit, settle };
}

const count = (sent, type) => sent.filter((entry) => entry === type).length;

async function openCreateToPhrase() {
    fireEvent.click(await screen.findByRole('button', { name: 'Create new wallet' }));
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText(/^Confirm( password)?$/), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('checkbox', { name: /saved my recovery phrase/i });
}

async function createThroughVerify() {
    await openCreateToPhrase();
    fireEvent.click(screen.getByRole('checkbox', { name: /saved my recovery phrase/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
    const words = CREATED_PHRASE.split(' ');
    for (const input of await screen.findAllByLabelText(/^Word \d+$/)) {
        const position = Number(input.labels[0].textContent.match(/\d+/)[0]);
        fireEvent.change(input, { target: { value: words[position - 1] } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));
}

describe('popup onboarding holds share one session refresh', () => {
    it('keeps an import lane on its donation notice through its own write', async () => {
        const { sent } = boot();
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Import wallet' }));
        fireEvent.change(await screen.findByLabelText('Recovery phrase'), { target: { value: IMPORTED_PHRASE } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText(/^Confirm( password)?$/), { target: { value: PASSWORD } });
        const sessionReads = count(sent, 'session.status');
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(await screen.findByRole('heading', { name: 'Automatic Donation System' })).toBeInTheDocument();
        expect(count(sent, 'session.status')).toBe(sessionReads);
    });

    it('turns another window\'s wallet into the lasting notice on a create screen that shows a phrase', async () => {
        const { state, sent, emit } = boot();
        render(<App />);
        await openCreateToPhrase();
        const sessionReads = count(sent, 'session.status');

        state.session = 'unlocked';
        await emit('session', { state: 'unlocked' });

        expect(await screen.findByRole('alert')).toHaveTextContent(STALE_NOTICE);
        expect(screen.queryByRole('checkbox', { name: /saved my recovery phrase/i })).toBeNull();
        expect(count(sent, 'session.status')).toBe(sessionReads);
    });

    it('keeps a create screen through its own write in flight', async () => {
        const { sent } = boot({ announce: 'before-reply' });
        render(<App />);
        await createThroughVerify();
        const sessionReads = count(sent, 'session.status');

        expect(await screen.findByRole('heading', { name: 'Automatic Donation System' })).toBeInTheDocument();
        expect(screen.queryByText(STALE_NOTICE)).toBeNull();
        expect(count(sent, 'session.status')).toBe(sessionReads);
    });

    it('keeps a create screen on its donation notice when its own announcement lands after the reply', async () => {
        const { sent, settle } = boot({ announce: 'after-reply' });
        render(<App />);
        await createThroughVerify();
        const sessionReads = count(sent, 'session.status');

        expect(await screen.findByRole('heading', { name: 'Automatic Donation System' })).toBeInTheDocument();
        await settle(80);

        expect(screen.getByRole('heading', { name: 'Automatic Donation System' })).toBeInTheDocument();
        expect(count(sent, 'session.status')).toBe(sessionReads);

        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        await waitFor(() => expect(count(sent, 'session.status')).toBeGreaterThan(sessionReads));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Automatic Donation System' })).toBeNull());
    });

    it('releases the import hold when the lane is left, so a create screen elsewhere decides alone', async () => {
        const { state, sent, emit } = boot();
        render(<App />);
        fireEvent.click(await screen.findByRole('button', { name: 'Import wallet' }));
        await screen.findByLabelText('Recovery phrase');
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        await screen.findByRole('button', { name: 'Create new wallet' });
        const sessionReads = count(sent, 'session.status');

        state.session = 'locked';
        await emit('session', { state: 'locked' });

        await waitFor(() => expect(count(sent, 'session.status')).toBeGreaterThan(sessionReads));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Create new wallet' })).toBeNull());
    });
});
