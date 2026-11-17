// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Finishing a recovery upgrade in the extension reads the session again so
// the new wallet joins the list. That read keeps the navigation history: Done
// returns to the Wallet Details page that opened the upgrade, and Back goes on
// from there. Only a session that ended meanwhile starts the history over.

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SURFACE_STATE_STORAGE_KEY } from '../../../packages/extension/src/shared/surfaceStateSync.js';

vi.mock('@xchain-wallet/core/shared/routes/Home.jsx', () => ({
    Home: ({ onOpenWalletPicker }) => (
        <div>
            <h1>Home screen</h1>
            <button type="button" onClick={onOpenWalletPicker}>Open wallet picker</button>
        </div>
    ),
}));
vi.mock('@xchain-wallet/core/shared/routes/WalletPicker.jsx', () => ({
    WalletPicker: ({ onShowDetails, onBack }) => (
        <div>
            <h1>Wallet picker screen</h1>
            <button type="button" onClick={() => onShowDetails('w1')}>Show Alpha details</button>
            <button type="button" onClick={onBack}>Leave wallet picker</button>
        </div>
    ),
}));
vi.mock('@xchain-wallet/core/shared/routes/WalletDetails.jsx', () => ({
    WalletDetails: ({ walletId, onMigrateToBip39, onBack }) => (
        <div>
            <h1>Wallet details screen</h1>
            <p>{`Details for ${walletId}`}</p>
            <button type="button" onClick={onMigrateToBip39}>Upgrade recovery</button>
            <button type="button" onClick={onBack}>Leave wallet details</button>
        </div>
    ),
}));
// The wizard hands back the way the real one does: onMigrated, then onBack.
vi.mock('@xchain-wallet/core/shared/routes/MigrateToBip39.jsx', () => ({
    MigrateToBip39: ({ legacyWalletId, onMigrated, onBack }) => (
        <div>
            <h1>Upgrade screen</h1>
            <p>{`Upgrading ${legacyWalletId}`}</p>
            <button type="button" onClick={() => { onMigrated('w2'); onBack(); }}>Finish upgrade</button>
        </div>
    ),
}));

import { App } from '../../../packages/extension/src/popup/App.jsx';

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
    const state = { session: 'unlocked', wallets: [{ id: 'w1', name: 'Alpha', format: 'counterwallet-legacy' }] };
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
                    callback({ ok: true, result: state.wallets.map((wallet) => ({ ...wallet })) });
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
const LOAD = { timeout: 15_000 };

async function openUpgradeFromWalletDetails() {
    render(<App />);
    // Home can draw again as the wallet load ends, so open the picker until it stays.
    await waitFor(() => {
        if (screen.queryByRole('heading', { name: 'Wallet picker screen' })) return;
        const open = screen.queryByRole('button', { name: 'Open wallet picker' });
        if (open) fireEvent.click(open);
        throw new Error('wallet picker not open yet');
    }, LOAD);
    fireEvent.click(screen.getByRole('button', { name: 'Show Alpha details' }));
    await screen.findByText('Details for w1');
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade recovery' }));
    await screen.findByText('Upgrading w1');
}

describe('the extension after a recovery upgrade', () => {
    it('returns to Wallet Details and keeps the history while the new wallet joins the list', { timeout: 40_000 }, async () => {
        const { state, sent } = boot();
        await openUpgradeFromWalletDetails();
        const sessionReads = count(sent, 'session.status');
        const listReads = count(sent, 'wallet.list');
        state.wallets = [...state.wallets, { id: 'w2', name: 'Alpha upgraded', format: 'bip39' }];

        fireEvent.click(screen.getByRole('button', { name: 'Finish upgrade' }));

        await waitFor(() => expect(count(sent, 'wallet.list')).toBeGreaterThan(listReads));
        expect(count(sent, 'session.status')).toBe(sessionReads + 1);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
        expect(screen.getByText('Details for w1')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Leave wallet details' }));
        expect(await screen.findByRole('heading', { name: 'Wallet picker screen' })).toBeInTheDocument();
    });

    it('starts over when the session ended before the upgrade handed back', { timeout: 40_000 }, async () => {
        const { state, emit } = boot();
        await openUpgradeFromWalletDetails();
        state.session = 'locked';

        fireEvent.click(screen.getByRole('button', { name: 'Finish upgrade' }));
        await waitFor(() => expect(screen.queryByText('Details for w1')).toBeNull(), LOAD);

        state.session = 'unlocked';
        await emit('session', { state: 'unlocked' });
        expect(await screen.findByRole('heading', { name: 'Home screen' }, LOAD)).toBeInTheDocument();
        expect(screen.queryByText('Details for w1')).toBeNull();
    });
});
