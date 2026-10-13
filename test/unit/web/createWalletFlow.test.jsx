// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const PHRASE = 'abandon ability able about above absent absorb abstract absurd abuse access accident';

const background = vi.hoisted(() => {
    let walletCreated = false;
    return {
        reset() {
            walletCreated = false;
        },
        getSessionStatus: vi.fn(async () => ({ state: walletCreated ? 'unlocked' : 'no-wallet' })),
        importMnemonic: vi.fn(async () => {
            walletCreated = true;
            return { walletId: 'wallet-1' };
        }),
        getSettings: vi.fn(async () => ({})),
        listWallets: vi.fn(async () => [{ id: 'wallet-1', name: 'Main Wallet' }]),
        listAccounts: vi.fn(async () => [{ id: 'account-1', index: 0, name: 'Main Account' }]),
        getAddressesByChain: vi.fn(async () => ({})),
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
    getSessionStatus: background.getSessionStatus,
    importMnemonic: background.importMnemonic,
    getSettings: background.getSettings,
    listWallets: background.listWallets,
    listAccounts: background.listAccounts,
    getAddressesByChain: background.getAddressesByChain,
    reportAutoLock: undefined,
}));

import { App } from '../../../packages/web/src/App.jsx';

function answerQuiz(valueForPosition) {
    for (const input of screen.getAllByLabelText(/^Word \d+$/)) {
        const position = Number(input.labels[0].textContent.match(/\d+/)[0]);
        fireEvent.change(input, { target: { value: valueForPosition(position) } });
    }
}

beforeEach(() => {
    background.reset();
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('xc:licenseAcceptedAt', '2026-01-01T00:00:00.000Z');
    localStorage.setItem('xc:licenseAcceptedVersion', '2');
    localStorage.setItem('xc:onboardingExplainerSeenAt', '2026-01-01T00:00:00.000Z');
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('web create-wallet flow', () => {
    it('requires every create step before entering Home and moves focus with the flow', async () => {
        render(<App />);

        expect(await screen.findByRole('heading', { name: 'XChain Wallet' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create new wallet' }));

        expect(await screen.findByRole('heading', { name: 'Create a new wallet' })).toBeInTheDocument();
        const password = screen.getByLabelText(/^Password/);
        const confirm = screen.getByLabelText('Confirm password');
        await waitFor(() => expect(password).toHaveFocus());
        expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

        fireEvent.change(password, { target: { value: 'short' } });
        fireEvent.change(confirm, { target: { value: 'short' } });
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Write down your recovery phrase' })).toBeNull();

        fireEvent.change(password, { target: { value: 'correct horse battery staple' } });
        fireEvent.change(confirm, { target: { value: 'correct horse battery staple' } });
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        const recoveryHeading = await screen.findByRole('heading', { name: 'Write down your recovery phrase' });
        await waitFor(() => expect(recoveryHeading).toHaveFocus());
        expect(within(screen.getByRole('list', { name: 'Recovery phrase' })).getAllByRole('listitem')).toHaveLength(12);
        const verifyButton = screen.getByRole('button', { name: 'Verify recovery phrase' });
        expect(verifyButton).toBeDisabled();

        fireEvent.click(screen.getByRole('checkbox', { name: /written down my recovery phrase/ }));
        fireEvent.click(verifyButton);

        expect(await screen.findByRole('heading', { name: 'Verify your recovery phrase' })).toBeInTheDocument();
        const quizInputs = screen.getAllByLabelText(/^Word \d+$/);
        await waitFor(() => expect(quizInputs[0]).toHaveFocus());
        fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));
        expect(await screen.findByText('Fill in every word.')).toBeInTheDocument();
        expect(background.importMnemonic).not.toHaveBeenCalled();

        answerQuiz(() => 'wrong');
        fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));
        expect(await screen.findByText(/doesn't match/)).toBeInTheDocument();
        expect(background.importMnemonic).not.toHaveBeenCalled();

        const words = PHRASE.split(' ');
        answerQuiz((position) => words[position - 1]);
        fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));

        const donationHeading = await screen.findByRole('heading', { name: 'Automatic Donation System' });
        await waitFor(() => expect(donationHeading).toHaveFocus());
        expect(background.importMnemonic).toHaveBeenCalledTimes(1);
        expect(background.importMnemonic).toHaveBeenCalledWith(expect.objectContaining({
            password: 'correct horse battery staple',
            mnemonic: PHRASE,
            name: 'Main Wallet',
            origin: 'created',
        }));
        expect(background.getSessionStatus).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(await screen.findByRole('heading', { name: 'Home' }, { timeout: 10_000 })).toBeInTheDocument();
        expect(background.getSessionStatus).toHaveBeenCalledTimes(2);
    });
});
