// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Back in the web shell walks one navigation history: it returns to the page
// the user actually came from, never into a form that was just submitted,
// and a lock starts the history over.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const host = vi.hoisted(() => {
    const wallet = { id: 'wallet-1', name: 'First Wallet', format: 'bip39' };
    const address = {
        id: 'address-1',
        accountId: 'account-wallet-1',
        address: 'bcrt1qbackstack0000000000000000000000000000000',
        label: 'Savings',
        source: 'hd',
        addressType: 'p2wpkh',
        role: 'receive',
    };
    let wallets = [wallet];
    let session = 'unlocked';
    return {
        wallet,
        address,
        reset() { wallets = [{ ...wallet }]; session = 'unlocked'; },
        setSession(next) { session = next; },
        getSessionStatus: vi.fn(async () => ({ state: session })),
        listWallets: vi.fn(async () => wallets),
        listAccounts: vi.fn(async (walletId) => [{
            id: `account-${walletId}`,
            walletId,
            index: 0,
            name: 'Main Account',
        }]),
        renameWallet: vi.fn(async ({ walletId, name }) => {
            wallets = wallets.map((entry) => (entry.id === walletId ? { ...entry, name } : entry));
            return { wallet: wallets.find((entry) => entry.id === walletId) };
        }),
        lockWallet: vi.fn(async () => { session = 'locked'; }),
        unlockWallet: vi.fn(async () => { session = 'unlocked'; return { state: 'unlocked' }; }),
    };
});

vi.mock('../../../packages/web/src/messaging.js', async (importOriginal) => ({
    ...await importOriginal(),
    getSessionStatus: host.getSessionStatus,
    listWallets: host.listWallets,
    listAccounts: host.listAccounts,
    renameWallet: host.renameWallet,
    lockWallet: host.lockWallet,
    unlockWallet: host.unlockWallet,
    getSettings: vi.fn(async () => ({})),
    updateSettings: vi.fn(async () => ({})),
    getWalletBalances: vi.fn(async () => ({})),
    getAddressesByChain: vi.fn(async () => ({ 'bitcoin-regtest': [host.address] })),
    getActiveAddresses: vi.fn(async () => ({})),
    listMultisigReceiveAddresses: vi.fn(async () => []),
    listQueuedBroadcasts: vi.fn(async () => []),
    listContacts: vi.fn(async () => []),
    listConnectedSites: vi.fn(async () => []),
    listPendingAirdropsForWallet: vi.fn(async () => []),
    getCoinpayObligationsForAddress: vi.fn(async () => []),
    checkReachabilityRequest: vi.fn(async () => ({ reachable: true })),
    getNativePricesRequest: vi.fn(async () => ({})),
    reportAutoLock: undefined,
}));

import { App } from '../../../packages/web/src/App.jsx';

// Routes are lazy chunks; the first import of each in jsdom can be slow.
const LAZY = { timeout: 45_000 };

function back() {
    const buttons = screen.getAllByRole('button', { name: 'Back to previous screen' });
    fireEvent.click(buttons[buttons.length - 1]);
}

function heading(name) {
    return screen.findByRole('heading', { level: 1, name }, LAZY);
}

async function openSettingsWallets() {
    fireEvent.click((await screen.findAllByRole('button', { name: 'Settings' }))[0]);
    const group = await waitFor(() => {
        const found = screen.queryByRole('button', { name: /^Wallets/ });
        if (!found) throw new Error('no Wallets group on Settings');
        return found;
    }, LAZY);
    fireEvent.click(group);
    return screen.findByRole('button', { name: /^My Wallets/ }, LAZY);
}

async function openWalletDetails() {
    fireEvent.click(await openSettingsWallets());
    await heading('My Wallets');
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: /^First Wallet/ }));
    await heading('Wallet Details');
}

async function openEditWallet() {
    await openWalletDetails();
    fireEvent.click(await screen.findByRole('button', { name: /^Edit wallet/i }, LAZY));
    await heading(/^Edit Wallet$/i);
}

