// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Regression suite: Add wallet activation.
//
//   [P0] 2026-10-13: Creating or importing from Add wallet must activate the
//        added wallet before Home renders, so later actions use its identity.

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct horse battery staple';

const host = vi.hoisted(() => {
    const first = { id: 'wallet-1', name: 'First Wallet', format: 'bip39' };
    const second = { id: 'wallet-2', name: 'Second Wallet', format: 'bip39' };
    let wallets = [first];

    return {
        first,
        second,
        reset() { wallets = [first]; },
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
            return { walletId: second.id, walletName: name };
        }),
        setActiveWallet: vi.fn(async () => {}),
    };
});

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, generateBip39Mnemonic: () => PHRASE },
    };
});

vi.mock('../../packages/web/src/messaging.js', async (importOriginal) => ({
    ...await importOriginal(),
    getSessionStatus: host.getSessionStatus,
    listWallets: host.listWallets,
    listAccounts: host.listAccounts,
    addImportedWallet: host.addImportedWallet,
    setActiveWallet: host.setActiveWallet,
    getSettings: vi.fn(async () => ({})),
    updateSettings: vi.fn(async () => ({})),
    getWalletBalances: vi.fn(async () => ({})),
    getAddressesByChain: vi.fn(async () => ({})),
    getActiveAddresses: vi.fn(async () => ({})),
    listConfirmSessions: vi.fn(async () => []),
    listQueuedBroadcasts: vi.fn(async () => []),
    listContacts: vi.fn(async () => []),
    listConnectedSites: vi.fn(async () => []),
    listPendingAirdropsForWallet: vi.fn(async () => []),
    getCoinpayObligationsForAddress: vi.fn(async () => []),
    checkReachabilityRequest: vi.fn(async () => ({ reachable: true })),
    getNativePricesRequest: vi.fn(async () => ({})),
    reportAutoLock: undefined,
}));

import { App } from '../../packages/web/src/App.jsx';
import { readActiveWallet } from '../../packages/core/src/shared/utils/activeWalletMemory.js';

function answerRecoveryQuiz() {
    const words = PHRASE.split(' ');
    for (const input of screen.getAllByLabelText(/^Word \d+$/)) {
        const position = Number(input.labels[0].textContent.match(/\d+/)[0]);
        fireEvent.change(input, { target: { value: words[position - 1] } });
    }
}

async function openAddWallet() {
    // The condensed header keeps Settings inside its action menu.
    fireEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    const settings = await screen.findByRole('dialog', { name: 'Wallet settings' });
    fireEvent.click(within(settings).getByRole('button', { name: /First Wallet/ }));
    await screen.findByRole('heading', { name: 'Wallets' });
    fireEvent.click(screen.getByRole('button', { name: 'Add wallet' }));
}

async function createWallet() {
    fireEvent.click(await screen.findByRole('button', { name: 'Create new wallet' }));
    fireEvent.change(await screen.findByLabelText('Wallet name'), { target: { value: 'Second Wallet' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /saved my recovery phrase/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
    answerRecoveryQuiz();
    fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));
}

async function importWallet() {
    fireEvent.click(await screen.findByRole('button', { name: 'Import wallet' }));
    fireEvent.change(await screen.findByLabelText('Recovery phrase'), { target: { value: PHRASE } });
    fireEvent.change(screen.getByLabelText('Wallet name'), { target: { value: 'Second Wallet' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
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

describe('regression/add-wallet-becomes-active', () => {
    it.each([
        ['creating', createWallet],
        ['importing', importWallet],
    ])('[REGRESSION P0] makes the added wallet active after %s it', async (_action, addWallet) => {
        render(<App />);
        await screen.findAllByRole('button', { name: 'Settings' });

        await openAddWallet();
        await addWallet();
        fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

        expect(await screen.findByRole('button', { name: 'Home', current: 'page' }))
            .toBeInTheDocument();
        await waitFor(() => expect(readActiveWallet()).toBe(host.second.id));
        expect(await screen.findByText('Wallet: Second Wallet')).toBeInTheDocument();
    });
});
