// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { emptyDocument, encodeDocument } from '../../../packages/core/src/storage/codec.js';
import { createContact } from '../../../packages/core/src/schemas/contact.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';

const KEY = new Uint8Array(32).fill(29);

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

describe('storage/Vault concurrency and consistency', () => {
    it('serializes overlapping auto-saves so an older snapshot cannot land last', async () => {
        const firstSave = deferred();
        const firstStarted = deferred();
        let saveCalls = 0;
        class PausedBackend extends InMemoryBackend {
            async save(blob) {
                saveCalls += 1;
                if (saveCalls === 1) {
                    firstStarted.resolve();
                    await firstSave.promise;
                }
                await super.save(blob);
            }
        }

        const backend = new PausedBackend();
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();
        const first = vault.contacts.put(createContact({
            name: 'First',
            entries: [{ chain: 'bitcoin', address: 'first', label: '' }],
        }));
        await firstStarted.promise;
        const second = vault.contacts.put(createContact({
            name: 'Second',
            entries: [{ chain: 'bitcoin', address: 'second', label: '' }],
        }));

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(saveCalls).toBe(1);
        firstSave.resolve();
        await Promise.all([first, second]);

        const reopened = new Vault({ backend, masterKey: KEY });
        await reopened.open();
        expect((await reopened.contacts.list()).map((contact) => contact.name).sort())
            .toEqual(['First', 'Second']);
    });

    it('rolls back failed puts and deletes without poisoning later writes', async () => {
        class RefusingBackend extends InMemoryBackend {
            failNext = true;

            async save(blob) {
                if (this.failNext) {
                    this.failNext = false;
                    throw new Error('write refused');
                }
                await super.save(blob);
            }
        }

        const backend = new RefusingBackend();
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();
        const contact = createContact({
            name: 'Kept',
            entries: [{ chain: 'bitcoin', address: 'kept', label: '' }],
        });

        await expect(vault.contacts.put(contact)).rejects.toThrow('write refused');
        expect(await vault.contacts.count()).toBe(0);

        await vault.contacts.put(contact);
        backend.failNext = true;
        await expect(vault.contacts.delete(contact.id)).rejects.toThrow('write refused');
        expect(await vault.contacts.get(contact.id)).toEqual(contact);

        const reopened = new Vault({ backend, masterKey: KEY });
        await reopened.open();
        expect(await reopened.contacts.get(contact.id)).toEqual(contact);
    });

    it('shares an in-flight open instead of loading and replacing the document twice', async () => {
        const loadGate = deferred();
        const backend = new InMemoryBackend();
        backend.load = vi.fn(async () => {
            await loadGate.promise;
            return null;
        });
        const vault = new Vault({ backend, masterKey: KEY });

        const first = vault.open();
        const second = vault.open();
        expect(backend.load).toHaveBeenCalledTimes(1);
        loadGate.resolve();
        await Promise.all([first, second]);
        expect(backend.load).toHaveBeenCalledTimes(1);
    });

    it('caches a lazy migration and persists that exact result on the next save', async () => {
        const document = emptyDocument();
        document.wallets.push({
            schemaVersion: 1,
            id: 'legacy-wallet',
            name: 'Legacy',
            createdAt: '2026-01-01T00:00:00.000Z',
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptionAlgorithm: 'aes-256-gcm',
            encryptedSeed: 'c2VlZA==',
            kdfParams: {
                algorithm: 'argon2id',
                salt: 'c2FsdA==',
                iterations: 3,
                memory: 65536,
                parallelism: 1,
            },
            importedKeys: [],
            multisig: { scheme: 'p2wsh-multisig', threshold: 2, cosigners: [] },
        });
        const backend = new InMemoryBackend(await encodeDocument(KEY, document));
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();

        const first = await vault.wallets.get('legacy-wallet');
        const second = await vault.wallets.get('legacy-wallet');
        expect(second.multisigs[0].id).toBe(first.multisigs[0].id);

        await vault.save();
        const reopened = new Vault({ backend, masterKey: KEY });
        await reopened.open();
        expect((await reopened.wallets.get('legacy-wallet')).multisigs[0].id)
            .toBe(first.multisigs[0].id);
    });
});

