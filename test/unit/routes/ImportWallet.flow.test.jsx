// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

const backendFlow = vi.hoisted(() => ({
    importSingleWif: vi.fn(),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    class TestVault {
        constructor({ backend }) {
            this.backend = backend;
        }
        async open() { /* blank test vault */ }
        async save() { await this.backend.save(new Uint8Array([1])); }
        close() { /* no retained key */ }
    }
    return {
        ...actual,
        crypto: {
            ...actual.crypto,
            makeFreshKdfParams: () => ({ algorithm: 'argon2id' }),
            deriveMasterKey: () => new Uint8Array(32).fill(4),
        },
        storage: { ...actual.storage, Vault: TestVault },
        flows: { ...actual.flows, importSingleWif: backendFlow.importSingleWif },
    };
});

const { handleWalletImport } = await import(
    '../../../packages/extension/src/background/walletCreate.js'
);

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WIF = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn';
const PASSWORD = 'correct-horse-battery';

function ImportFlow({ messaging }) {
    const [wallet, setWallet] = useState(null);
    if (wallet) {
        return (
            <main>
                <h1>Home</h1>
                <p>{wallet.name}</p>
            </main>
        );
    }
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <ImportWallet
                mode="fresh"
                onBack={() => {}}
                onImported={async () => {
                    const wallets = await messaging.listWallets();
                    setWallet(wallets[0]);
                }}
            />
        </MessagingProvider>
    );
}

function mountFlow() {
    let wallets = [];
    const importMnemonic = vi.fn(async (request) => {
        wallets = [{
            id: 'imported-wallet',
            name: request.name,
            format: request.wif ? 'wif-only' : 'bip39',
        }];
        return { walletId: 'imported-wallet', walletName: request.name };
    });
    const messaging = {
        importMnemonic,
        listWallets: vi.fn(async () => wallets),
    };
    render(<ImportFlow messaging={messaging} />);
    return messaging;
}

function fillPhrase(value) {
    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
}

afterEach(cleanup);

describe('wallet import flow', () => {
    it('identifies an invalid recovery word without importing', async () => {
        const messaging = mountFlow();
        fillPhrase(PHRASE.replace(/about$/, 'notaword'));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Unknown recovery phrase word "notaword"',
        );
        expect(messaging.importMnemonic).not.toHaveBeenCalled();
    });

    it('reports the entered recovery word count without importing', async () => {
        const messaging = mountFlow();
        fillPhrase(PHRASE.split(' ').slice(0, 11).join(' '));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Expected 12, 15, 18, 21, 24 words, got 11.',
        );
        expect(messaging.importMnemonic).not.toHaveBeenCalled();
    });

    it('distinguishes a checksum error from an invalid word', async () => {
        const messaging = mountFlow();
        fillPhrase(PHRASE.replace(/about$/, 'abandon'));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Every word is in the BIP39 list, but the checksum does not match.',
        );
        expect(messaging.importMnemonic).not.toHaveBeenCalled();
    });

    it.each([
        ['recovery phrase', 'Recovered Savings'],
        ['WIF private key', 'Paper Wallet'],
    ])('imports by %s and reaches Home with the wallet name', async (kind, walletName) => {
        const messaging = mountFlow();
        if (kind === 'WIF private key') {
            fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));
            fireEvent.change(screen.getByLabelText('WIF private key'), { target: { value: WIF } });
            fireEvent.click(screen.getByLabelText(
                en['importWallet.wif.ack'],
            ));
        } else {
            fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        }
        fireEvent.change(screen.getByLabelText('Wallet name'), { target: { value: walletName } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(await screen.findByText('Automatic Donation System')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
        expect(screen.getByText(walletName)).toBeInTheDocument();
        await waitFor(() => expect(messaging.importMnemonic).toHaveBeenCalledTimes(1));
        expect(messaging.importMnemonic).toHaveBeenCalledWith(expect.objectContaining(
            kind === 'WIF private key'
                ? { wif: WIF, chainId: 'bitcoin-mainnet', name: walletName }
                : { mnemonic: PHRASE, name: walletName },
        ));
    });

    it('routes a fresh WIF import through the cross-shell pre-host handler', async () => {
        backendFlow.importSingleWif.mockResolvedValueOnce({
            wallet: { id: 'wif-wallet', name: 'Paper Wallet', format: 'wif-only' },
        });
        const startLabelSyncRestore = vi.fn();
        let stored = null;
        const result = await handleWalletImport({
            password: PASSWORD,
            wif: WIF,
            chainId: 'bitcoin-mainnet',
            name: 'Paper Wallet',
        }, {
            storageBackend: {
                load: async () => stored,
                save: async (value) => { stored = value; },
            },
            metaBackend: { load: async () => null, save: vi.fn(async () => {}) },
            sessionBackend: { save: vi.fn(async () => {}) },
            signingSecretBackend: { save: vi.fn(async () => {}) },
            chainRegistry: {},
            sdkRegistry: {},
            startLabelSyncRestore,
        });

        expect(backendFlow.importSingleWif).toHaveBeenCalledWith(expect.objectContaining({
            password: PASSWORD,
            wif: WIF,
            chainId: 'bitcoin-mainnet',
            name: 'Paper Wallet',
        }));
        expect(result).toMatchObject({
            format: 'wif-only',
            walletName: 'Paper Wallet',
            walletId: 'wif-wallet',
            labelSyncToken: null,
        });
        expect(startLabelSyncRestore).not.toHaveBeenCalled();
    });
});
