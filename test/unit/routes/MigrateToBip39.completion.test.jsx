// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WORDS = PHRASE.split(' ');
const CHAIN = 'migration-test-chain';
const LEGACY_ADDRESS = {
    id: 'legacy-address-id',
    address: 'legacy-address',
    derivationPath: "m/0'/0/0",
    source: 'hd',
};
const NEW_ADDRESS = {
    id: 'new-address-id',
    address: 'new-address',
    derivationPath: "m/44'/0'/0'/0/0",
    source: 'hd',
};

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: {
            ...actual.crypto,
            generateBip39Mnemonic: () => PHRASE,
        },
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MigrateToBip39 } from '../../../packages/core/src/shared/routes/MigrateToBip39.jsx';

afterEach(() => {
    cleanup();
    localStorage.clear();
});

function makeMessaging(overrides = {}) {
    return {
        getAddressesByChain: vi.fn(async (walletId) => (
            walletId === 'wallet-old'
                ? { [CHAIN]: [LEGACY_ADDRESS] }
                : { [CHAIN]: [NEW_ADDRESS] }
        )),
        addImportedWallet: vi.fn().mockResolvedValue({ walletId: 'wallet-new' }),
        ...overrides,
    };
}

function renderMigration(messaging = makeMessaging()) {
    const onBack = vi.fn();
    const onMigrated = vi.fn();
    const onSweepChain = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MigrateToBip39
                legacyWalletId="wallet-old"
                onBack={onBack}
                onMigrated={onMigrated}
                onSweepChain={onSweepChain}
            />
        </MessagingProvider>,
    );
    return { messaging, onBack, onMigrated, onSweepChain };
}

async function reachBackup(context) {
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password1' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
        target: { value: 'password1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate recovery phrase' }));

    expect(await screen.findByText('Write down your recovery phrase')).toBeTruthy();
    const phrase = screen.getByRole('list', { name: 'Recovery phrase' });
    expect(within(phrase).getAllByRole('listitem')).toHaveLength(12);
    expect(within(phrase).getByText('about')).toBeTruthy();
    expect(context.messaging.addImportedWallet).not.toHaveBeenCalled();
    expect(context.messaging.getAddressesByChain).not.toHaveBeenCalled();
}

async function reachVerify(context) {
    await reachBackup(context);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
    expect(await screen.findByText('Verify your written copy')).toBeTruthy();
}

function answerQuiz({ wrongFirst = false } = {}) {
    const inputs = screen.getAllByLabelText(/^Word \d+$/);
    inputs.forEach((input, index) => {
        const position = Number(input.labels[0].textContent.match(/\d+/)[0]);
        fireEvent.change(input, {
            target: { value: wrongFirst && index === 0 ? 'wrong' : WORDS[position - 1] },
        });
    });
}

describe('MigrateToBip39 safety and completion', () => {
    it('shows and verifies the phrase before saving or reading the legacy wallet', async () => {
        let resolveCreate;
        const messaging = makeMessaging({
            addImportedWallet: vi.fn(() => new Promise((resolve) => { resolveCreate = resolve; })),
        });
        const context = renderMigration(messaging);
        await reachVerify(context);

        answerQuiz();
        fireEvent.click(screen.getByRole('button', { name: 'Create BIP39 wallet' }));

        expect(await screen.findByText('Creating your new wallet')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Back to previous screen' })).toBeDisabled();
        expect(messaging.getAddressesByChain).not.toHaveBeenCalled();
        expect(context.onSweepChain).not.toHaveBeenCalled();
        await waitFor(() => expect(messaging.addImportedWallet).toHaveBeenCalledWith({
            password: 'password1',
            mnemonic: PHRASE,
            name: 'XChain BIP39 Wallet',
            origin: 'created',
        }));

        await act(async () => resolveCreate({ walletId: 'wallet-new' }));
        expect(await screen.findByText('New BIP39 wallet ready')).toBeTruthy();
        await waitFor(() => expect(messaging.getAddressesByChain).toHaveBeenCalledTimes(2));

        fireEvent.click(screen.getByRole('button', { name: 'Review sweep' }));
        expect(context.onSweepChain).toHaveBeenCalledWith({
            legacyWalletId: 'wallet-old',
            newWalletId: 'wallet-new',
            chainId: CHAIN,
            fromAddress: LEGACY_ADDRESS.address,
            toAddress: NEW_ADDRESS.address,
        });
        expect(context.onMigrated).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
        expect(context.onMigrated).toHaveBeenCalledWith('wallet-new');
        expect(context.onBack).toHaveBeenCalledTimes(1);
    });

    it('blocks a bad quiz answer and lets every pre-save step unwind safely', async () => {
        const context = renderMigration();
        await reachVerify(context);

        answerQuiz({ wrongFirst: true });
        fireEvent.click(screen.getByRole('button', { name: 'Create BIP39 wallet' }));

        expect(await screen.findByText(/does not match your recovery phrase/)).toBeTruthy();
        expect(context.messaging.addImportedWallet).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Back to phrase' }));
        expect(await screen.findByRole('list', { name: 'Recovery phrase' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
        expect(await screen.findByRole('button', { name: 'Generate recovery phrase' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(context.onBack).toHaveBeenCalledTimes(1);
        expect(context.messaging.addImportedWallet).not.toHaveBeenCalled();
        expect(context.messaging.getAddressesByChain).not.toHaveBeenCalled();
    });

    it('surfaces a save failure and keeps the verified phrase available for retry', async () => {
        const messaging = makeMessaging({
            addImportedWallet: vi.fn()
                .mockRejectedValueOnce(new Error('Vault is locked.'))
                .mockResolvedValueOnce({ walletId: 'wallet-new' }),
        });
        const context = renderMigration(messaging);
        await reachVerify(context);
        answerQuiz();

        fireEvent.click(screen.getByRole('button', { name: 'Create BIP39 wallet' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Vault is locked.');
        expect(screen.getByText('Verify your written copy')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Back to phrase' }));
        expect(screen.getByRole('list', { name: 'Recovery phrase' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
        answerQuiz();
        fireEvent.click(screen.getByRole('button', { name: 'Create BIP39 wallet' }));

        expect(await screen.findByText('New BIP39 wallet ready')).toBeTruthy();
        expect(messaging.addImportedWallet).toHaveBeenCalledTimes(2);
    });

    it('reports address-loading failure and retries without recreating the wallet', async () => {
        let oldAddressAttempts = 0;
        const messaging = makeMessaging({
            getAddressesByChain: vi.fn(async (walletId) => {
                if (walletId === 'wallet-old' && oldAddressAttempts++ === 0) {
                    throw new Error('Address service unavailable.');
                }
                return walletId === 'wallet-old'
                    ? { [CHAIN]: [LEGACY_ADDRESS] }
                    : { [CHAIN]: [NEW_ADDRESS] };
            }),
        });
        const context = renderMigration(messaging);
        await reachVerify(context);
        answerQuiz();
        fireEvent.click(screen.getByRole('button', { name: 'Create BIP39 wallet' }));

        expect(await screen.findByText('Could not load all migration addresses.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('button', { name: 'Review sweep' })).toBeTruthy();
        expect(messaging.addImportedWallet).toHaveBeenCalledTimes(1);
    });
});
