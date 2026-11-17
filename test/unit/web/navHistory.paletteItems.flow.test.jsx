// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The web shell's one history decides the Back chevron (G06). A page opened
// from a click on another page (Token detail's Send or Receive) shows Back,
// and Back returns to that page with its token. The same page opened from
// the sidebar, the menu or the command palette is a root: the history starts
// over on it, so it shows no Back. A palette pick of token B while token A
// shows is a root too, so Back from it lands on Home, not on token A.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

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

vi.mock('../../../packages/web/src/CommandPaletteHost.jsx', () => ({
    CommandPaletteHost: ({ open, ctx, entityCtx }) => (open ? (
        <div>
            <button type="button" onClick={() => entityCtx.openToken({ chainId: 'bitcoin-mainnet', kind: 'xchain', tick: 'AAA' })}>Palette token AAA</button>
            <button type="button" onClick={() => entityCtx.openToken({ chainId: 'bitcoin-mainnet', kind: 'xchain', tick: 'BBB' })}>Palette token BBB</button>
            <button type="button" onClick={() => ctx.navigate('receive')}>Palette Receive</button>
        </div>
    ) : null),
}));

// The stub pages render the real PageHeader, so the chevron follows the
// shell's history exactly as a real page does.
vi.mock('@xchain-wallet/core/shared/routes/TokenDetail.jsx', async () => {
    const { PageHeader } = await import('../../../packages/core/src/ui/PageHeader.jsx');
    return {
        TokenDetail: ({ tick, onBack, onSend, onReceive }) => (
            <div>
                <PageHeader title={`Token ${tick}`} onBack={onBack} />
                <button type="button" onClick={onSend}>Token send</button>
                <button type="button" onClick={onReceive}>Token receive</button>
                {/* What the system Back gesture runs on this page. */}
                <button type="button" onClick={onBack}>Leave token</button>
            </div>
        ),
    };
});
vi.mock('@xchain-wallet/core/shared/routes/Send.jsx', async () => {
    const { PageHeader } = await import('../../../packages/core/src/ui/PageHeader.jsx');
    return { Send: ({ onBack }) => <PageHeader title="Send page" onBack={onBack} /> };
});
vi.mock('@xchain-wallet/core/shared/routes/Receive.jsx', async () => {
    const { PageHeader } = await import('../../../packages/core/src/ui/PageHeader.jsx');
    return { Receive: ({ onBack }) => <PageHeader title="Receive page" onBack={onBack} /> };
});

import { App } from '../../../packages/web/src/App.jsx';

const LAZY = { timeout: 45_000 };
const BACK = { name: 'Back to previous screen' };

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

const heading = (name) => screen.findByRole('heading', { level: 1, name }, LAZY);
const backShown = () => screen.queryByRole('button', BACK) !== null;

describe('web shell Back chevron follows the one history', () => {
    it('shows Back on pages opened from another page and none on roots', async () => {
        render(<App />);
        await heading('Home');

        // Palette to token A: a root, so no Back.
        await openFromPalette('Palette token AAA');
        await heading('Token AAA');
        expect(backShown()).toBe(false);

        // Token detail to Send: a push, so Back shows and returns to token A.
        fireEvent.click(screen.getByRole('button', { name: 'Token send' }));
        await heading('Send page');
        expect(backShown()).toBe(true);
        fireEvent.click(screen.getByRole('button', BACK));
        await heading('Token AAA');
        expect(backShown()).toBe(false);

        // Token detail to Receive: the same.
        fireEvent.click(screen.getByRole('button', { name: 'Token receive' }));
        await heading('Receive page');
        expect(backShown()).toBe(true);
        fireEvent.click(screen.getByRole('button', BACK));
        await heading('Token AAA');

        // Sidebar to Send: a root, so no Back.
        const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
        fireEvent.click(within(nav).getByRole('button', { name: 'Send' }));
        await heading('Send page');
        expect(backShown()).toBe(false);

        // Palette to Receive: a root, so no Back.
        await openFromPalette('Palette Receive');
        await heading('Receive page');
        expect(backShown()).toBe(false);
    }, 120_000);

    it('treats a palette pick of token B over token A as a root, so Back lands on Home', async () => {
        render(<App />);
        await heading('Home');

        await openFromPalette('Palette token AAA');
        await heading('Token AAA');
        await openFromPalette('Palette token BBB');
        await heading('Token BBB');
        expect(backShown()).toBe(false);

        // The system Back still leaves a root page, for Home.
        fireEvent.click(screen.getByRole('button', { name: 'Leave token' }));
        await heading('Home');
    }, 120_000);
});
