// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAddress } from '../../../packages/core/src/schemas/address.js';
import { createContact } from '../../../packages/core/src/schemas/contact.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import {
    STORAGE_QUOTA_MESSAGE,
    Vault,
} from '../../../packages/core/src/storage/Vault.js';
import { writeHistoryCache } from '../../../packages/core/src/shared/utils/historyCache.js';
import { ChromeMetaBackend } from '../../../packages/extension/src/storage/ChromeMetaBackend.js';
import { ChromeStorageBackend } from '../../../packages/extension/src/storage/ChromeStorageBackend.js';
import { WebMetaBackend } from '../../../packages/web/src/storage/WebMetaBackend.js';

class RefusingBackend extends InMemoryBackend {
    refuseWrites = false;

    async save(blob) {
        if (this.refuseWrites) {
            throw new DOMException('Browser-specific storage detail', 'QuotaExceededError');
        }
        return super.save(blob);
    }
}

const KEY = new Uint8Array(32).fill(7);
const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const chromeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'chrome');

function address(label) {
    return createAddress({
        accountId: null,
        chain: 'bitcoin',
        network: 'mainnet',
        source: 'watch-only',
        addressType: 'p2wpkh',
        derivationPath: null,
        address: 'bc1qexample',
        publicKey: '02'.padEnd(66, '0'),
        label,
    });
}

beforeEach(() => {
    delete globalThis.localStorage;
});

afterEach(() => {
    vi.restoreAllMocks();
    if (localStorageDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
    } else {
        delete globalThis.localStorage;
    }
    if (chromeDescriptor) {
        Object.defineProperty(globalThis, 'chrome', chromeDescriptor);
    } else {
        delete globalThis.chrome;
    }
});

describe('low-storage writes', () => {
    it('rolls settings, contacts, and labels back when encrypted persistence fails', async () => {
        const backend = new RefusingBackend();
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();
        const settings = createDefaultSettings();
        const contact = createContact({
            name: 'Alice',
            entries: [{ chain: 'bitcoin', address: 'bc1qalice', label: '' }],
        });
        const savedAddress = address('Savings');
        await vault.settings.put(settings);
        await vault.contacts.put(contact);
        await vault.addresses.put(savedAddress);
        backend.refuseWrites = true;

        const writes = [
            () => vault.settings.put({ ...settings, theme: 'dark' }),
            () => vault.contacts.put({ ...contact, name: 'Changed' }),
            () => vault.addresses.put({ ...savedAddress, label: 'Changed' }),
            () => vault.contacts.delete(contact.id),
        ];
        for (const write of writes) {
            await expect(write()).rejects.toMatchObject({
                name: 'StorageQuotaError',
                message: STORAGE_QUOTA_MESSAGE,
            });
        }

        expect((await vault.settings.get()).theme).toBe(settings.theme);
        expect((await vault.contacts.get(contact.id)).name).toBe('Alice');
        expect((await vault.addresses.get(savedAddress.id)).label).toBe('Savings');

        const reopened = new Vault({ backend, masterKey: KEY });
        await reopened.open();
        expect((await reopened.settings.get()).theme).toBe(settings.theme);
        expect((await reopened.contacts.get(contact.id)).name).toBe('Alice');
        expect((await reopened.addresses.get(savedAddress.id)).label).toBe('Savings');
    });

    it('trims disposable web and extension caches before retrying a critical write', async () => {
        const values = new Map([
            ['xc:balanceCache:wallet:account', 'large balances'],
            ['xc:historyCache:v1:wallet:all', 'large history'],
            ['xchain-wallet:fiat-rates:v1', 'large rates'],
            ['xchain.logConsole', 'large logs'],
            ['xc:activeWallet', 'keep'],
        ]);
        const localStorage = {
            get length() { return values.size; },
            key(index) { return [...values.keys()][index] ?? null; },
            getItem(key) { return values.get(key) ?? null; },
            setItem(key, value) {
                if (values.has('xc:balanceCache:wallet:account')) {
                    throw new DOMException('engine quota detail', 'QuotaExceededError');
                }
                values.set(key, String(value));
            },
            removeItem(key) { values.delete(key); },
        };
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: localStorage,
        });
        const chromeValues = new Map([['xchain.logConsole', 'large extension logs']]);
        const chromeLocal = {
            get: vi.fn(async (key) => ({ [key]: chromeValues.get(key) })),
            set: vi.fn(async (items) => {
                if (chromeValues.has('xchain.logConsole')) {
                    throw new Error('QUOTA_BYTES quota exceeded');
                }
                for (const [key, value] of Object.entries(items)) chromeValues.set(key, value);
            }),
            remove: vi.fn(async (keys) => {
                for (const key of Array.isArray(keys) ? keys : [keys]) chromeValues.delete(key);
            }),
        };
        Object.defineProperty(globalThis, 'chrome', {
            configurable: true,
            value: { storage: { local: chromeLocal } },
        });

        const extensionVault = new Vault({
            backend: new ChromeStorageBackend({ chromeStorage: chromeLocal }),
            masterKey: KEY,
        });
        await extensionVault.open();
        await extensionVault.settings.put(createDefaultSettings());

        expect(chromeLocal.set).toHaveBeenCalledTimes(2);
        expect(chromeValues.has('xchain.logConsole')).toBe(false);

        chromeValues.set('xchain.logConsole', 'large extension logs');
        await new ChromeMetaBackend({ chromeStorage: chromeLocal }).save({ kdfParams: {} });
        expect(chromeValues.has('xchain.logConsole')).toBe(false);

        values.set('xc:balanceCache:wallet:account', 'large balances');

        const meta = new WebMetaBackend({ storage: localStorage });
        await meta.save({ kdfParams: { iterations: 3 } });

        expect(await meta.load()).toEqual({ kdfParams: { iterations: 3 } });
        expect(values.get('xc:activeWallet')).toBe('keep');
        expect(values.has('xc:balanceCache:wallet:account')).toBe(false);
        expect(values.has('xc:historyCache:v1:wallet:all')).toBe(false);
        expect(values.has('xchain-wallet:fiat-rates:v1')).toBe(false);
        expect(values.has('xchain.logConsole')).toBe(false);
        expect(chromeLocal.remove).toHaveBeenCalledWith(['xchain.logConsole']);
    });

    it('normalizes a desktop out-of-space refusal without retaining the mutation', async () => {
        const backend = new InMemoryBackend();
        backend.save = async () => {
            throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
        };
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();

        await expect(vault.settings.put(createDefaultSettings())).rejects.toMatchObject({
            name: 'StorageQuotaError',
            message: STORAGE_QUOTA_MESSAGE,
        });
        expect(await vault.settings.get()).toBeNull();
    });

    it('reports cache writes accurately without throwing when storage is unavailable or full', () => {
        const snapshot = { entries: [], addressesByChain: {}, fetchedAt: 1 };
        expect(writeHistoryCache('wallet-1', null, snapshot)).toBe(false);

        globalThis.localStorage = {
            setItem() { throw new DOMException('Storage is full', 'QuotaExceededError'); },
        };
        expect(writeHistoryCache('wallet-1', null, snapshot)).toBe(false);
    });
});
