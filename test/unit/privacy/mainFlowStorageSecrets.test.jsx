// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { clearLockoutState } from '../../../packages/core/src/flows/index.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import {
    DEFAULT_DB_NAME,
    DEFAULT_STORE_NAME,
    IndexedDBStorageBackend,
} from '../../../packages/web/src/storage/IndexedDBStorageBackend.js';

const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, generateBip39Mnemonic: () => PHRASE },
    };
});

const CHAIN_ID = 'bitcoin-mainnet';
const WALLET_ID = 'storage-canary-wallet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const PASSWORD = 'unlock-password-9Yx4-private-canary';
const PRIVATE_KEY = '1111111111111111111111111111111111111111111111111111111111111111';

function serialize(value) {
    if (typeof value === 'string') return value;
    try {
        const json = JSON.stringify(value, (_key, nested) => (
            typeof nested === 'bigint' ? String(nested) : nested
        ));
        return typeof json === 'string' ? json : String(value);
    } catch {
        return String(value);
    }
}

function createIndexedDbWriteSpy(writes) {
    const databases = new Map();

    function connection(dbName, state) {
        return {
            onversionchange: null,
            objectStoreNames: { contains: (name) => state.has(name) },
            createObjectStore(name) {
                state.set(name, new Map());
            },
            transaction(storeName) {
                const records = state.get(storeName);
                if (!records) throw new Error(`No object store named ${storeName}`);
                const tx = { onabort: null, oncomplete: null, onerror: null, error: null };
                const request = (operation) => {
                    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                        try {
                            req.result = operation();
                            req.onsuccess?.();
                            tx.oncomplete?.();
                        } catch (error) {
                            req.error = error;
                            req.onerror?.();
                            tx.onerror?.();
                        }
                    });
                    return req;
                };
                tx.objectStore = () => ({
                    get: (key) => request(() => records.get(key)),
                    put: (value, key) => request(() => {
                        writes.push({ dbName, storeName, method: 'put', key, value });
                        records.set(key, value);
                    }),
                    add: (value, key) => request(() => {
                        writes.push({ dbName, storeName, method: 'add', key, value });
                        records.set(key, value);
                    }),
                    delete: (key) => request(() => records.delete(key)),
                });
                return tx;
            },
            close() {},
        };
    }

    return {
        open(dbName) {
            const req = {
                result: null,
                error: null,
                onupgradeneeded: null,
                onsuccess: null,
                onerror: null,
                onblocked: null,
            };
            queueMicrotask(() => {
                const fresh = !databases.has(dbName);
                if (fresh) databases.set(dbName, new Map());
                req.result = connection(dbName, databases.get(dbName));
                if (fresh) req.onupgradeneeded?.();
                req.onsuccess?.();
            });
            return req;
        },
    };
}

function storageWritesSpy(writes) {
    const original = Storage.prototype.setItem;
    return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
        const area = this === localStorage
            ? 'localStorage'
            : this === sessionStorage ? 'sessionStorage' : 'unknown';
        writes.push({ area, key, value });
        return original.call(this, key, value);
    });
}

function answerQuiz() {
    const words = PHRASE.split(' ');
    for (const input of screen.getAllByLabelText(/^Word \d+$/)) {
        const position = Number(input.labels[0].textContent.match(/\d+/)[0]);
        fireEvent.change(input, { target: { value: words[position - 1] } });
    }
}

function renderWithMessaging(messaging, child) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>{child}</ToastHost>
        </MessagingProvider>,
    );
}

function sendMessaging() {
    const address = {
        id: 'source-address',
        address: FROM,
        publicKey: '02ab',
        privateKey: PRIVATE_KEY,
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    };
    const base = {
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [address] })),
        getActiveAddresses: vi.fn(async () => ({ [CHAIN_ID]: address })),
        getAddressBalances: vi.fn(async () => ({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        })),
        getSettings: vi.fn(async () => ({
            schemaVersion: 1,
            activeNetwork: 'mainnet',
            walletMode: 'full',
            grace: { testSendThresholdSats: 0 },
            privacy: { formDraftTtlMs: 24 * 60 * 60 * 1000 },
        })),
        updateSettings: vi.fn(async () => ({})),
        signerReady: vi.fn(async () => ({ ready: false })),
        getSignerStatus: vi.fn(async () => ({ unlocked: false })),
        listContacts: vi.fn(async () => []),
        getRecentDestinations: vi.fn(async () => []),
        getAddressHistory: vi.fn(async () => []),
        gatedSendReadiness: vi.fn(async () => ({ state: 'ungated' })),
        composeForConfirm: vi.fn(async () => ({
            psbt: '70736274ff',
            encoding: 'P2SH',
            actionString: `SEND|1|BTC|0.01|${TO}`,
            version: 1,
            chainId: CHAIN_ID,
            networkFeeSats: 1234,
            decoded: {
                summary: 'Send 0.01 BTC',
                details: [
                    { label: 'Token', value: 'BTC' },
                    { label: 'Amount', value: '0.01' },
                    { label: 'Destination', value: TO },
                ],
                warnings: [],
            },
            simulation: {
                deltas: [{ tick: 'BTC', before: '1', after: '0.98998766' }],
                notes: [],
            },
        })),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(async () => null);
            target[property] = stub;
            return stub;
        },
    });
}

