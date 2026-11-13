// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Opening token B from the command palette while token A's page shows is a
// step of its own in the web shell's history: Back returns to token A, then
// to the page before it.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const host = vi.hoisted(() => ({
    wallet: { id: 'wallet-1', name: 'First Wallet', format: 'bip39' },
}));

vi.mock('../../../packages/web/src/messaging.js', async (importOriginal) => ({
    ...await importOriginal(),
    getSessionStatus: vi.fn(async () => ({ state: 'unlocked' })),
    listWallets: vi.fn(async () => [host.wallet]),
    listAccounts: vi.fn(async (walletId) => [{ id: `account-${walletId}`, walletId, index: 0, name: 'Main Account' }]),
    getSettings: vi.fn(async () => ({})),
    updateSettings: vi.fn(async () => ({})),
    getWalletBalances: vi.fn(async () => ({})),
    getAddressesByChain: vi.fn(async () => ({})),
    getActiveAddresses: vi.fn(async () => ({})),
    listQueuedBroadcasts: vi.fn(async () => []),
    listContacts: vi.fn(async () => []),
    listConnectedSites: vi.fn(async () => []),
    listPendingAirdropsForWallet: vi.fn(async () => []),
    getCoinpayObligationsForAddress: vi.fn(async () => []),
    checkReachabilityRequest: vi.fn(async () => ({ reachable: true })),
    getNativePricesRequest: vi.fn(async () => ({})),
    reportAutoLock: undefined,
}));

// The palette opens a token through the shell's own entity handler, exactly
// as a token search result does.
vi.mock('../../../packages/web/src/CommandPaletteHost.jsx', () => ({
    CommandPaletteHost: ({ open, entityCtx }) => (open ? (
        <div>
            <button type="button" onClick={() => entityCtx.openToken({ chainId: 'bitcoin-mainnet', kind: 'xchain', tick: 'AAA' })}>Palette token AAA</button>
            <button type="button" onClick={() => entityCtx.openToken({ chainId: 'bitcoin-mainnet', kind: 'xchain', tick: 'BBB' })}>Palette token BBB</button>
        </div>
    ) : null),
}));
vi.mock('@xchain-wallet/core/shared/routes/TokenDetail.jsx', () => ({
    TokenDetail: ({ tick, onBack }) => (
        <div>
            <h1>{`Token ${tick}`}</h1>
            <button type="button" onClick={onBack}>Leave token</button>
        </div>
    ),
}));

import { App } from '../../../packages/web/src/App.jsx';

const LAZY = { timeout: 45_000 };

beforeEach(() => {
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        callback(0);
        return 1;
    });
    localStorage.clear();
    localStorage.setItem('xc:licenseAcceptedAt', '2026-01-01T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-01-01T00:00:00.000Z');
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

async function openFromPalette(name) {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(await screen.findByRole('button', { name }, LAZY));
}

describe('web shell palette items', () => {
    it('returns from token B to token A, then Home', async () => {
        render(<App />);
        await screen.findByRole('heading', { level: 1, name: 'Home' }, LAZY);

        await openFromPalette('Palette token AAA');
        await screen.findByRole('heading', { level: 1, name: 'Token AAA' }, LAZY);
        await openFromPalette('Palette token BBB');
        await screen.findByRole('heading', { level: 1, name: 'Token BBB' }, LAZY);

        fireEvent.click(screen.getByRole('button', { name: 'Leave token' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Token AAA' }, LAZY)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Leave token' }));
        expect(await screen.findByRole('heading', { level: 1, name: 'Home' }, LAZY)).toBeTruthy();
    }, 90_000);
});