beforeEach(() => {
    host.reset();
    vi.clearAllMocks();
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

describe('web shell navigation history', () => {
    it('steps Back through Edit wallet, Wallet Details and My Wallets to the Settings page that opened them', async () => {
        render(<App />);
        await openEditWallet();

        back();
        await heading('Wallet Details');
        back();
        await heading('My Wallets');
        back();
        // Settings reopens on the Wallets page the user was on.
        expect(await screen.findByRole('button', { name: /^My Wallets/ }, LAZY)).toBeTruthy();
        expect(screen.queryByRole('heading', { level: 1, name: 'My Wallets' })).toBeNull();
    }, 60_000);

    it('returns from Show Private Key to the same address, then from View Address to Addresses', async () => {
        render(<App />);
        await openSettingsWallets();
        fireEvent.click(await screen.findByRole('button', { name: /^My Addresses/ }, LAZY));
        await heading('Addresses');

        fireEvent.click(await screen.findByRole('button', { name: `View address ${host.address.address}` }, LAZY));
        await heading('View Address');
        expect(screen.getByRole('button', { name: 'Back to previous screen' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Secret key/ }));
        await heading('Show Private Key');
        back();
        await heading('View Address');
        expect(screen.getByTestId('address-detail-label')).toHaveTextContent('Savings');

        back();
        await heading('Addresses');
        expect(screen.getByRole('button', { name: `View address ${host.address.address}` })).toBeInTheDocument();
    }, 60_000);

    it('never returns into the Edit wallet form after it saved', async () => {
        render(<App />);
        await openEditWallet();

        const name = screen.getByRole('textbox', { name: /Wallet name/i });
        fireEvent.change(name, { target: { value: 'Renamed Wallet' } });
        fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
        await waitFor(() => expect(host.renameWallet).toHaveBeenCalledWith({ walletId: 'wallet-1', name: 'Renamed Wallet' }));
        await heading('Wallet Details');

        back();
        await heading('My Wallets');
        expect(screen.queryByRole('heading', { level: 1, name: /^Edit Wallet$/i })).toBeNull();
    }, 60_000);

    it('returns Settings to whichever page opened it: Home from the tab bar, Wallet Details from Remove wallet', async () => {
        render(<App />);
        await heading('Home');

        // Settings is a tab-bar page, so its Back control is hidden while the
        // bar shows; the system Back gesture runs the same history.
        fireEvent.click((await screen.findAllByRole('button', { name: 'Settings' }))[0]);
        await screen.findByRole('button', { name: /^Wallets/ }, LAZY);
        window.dispatchEvent(new Event('xchain:native-edge-back'));
        await heading('Home');

        await openWalletDetails();
        fireEvent.click(await screen.findByRole('button', { name: /^Remove wallet/ }, LAZY));
        await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Wallet Details' })).toBeNull(), LAZY);

        // Settings opens on its own Remove wallet page, so the first Back may
        // only step out to the Settings list; wait for one settled page before
        // sending a second Back, so a slow first Back is never sent twice.
        window.dispatchEvent(new Event('xchain:native-edge-back'));
        const landed = await waitFor(() => {
            if (screen.queryByRole('heading', { level: 1, name: 'Wallet Details' })) return 'details';
            if (screen.queryByRole('button', { name: /^Wallets/ })) return 'settings';
            throw new Error('Back has not settled');
        }, LAZY);
        if (landed === 'settings') window.dispatchEvent(new Event('xchain:native-edge-back'));
        await heading('Wallet Details');
    }, 90_000);

    it('keeps the browser history in step with an in-app Back, so a browser Back goes on to Settings', async () => {
        render(<App />);
        await openWalletDetails();
        await waitFor(() => expect(window.history.state?.xcRoute?.view).toBe('wallet-details'));
        const length = window.history.length;

        back();
        await heading('My Wallets');
        // The in-app Back consumed the Wallet Details entry instead of adding one.
        await waitFor(() => expect(window.history.state?.xcRoute?.view).toBe('wallet-picker'));
        expect(window.history.length).toBe(length);

        window.history.back();
        // Settings reopens on its Wallets page; Wallet Details never comes back.
        await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'My Wallets' })).toBeNull(), LAZY);
        expect(await screen.findByRole('button', { name: /^My Wallets/ }, LAZY)).toBeTruthy();
        expect(screen.queryByRole('heading', { level: 1, name: 'Wallet Details' })).toBeNull();
    }, 60_000);

    it('reopens Settings on its Wallets page after a detour through another Settings page', async () => {
        render(<App />);
        fireEvent.click((await screen.findAllByRole('button', { name: 'Settings' }))[0]);
        fireEvent.click(await waitFor(() => {
            const found = screen.queryByRole('button', { name: /^Wallets/ });
            if (!found) throw new Error('no Wallets group on Settings');
            return found;
        }, LAZY));
        fireEvent.click(await screen.findByRole('button', { name: /^My Accounts/ }, LAZY));
        await heading('My Accounts');
        fireEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: /^Main Account/ }, LAZY));
        await heading('Account Details');

        // Extended public keys open on Settings' own page for them.
        fireEvent.click(await screen.findByRole('button', { name: /^Extended public keys/ }, LAZY));
        await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Account Details' })).toBeNull(), LAZY);
        window.dispatchEvent(new Event('xchain:native-edge-back'));
        const landed = await waitFor(() => {
            if (screen.queryByRole('heading', { level: 1, name: 'Account Details' })) return 'details';
            if (screen.queryByRole('button', { name: /^Wallets/ })) return 'settings';
            throw new Error('Back has not settled');
        }, LAZY);
        if (landed === 'settings') window.dispatchEvent(new Event('xchain:native-edge-back'));
        await heading('Account Details');

        back();
        await heading('My Accounts');
        // My Accounts labels its Back control by its target; the system Back runs the same history.
        window.dispatchEvent(new Event('xchain:native-edge-back'));
        // Back on Settings, the Wallets page that opened My Accounts shows again.
        await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'My Accounts' })).toBeNull(), LAZY);
        expect(await screen.findByRole('button', { name: /^My Wallets/ }, LAZY)).toBeTruthy();
    }, 90_000);

    it('starts the history over after a lock and unlock', async () => {
        render(<App />);
        await openWalletDetails();

        fireEvent.click(screen.getAllByRole('button', { name: 'Lock wallet' })[0]);
        await waitFor(() => expect(host.lockWallet).toHaveBeenCalled());
        fireEvent.change(await screen.findByLabelText(/^Password/i, {}, LAZY), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: /^Unlock Wallet$/i }));
        await waitFor(() => expect(host.unlockWallet).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'Wallet Details' })).toBeNull(), LAZY);

        // My Wallets after the unlock: Back walks only the new history, so
        // it reaches Settings and then Home, never the pre-lock Wallet Details.
        fireEvent.click(await openSettingsWallets());
        await heading('My Wallets');
        back();
        await waitFor(() => expect(screen.queryByRole('heading', { level: 1, name: 'My Wallets' })).toBeNull(), LAZY);
        // The system Back gesture runs the same history as the on-screen control.
        window.dispatchEvent(new Event('xchain:native-edge-back'));
        await waitFor(() => expect(screen.queryByRole('button', { name: /^My Wallets/ })).toBeNull(), LAZY);
        expect(screen.queryByRole('heading', { level: 1, name: 'Wallet Details' })).toBeNull();
    }, 60_000);
});