afterEach(() => {
    cleanup();
    clearLockoutState();
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('main flow browser-storage privacy', () => {
    it('keeps passwords, recovery words, and private keys out of browser storage writes', async () => {
        clearLockoutState();
        localStorage.clear();
        sessionStorage.clear();
        const storageWrites = [];
        const indexedDbWrites = [];
        const setItem = storageWritesSpy(storageWrites);
        vi.stubGlobal('indexedDB', createIndexedDbWriteSpy(indexedDbWrites));

        localStorage.setItem('__storage_audit_probe__', 'local-write-observed');
        sessionStorage.setItem('__storage_audit_probe__', 'session-write-observed');
        localStorage.removeItem('__storage_audit_probe__');
        sessionStorage.removeItem('__storage_audit_probe__');

        const vaultBackend = new IndexedDBStorageBackend();
        const importMnemonic = vi.fn(async () => {
            await vaultBackend.save(new Uint8Array([0x91, 0x37, 0xac, 0xe5]));
            return { walletId: WALLET_ID };
        });
        renderWithMessaging(
            { importMnemonic },
            <CreateWallet onBack={() => {}} onCreated={() => {}} />,
        );
        fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Reveal recovery phrase' }));
        fireEvent.click(screen.getByRole('checkbox', { name: /saved my recovery phrase/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
        answerQuiz();
        fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));
        await waitFor(() => expect(importMnemonic).toHaveBeenCalledOnce());
        await waitFor(() => expect(indexedDbWrites).toHaveLength(1));
        cleanup();

        const unlockWallet = vi.fn(async () => ({ passphraseCaptureNeeded: [] }));
        const onUnlocked = vi.fn();
        renderWithMessaging({ unlockWallet }, <Locked onUnlocked={onUnlocked} />);
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
        cleanup();

        const revealMnemonicRequest = vi.fn(async () => ({
            mnemonic: PHRASE,
            format: 'bip39',
            passphraseEnabled: false,
            bip39Passphrase: null,
        }));
        renderWithMessaging(
            { revealMnemonicRequest },
            <BackupSection activeWallet={{ id: WALLET_ID, name: 'Storage canary' }} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), {
            target: { value: PASSWORD },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
        await screen.findByText(PHRASE);
        cleanup();

        const send = sendMessaging();
        renderWithMessaging(send, <Send walletId={WALLET_ID} />);
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: '0.01' } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        await screen.findByTestId('confirm-modal');
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        await waitFor(() => expect(screen.getByTestId('confirm-approve')).toBeEnabled());

        expect(setItem.mock.calls.length).toBeGreaterThan(2);
        expect(storageWrites.some((write) => write.area === 'localStorage')).toBe(true);
        expect(storageWrites.some((write) => write.area === 'sessionStorage')).toBe(true);
        expect(indexedDbWrites).toEqual(expect.arrayContaining([
            expect.objectContaining({
                dbName: DEFAULT_DB_NAME,
                storeName: DEFAULT_STORE_NAME,
                method: 'put',
            }),
        ]));

        const writtenOutsideVault = [
            ...storageWrites.map((write) => write.value),
            ...indexedDbWrites
                .filter((write) => !(
                    write.dbName === DEFAULT_DB_NAME
                    && write.storeName === DEFAULT_STORE_NAME
                ))
                .map((write) => write.value),
        ].map(serialize);
        const secrets = [PASSWORD, PRIVATE_KEY, PHRASE, ...new Set(PHRASE.split(' '))];

        for (const secret of secrets) {
            expect(
                writtenOutsideVault.filter((value) => value.includes(secret)),
                secret,
            ).toEqual([]);
        }
    });
});
