// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const PHRASE = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
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

import { App } from '../../../packages/web/src/App.jsx';

function answerRecoveryQuiz() {
    const words = PHRASE.split(' ');
    for (const input of screen.getAllByLabelText(/^Word \d+$/)) {
        const position = Number(input.labels[0].textContent.match(/\d+/)[0]);
        fireEvent.change(input, { target: { value: words[position - 1] } });
    }
}

async function openWalletPicker() {
    let trigger;
    await waitFor(() => {
        trigger = screen.getAllByRole('button', { name: 'Settings' })
            .find((button) => button.getAttribute('aria-haspopup') === 'dialog');
        expect(trigger).toBeTruthy();
    });
    fireEvent.click(trigger);
    const settings = await screen.findByRole('dialog', { name: 'Wallet settings' });
    fireEvent.click(within(settings).getByRole('button', { name: /First Wallet|Second Wallet/ }));
    return screen.findByRole('heading', { name: 'Wallets' });
}

async function createSecondWallet() {
    await openWalletPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Add wallet' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create new wallet' }));

    fireEvent.change(await screen.findByLabelText('Wallet name'), { target: { value: 'Second Wallet' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.click(await screen.findByRole('checkbox', { name: /written down my recovery phrase/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
    answerRecoveryQuiz();
    fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
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
    it('keeps the first wallet active, switches to the new wallet, and restores it after remount', async () => {
        const firstMount = render(<App />);
        await screen.findAllByRole('button', { name: 'Settings' });

        await createSecondWallet();

        expect(host.addImportedWallet).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Second Wallet',
            mnemonic: PHRASE,
            password: PASSWORD,
            origin: 'created',
        }));
        await openWalletPicker();
        expect(walletRow('First Wallet')).toHaveAttribute('aria-current', 'true');
        const second = walletRow('Second Wallet');
        expect(second).not.toHaveAttribute('aria-current');

        fireEvent.click(second);
        await waitFor(() => expect(localStorage.getItem('xc:activeWallet')).toBe(host.second.id));

        await openWalletPicker();
        expect(walletRow('Second Wallet')).toHaveAttribute('aria-current', 'true');

        firstMount.unmount();
        render(<App />);
        await openWalletPicker();
        expect(walletRow('Second Wallet')).toHaveAttribute('aria-current', 'true');
    });
});
