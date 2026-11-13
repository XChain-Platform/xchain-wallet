// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct horse battery staple';

const host = vi.hoisted(() => {
    const first = { id: 'wallet-1', name: 'First Wallet', format: 'bip39' };
    const second = { id: 'wallet-2', name: 'Second Wallet', format: 'bip39' };
    let wallets = [first];

    return {
        first,
        second,
        reset(nextWallets = [first]) { wallets = nextWallets; },
        getSessionStatus: vi.fn(async () => ({ state: 'unlocked' })),
        listWallets: vi.fn(async () => wallets),
        listAccounts: vi.fn(async (walletId) => [{
            id: `account-${walletId}`,
            walletId,
            index: 0,
            name: 'Main Account',
        }]),
        addImportedWallet: vi.fn(async ({ name }) => {
            wallets = [...wallets, { ...second, name }];
            return { walletId: second.id };
        }),
    };
});

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, generateBip39Mnemonic: () => PHRASE },
    };
});

vi.mock('../../../packages/web/src/messaging.js', async (importOriginal) => ({
    ...await importOriginal(),
    getSessionStatus: host.getSessionStatus,
    listWallets: host.listWallets,
    listAccounts: host.listAccounts,
    addImportedWallet: host.addImportedWallet,
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

import { App } from '../../../packages/web/src/App.jsx';
import { readActiveWallet } from '../../../packages/core/src/shared/utils/activeWalletMemory.js';

function answerRecoveryQuiz() {
    const words = PHRASE.split(' ');
    for (const input of screen.getAllByLabelText(/^Word \d+$/)) {
        const position = Number(input.labels[0].textContent.match(/\d+/)[0]);
        fireEvent.change(input, { target: { value: words[position - 1] } });
    }
}

async function openWalletPicker() {
    // Wallet switching lives on the Settings page.
    const settingsTabs = await screen.findAllByRole('button', { name: 'Settings' });
    fireEvent.click(settingsTabs[0]);
    // Settings lists the Wallets group; its page lists My Wallets, My Accounts and My Addresses.
    const group = await waitFor(() => {
        const found = screen.queryByRole('button', { name: /^Wallets/ });
        if (!found) throw new Error('no Wallets group on Settings');
        return found;
    });
    fireEvent.click(group);
    fireEvent.click(await screen.findByRole('button', { name: /^My Wallets/ }));
    return screen.findByRole('heading', { name: 'My Wallets' });
}

async function createSecondWallet() {
    await openWalletPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Add Wallet' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create New Wallet' }));

    expect(await screen.findByLabelText('Wallet name')).toHaveValue('Wallet 2');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.click(await screen.findByRole('checkbox', { name: /saved my recovery phrase/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify Recovery Phrase' }));
    answerRecoveryQuiz();
    fireEvent.click(screen.getByRole('button', { name: 'Create Wallet' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
}

async function importSecondWallet() {
    await openWalletPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Add Wallet' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Import Wallet' }));

    fireEvent.change(await screen.findByLabelText('Wallet name'), { target: { value: 'Second Wallet' } });
    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
}

// A wallet row opens that wallet's page; Set as active wallet there makes it the active one.
async function makeWalletActive(name, id) {
    fireEvent.click(walletRow(name));
    fireEvent.click(await screen.findByRole('button', { name: /Set as active wallet/ }));
    await waitFor(() => expect(readActiveWallet()).toBe(id));
}

function walletRow(name) {
    return within(screen.getByRole('main')).getByRole('button', {
        name: new RegExp(`^${name}`),
    });
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

describe('web add-wallet activation flow', () => {
    it('defaults a second wallet to Wallet 2 and keeps the header reactive while switching', async () => {
        const firstMount = render(<App />);
        await screen.findAllByRole('button', { name: 'Settings' });

        await createSecondWallet();

        expect(host.addImportedWallet).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Wallet 2',
            mnemonic: PHRASE,
            password: PASSWORD,
            origin: 'created',
        }));
        expect(await screen.findByText('Wallet 2 is now active.')).toBeTruthy();
        await waitFor(() => expect(readActiveWallet()).toBe(host.second.id));
        // The app header no longer draws the wallet's name; the picker rows carry the active mark.

        await openWalletPicker();
        expect(walletRow('First Wallet')).not.toHaveAttribute('aria-current');
        expect(walletRow('Wallet 2')).toHaveAttribute('aria-current', 'true');
        await makeWalletActive('First Wallet', host.first.id);

        await openWalletPicker();
        expect(walletRow('First Wallet')).toHaveAttribute('aria-current', 'true');
        await makeWalletActive('Wallet 2', host.second.id);

        firstMount.unmount();
        render(<App />);
        await openWalletPicker();
        expect(walletRow('Wallet 2')).toHaveAttribute('aria-current', 'true');
    });

    it('skips a numbered name that is already in use', async () => {
        host.reset([host.first, { id: 'wallet-existing-2', name: 'Wallet 2', format: 'bip39' }]);
        render(<App />);
        await screen.findAllByRole('button', { name: 'Settings' });

        await openWalletPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Add Wallet' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create New Wallet' }));

        await waitFor(() => expect(screen.getByLabelText('Wallet name')).toHaveValue('Wallet 3'));
    });

    it('activates an imported wallet and confirms its name', async () => {
        render(<App />);
        await screen.findAllByRole('button', { name: 'Settings' });

        await importSecondWallet();

        expect(host.addImportedWallet).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Second Wallet',
            mnemonic: PHRASE,
            password: PASSWORD,
        }));
        expect(await screen.findByText('Second Wallet is now active.')).toBeTruthy();
        await waitFor(() => expect(readActiveWallet()).toBe(host.second.id));

        await openWalletPicker();
        expect(walletRow('First Wallet')).not.toHaveAttribute('aria-current');
        expect(walletRow('Second Wallet')).toHaveAttribute('aria-current', 'true');
    });
});
