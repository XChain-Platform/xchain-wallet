// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { createContact } from '../../../packages/core/src/schemas/contact.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import {
    Vault,
    VaultStateError,
    VaultValidationError,
} from '../../../packages/core/src/storage/Vault.js';

const KEY = new Uint8Array(32).fill(67);

function contact() {
    return createContact({
        name: 'Alice',
        entries: [{ chain: 'bitcoin', address: 'alice', label: '' }],
    });
}

describe('Vault uncovered branches', () => {
    it('rejects a rekey replacement without a record id', async () => {
        const vault = new Vault({ backend: new InMemoryBackend(), masterKey: KEY });
        await vault.open();

        await expect(vault.rekey({ wallets: [null] })).rejects.toMatchObject({
            name: 'VaultValidationError',
            collection: 'wallets',
            errors: ['record.id is required'],
        });
        await expect(vault.rekey({ wallets: [{}] })).rejects.toBeInstanceOf(VaultValidationError);
    });

    it('reseals with the current key when no replacement key is supplied', async () => {
        const backend = new InMemoryBackend();
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();

        await expect(vault.rekey()).resolves.toBe(true);

        const reopened = new Vault({ backend, masterKey: KEY });
        await expect(reopened.open()).resolves.toBeUndefined();
    });

    it('preserves the current key when a keyless reseal fails', async () => {
        class RefusingBackend extends InMemoryBackend {
            async save() {
                throw new Error('write refused');
            }
        }

        const vault = new Vault({ backend: new RefusingBackend(), masterKey: KEY });
        await vault.open();

        await expect(vault.rekey()).rejects.toThrow('write refused');
        expect(vault.keyMatches(KEY)).toBe(true);
    });

    it('does not restore a keyless reseal into a handle closed during save', async () => {
        const backend = new InMemoryBackend();
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();
        backend.save = async (blob) => {
            await InMemoryBackend.prototype.save.call(backend, blob);
            vault.close();
        };

        await expect(vault.rekey()).resolves.toBe(false);
        expect(vault.isOpen).toBe(false);
    });

    it('reports a cleared key when the other open-state fields remain set', async () => {
        const vault = new Vault({ backend: new InMemoryBackend(), masterKey: KEY });
        await vault.open();
        vault._masterKey = null;

        await expect(vault.contacts.count()).rejects.toThrow(
            new VaultStateError('Vault is closed (masterKey cleared)'),
        );
    });

    it('does not roll a mutation back over a close that lands during save', async () => {
        const backend = new InMemoryBackend();
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();
        backend.save = async () => {
            vault.close();
            throw new Error('write interrupted');
        };

        await expect(vault.contacts.put(contact())).rejects.toThrow('write interrupted');
        expect(vault.isOpen).toBe(false);
    });
});