describe('storage/Vault rekey (password change)', () => {
    const NEXT = new Uint8Array(32).fill(41);
    const walletRecord = (id, seed) => ({
        ...createWallet({
            name: `Wallet ${id}`,
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: seed,
            kdfParams: { algorithm: 'argon2id', salt: 'c2FsdA==', iterations: 1, memory: 8192, parallelism: 1 },
        }),
        id,
    });

    async function opened(backend = new InMemoryBackend()) {
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();
        await vault.wallets.put(walletRecord('w1', 'c2VhbGVkLW9sZA=='));
        await vault.wallets.put(walletRecord('w2', 'b3RoZXItc2VhbA=='));
        return { vault, backend };
    }

    it('compares a candidate key in constant shape and never matches a wrong length', async () => {
        const { vault } = await opened();
        expect(vault.keyMatches(new Uint8Array(KEY))).toBe(true);
        expect(vault.keyMatches(NEXT)).toBe(false);
        expect(vault.keyMatches(new Uint8Array(31).fill(29))).toBe(false);
    });

    it('seals the document under the new key with the replaced wallets, in one write', async () => {
        const { vault, backend } = await opened();
        const saveSpy = vi.spyOn(backend, 'save');
        const replaced = { ...(await vault.wallets.get('w1')), encryptedSeed: 'c2VhbGVkLW5ldw==' };

        await vault.rekey({ masterKey: NEXT, wallets: [replaced] });

        expect(saveSpy).toHaveBeenCalledTimes(1);
        expect(vault.keyMatches(NEXT)).toBe(true);
        await expect(new Vault({ backend, masterKey: KEY }).open()).rejects.toMatchObject({ name: 'AeadAuthError' });
        const reopened = new Vault({ backend, masterKey: NEXT });
        await reopened.open();
        expect((await reopened.wallets.get('w1')).encryptedSeed).toBe('c2VhbGVkLW5ldw==');
        expect((await reopened.wallets.get('w2')).encryptedSeed).toBe('b3RoZXItc2VhbA==');
        // Later writes land under the new key too.
        await vault.wallets.put({ ...(await vault.wallets.get('w2')), name: 'Renamed' });
        const again = new Vault({ backend, masterKey: NEXT });
        await again.open();
        expect((await again.wallets.get('w2')).name).toBe('Renamed');
    });

    it('takes its own copy of the new key', async () => {
        const { vault, backend } = await opened();
        const caller = new Uint8Array(NEXT);
        await vault.rekey({ masterKey: caller, wallets: [] });
        caller.fill(0);
        await vault.wallets.put({ ...(await vault.wallets.get('w1')), name: 'After zeroing' });
        const reopened = new Vault({ backend, masterKey: NEXT });
        await reopened.open();
        expect((await reopened.wallets.get('w1')).name).toBe('After zeroing');
    });

    it('a failed write leaves the stored blob, the key and the document as they were', async () => {
        class RefusingBackend extends InMemoryBackend {
            refuse = false;

            async save(blob) {
                if (this.refuse) throw new Error('write refused');
                await super.save(blob);
            }
        }
        const { vault, backend } = await opened(new RefusingBackend());
        backend.refuse = true;
        const replaced = { ...(await vault.wallets.get('w1')), encryptedSeed: 'c2VhbGVkLW5ldw==' };

        await expect(vault.rekey({ masterKey: NEXT, wallets: [replaced] })).rejects.toThrow('write refused');

        expect(vault.keyMatches(KEY)).toBe(true);
        expect((await vault.wallets.get('w1')).encryptedSeed).toBe('c2VhbGVkLW9sZA==');
        backend.refuse = false;
        await vault.wallets.put({ ...(await vault.wallets.get('w2')), name: 'Still writable' });
        const reopened = new Vault({ backend, masterKey: KEY });
        await reopened.open();
        expect((await reopened.wallets.get('w1')).encryptedSeed).toBe('c2VhbGVkLW9sZA==');
        expect((await reopened.wallets.get('w2')).name).toBe('Still writable');
    });

    it('refuses an unknown wallet id or an invalid record before writing', async () => {
        const { vault, backend } = await opened();
        const saveSpy = vi.spyOn(backend, 'save');
        await expect(vault.rekey({ wallets: [walletRecord('nope', 'eA==')] })).rejects.toThrow(/no wallet/);
        await expect(vault.rekey({ wallets: [{ id: 'w1' }] })).rejects.toMatchObject({ name: 'VaultValidationError' });
        await expect(vault.rekey({ masterKey: new Uint8Array(16) })).rejects.toThrow(/32-byte/);
        expect(saveSpy).not.toHaveBeenCalled();
        expect(vault.keyMatches(KEY)).toBe(true);
    });
});
