// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

const KEY = new Uint8Array(32).fill(71);

function wallet(id, name) {
    return {
        ...createWallet({
            name,
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: Buffer.from(`secret:${name}`).toString('base64'),
            kdfParams: {
                algorithm: 'argon2id',
                salt: 'c2FsdA==',
                iterations: 1,
                memory: 8192,
                parallelism: 1,
            },
        }),
        id,
    };
}

async function open(backend) {
    const vault = new Vault({ backend, masterKey: KEY });
    await vault.open();
    return vault;
}

describe('Vault cross-context saves', () => {
    it('merges a stale tab wallet add without losing either encrypted seed', async () => {
        const backend = new InMemoryBackend();
        const initial = await open(backend);
        await initial.wallets.put(wallet('first', 'First'));

        const tabA = await open(backend);
        const tabB = await open(backend);
        await tabA.wallets.put(wallet('second', 'Second'));
        await tabB.wallets.put(wallet('third', 'Third'));

        const wallets = await (await open(backend)).wallets.list();
        expect(wallets.map((record) => record.name).sort()).toEqual(['First', 'Second', 'Third']);
        expect(wallets.find((record) => record.id === 'second')?.encryptedSeed)
            .toBe(Buffer.from('secret:Second').toString('base64'));
        expect(wallets.find((record) => record.id === 'third')?.encryptedSeed)
            .toBe(Buffer.from('secret:Third').toString('base64'));
    });

    it('retains both wallets when two contexts add concurrently', async () => {
        const backend = new InMemoryBackend();
        const initial = await open(backend);
        await initial.wallets.put(wallet('first', 'First'));
        const tabA = await open(backend);
        const tabB = await open(backend);

        await Promise.all([
            tabA.wallets.put(wallet('second', 'Second')),
            tabB.wallets.put(wallet('third', 'Third')),
        ]);

        expect((await (await open(backend)).wallets.list()).map((record) => record.name).sort())
            .toEqual(['First', 'Second', 'Third']);
    });

    it('closes a stale vault instead of restoring a blob after another context wipes it', async () => {
        const backend = new InMemoryBackend();
        const initial = await open(backend);
        await initial.wallets.put(wallet('first', 'First'));
        const staleTab = await open(backend);

        await backend.clear();
        await expect(staleTab.wallets.put(wallet('second', 'Second')))
            .rejects.toMatchObject({ name: 'VaultConflictError' });

        await expect(backend.load()).resolves.toBeNull();
        expect(staleTab.isOpen).toBe(false);
    });

    it('retries a name-only wallet rename over an unrelated wallet add', async () => {
        const backend = new InMemoryBackend();
        const initial = await open(backend);
        await initial.wallets.put(wallet('first', 'First'));
        const renameTab = await open(backend);
        const settingsTab = await open(backend);
        await renameTab.wallets.put(wallet('second', 'Second'));

        const first = await settingsTab.wallets.get('first');
        await settingsTab.wallets.put({ ...first, name: 'Renamed' });
        expect((await (await open(backend)).wallets.list()).map((record) => record.name).sort())
            .toEqual(['Renamed', 'Second']);
    });

    it('refuses a stale delete and reloads the winning document', async () => {
        const backend = new InMemoryBackend();
        const initial = await open(backend);
        await initial.wallets.put(wallet('first', 'First'));
        const addTab = await open(backend);
        const deleteTab = await open(backend);
        await addTab.wallets.put(wallet('second', 'Second'));

        await expect(deleteTab.wallets.delete('first'))
            .rejects.toMatchObject({ name: 'VaultConflictError' });

        expect((await deleteTab.wallets.list()).map((record) => record.name).sort())
            .toEqual(['First', 'Second']);
    });

    it('drops a merged add from memory when the replay save fails for another reason', async () => {
        const backend = new InMemoryBackend();
        const initial = await open(backend);
        await initial.wallets.put(wallet('first', 'First'));
        let failNextSave = false;
        let saveCalls = 0;
        const flakyView = {
            load: () => backend.load(),
            clear: () => backend.clear(),
            async save(blob, options) {
                saveCalls += 1;
                if (failNextSave && saveCalls === 2) throw new Error('disk went away');
                return backend.save(blob, options);
            },
        };
        const addTab = await open(backend);
        const staleTab = await open(flakyView);
        await addTab.wallets.put(wallet('second', 'Second'));

        failNextSave = true;
        await expect(staleTab.wallets.put(wallet('third', 'Third'))).rejects.toThrow('disk went away');
        expect((await staleTab.wallets.list()).map((record) => record.name).sort())
            .toEqual(['First', 'Second']);

        await staleTab.wallets.put(wallet('fourth', 'Fourth'));
        expect((await (await open(backend)).wallets.list()).map((record) => record.name).sort())
            .toEqual(['First', 'Fourth', 'Second']);
    });

    it('locks a stale vault without writing after another context changes the password', async () => {
        const backend = new InMemoryBackend();
        const initial = await open(backend);
        await initial.wallets.put(wallet('first', 'First'));
        const staleTab = await open(backend);
        const newKey = new Uint8Array(32).fill(72);
        await expect(initial.rekey({ masterKey: newKey })).resolves.toBe(true);
        const rekeyedBlob = await backend.load();

        await expect(staleTab.wallets.put(wallet('second', 'Second')))
            .rejects.toMatchObject({ name: 'VaultConflictError' });

        expect(staleTab.isOpen).toBe(false);
        expect(await backend.load()).toEqual(rekeyedBlob);
        const reopened = new Vault({ backend, masterKey: newKey });
        await reopened.open();
        expect((await reopened.wallets.list()).map((record) => record.name)).toEqual(['First']);
    });

    it('refuses stale settings and reloads the winning document', async () => {
        const backend = new InMemoryBackend();
        const initial = await open(backend);
        await initial.wallets.put(wallet('first', 'First'));
        await initial.settings.put(createDefaultSettings());
        const addTab = await open(backend);
        const settingsTab = await open(backend);
        await addTab.wallets.put(wallet('second', 'Second'));
        const settings = await settingsTab.settings.get();

        await expect(settingsTab.settings.put({ ...settings, theme: 'dark' }))
            .rejects.toMatchObject({ name: 'VaultConflictError' });

        expect((await settingsTab.wallets.list()).map((record) => record.name).sort())
            .toEqual(['First', 'Second']);
        expect((await settingsTab.settings.get()).theme).toBe(createDefaultSettings().theme);
    });
});
