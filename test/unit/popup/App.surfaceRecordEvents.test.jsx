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

// Whether this window holds an open review. The real flag is set by a confirm
// in progress; the tests below set it directly.
let reviewOpen = false;
vi.mock('../../../packages/core/src/shared/hooks/useConfirmAction.js', async (importOriginal) => ({
    ...(await importOriginal()),
    isConfirmActive: () => reviewOpen,
}));

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    reviewOpen = false;
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
});

function boot({ wallets, holdWalletList = false }) {
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedAt', '2026-10-13T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    const listeners = new Set();
    const state = { wallets: wallets.map((w) => ({ ...w })), session: 'unlocked' };
    const sent = [];
    let holding = holdWalletList;
    const heldReplies = [];
    vi.stubGlobal('chrome', {
        runtime: {
            lastError: undefined,
            getURL: (path) => `chrome-extension://wallet/${path}`,
            sendMessage: vi.fn((message, callback) => {
                sent.push(message.type);
                if (message.type === 'session.status') {
                    callback({ ok: true, result: { state: state.session } });
                } else if (message.type === 'wallet.list') {
                    const reply = { ok: true, result: state.wallets.map((w) => ({ ...w })) };
                    if (holding) heldReplies.push(() => callback(reply));
                    else callback(reply);
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
    const deliver = (kind, payload) => {
        for (const listener of listeners) {
            listener({
                [SURFACE_STATE_STORAGE_KEY]: { newValue: { kind, payload, revision: String(Math.random()) } },
            }, 'session');
        }
    };
    const emit = (kind, payload) => act(async () => {
        deliver(kind, payload);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Answers the held wallet.list read the way the background does, then lets
    // only the promise handlers run, so React has not rendered the result.
    const releaseWalletList = async () => {
        holding = false;
        for (const answer of heldReplies.splice(0)) answer();
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
    };
    return { state, sent, emit, deliver, releaseWalletList, listHeld: () => heldReplies.length > 0 };
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

    it('lands on Welcome when the last wallet is removed while the wallet list read is in flight', async () => {
        const { state, sent, emit, releaseWalletList, listHeld } = boot({
            wallets: [{ id: 'w1', name: 'Alpha' }],
            holdWalletList: true,
        });
        localStorage.setItem('xchain.activeWallet', 'w1');
        render(<App />);
        await waitFor(() => expect(listHeld()).toBe(true));

        // The read was made before the removal, so its reply still names w1.
        state.wallets = [];
        state.session = 'no-wallet';
        await emit('wallets', { change: 'removed', walletId: 'w1' });
        await act(async () => { await releaseWalletList(); });

        expect(await screen.findByRole('button', { name: 'Create new wallet' })).toBeInTheDocument();
        expect(count(sent, 'session.status')).toBeGreaterThan(1);
    });

    it('lands on Welcome when the last wallet is removed before the chosen wallet is rendered', async () => {
        const { state, sent, deliver, releaseWalletList, listHeld } = boot({
            wallets: [{ id: 'w1', name: 'Alpha' }],
            holdWalletList: true,
        });
        localStorage.setItem('xchain.activeWallet', 'w1');
        render(<App />);
        await waitFor(() => expect(listHeld()).toBe(true));

        // Outside act, React renders the reply on its own schedule, as a loaded runner does.
        globalThis.IS_REACT_ACT_ENVIRONMENT = false;
        await releaseWalletList();
        state.wallets = [];
        state.session = 'no-wallet';
        const sessionReads = count(sent, 'session.status');
        deliver('wallets', { change: 'removed', walletId: 'w1' });

        expect(await screen.findByRole('button', { name: 'Create new wallet' })).toBeInTheDocument();
        expect(count(sent, 'session.status')).toBeGreaterThan(sessionReads);
    });

    it('re-reads the wallets when the session answers before React renders the reload', async () => {
        const { state, sent, deliver } = boot({
            wallets: [{ id: 'w1', name: 'Alpha' }, { id: 'w2', name: 'Beta' }],
        });
        localStorage.setItem('xchain.activeWallet', 'w1');
        render(<App />);
        await waitFor(() => expect(count(sent, 'account.list')).toBeGreaterThan(0));

        // Outside act the loading state and the answer land in one render, so the
        // session state string never changes; the wallet read must still repeat.
        globalThis.IS_REACT_ACT_ENVIRONMENT = false;
        state.wallets = [{ id: 'w2', name: 'Beta' }];
        const listReads = count(sent, 'wallet.list');
        deliver('wallets', { change: 'removed', walletId: 'w1' });

        await waitFor(() => expect(count(sent, 'wallet.list')).toBeGreaterThan(listReads));
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

describe('an open review survives record changes made in another surface', () => {
    // Home reads the stored confirms each time it mounts, so the count of that
    // read tells a remount of the open screen apart from a re-render.
    const mounts = (sent) => count(sent, 'action.confirmSession.list');

    async function shown() {
        const env = boot({ wallets: [{ id: 'w1', name: 'Alpha' }] });
        env.state.accounts = [{ id: 'a1', walletId: 'w1', index: 0, name: 'Main' }];
        localStorage.setItem('xchain.activeWallet', 'w1');
        render(<App />);
        await waitFor(() => expect(mounts(env.sent)).toBeGreaterThan(0));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
        return env;
    }

    for (const [label, kind, payload] of [
        ['a renamed wallet', 'wallets', { change: 'renamed', walletId: 'w1' }],
        ['a renamed account', 'accounts', { change: 'renamed', walletId: 'w1', accountId: 'a1' }],
        ['an added account', 'accounts', { change: 'added', walletId: 'w1', accountId: 'a2' }],
        ['another wallet removed', 'wallets', { change: 'removed', walletId: 'w9' }],
    ]) {
        it(`keeps the open screen for ${label} while a review is open`, async () => {
            const { sent, emit } = await shown();
            reviewOpen = true;
            const before = mounts(sent);
            await emit(kind, payload);
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
            expect(mounts(sent)).toBe(before);
        });
    }

    // Renames and added accounts leave Home mounted with or without a review
    // (App.surfaceAccountsChanged.test.jsx); a removal still reloads it.
    it('reloads the open screen for another wallet removed with no review open', async () => {
        const { sent, emit } = await shown();
        const before = mounts(sent);
        await emit('wallets', { change: 'removed', walletId: 'w9' });
        await waitFor(() => expect(mounts(sent)).toBeGreaterThan(before));
    });

    async function twoWallets() {
        const env = boot({ wallets: [{ id: 'w1', name: 'Alpha' }, { id: 'w2', name: 'Bravo' }] });
        localStorage.setItem('xchain.activeWallet', 'w1');
        const { container } = render(<App />);
        await screen.findByRole('heading', { name: 'Home', level: 1 });
        await screen.findByText('Wallet: Alpha');
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
        return { ...env, heading: container.querySelector('h1') };
    }

    it('keeps the open screen and its wallet when another surface switches wallet during a review', async () => {
        const { heading, emit } = await twoWallets();
        reviewOpen = true;
        localStorage.setItem('xchain.activeWallet', 'w2');
        await emit('wallet', { walletId: 'w2' });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
        expect(heading.isConnected).toBe(true);
        expect(screen.getByText('Wallet: Alpha')).toBeInTheDocument();
    });

    it('takes the wallet another surface chose during a review at the next navigation', async () => {
        const { emit } = await twoWallets();
        reviewOpen = true;
        localStorage.setItem('xchain.activeWallet', 'w2');
        await emit('wallet', { walletId: 'w2' });
        reviewOpen = false;
        const history = screen.getAllByRole('button', { name: /^History\b/ })[0];
        await act(async () => { history.click(); });
        expect(await screen.findByText('Wallet: Bravo')).toBeInTheDocument();
    });

    it('switches at once when another surface switches wallet with no review open', async () => {
        const { emit } = await twoWallets();
        localStorage.setItem('xchain.activeWallet', 'w2');
        await emit('wallet', { walletId: 'w2' });
        expect(await screen.findByText('Wallet: Bravo')).toBeInTheDocument();
    });

    it('reloads the open screen for a network change while a review is open', async () => {
        const { sent, emit } = await shown();
        reviewOpen = true;
        const before = mounts(sent);
        await emit('network', { settings: { activeNetwork: 'testnet' } });
        await waitFor(() => expect(mounts(sent)).toBeGreaterThan(before));
    });
});
