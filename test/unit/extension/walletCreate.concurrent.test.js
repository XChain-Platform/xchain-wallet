/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Two onboarding lanes that start at once on one install (two desktop
// windows, or a create beside an import) both meet an empty vault. Exactly
// one may win: the other refuses with WalletExistsError, and its cleanup
// never clears the blob or the kdfParams the winner wrote.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** kdfParams each lane derives its key from, by wallet name. */
const kdfByName = new Map();
let saltCounter = 0;

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    // Each lane yields inside its flow so both pass the fresh-vault check first.
    const yieldTurns = () => new Promise((resolve) => setTimeout(resolve, 5));
    return {
        ...actual,
        crypto: {
            ...actual.crypto,
            // A distinct salt per call gives each lane its own key, as a real KDF does.
            makeFreshKdfParams: () => {
                saltCounter += 1;
                return { algorithm: 'argon2id', salt: `s${saltCounter}`, memory: 1, iterations: 1, parallelism: 1 };
            },
            deriveMasterKey: (_password, params) => keyFor(params),
        },
        flows: {
            ...actual.flows,
            createWallet: async ({ name, kdfParams }) => {
                kdfByName.set(name, kdfParams);
                await yieldTurns();
                return { mnemonic: 'abandon '.repeat(11) + 'about', wallet: { id: `id-${name}`, name } };
            },
            importMnemonic: async ({ name, kdfParams }) => {
                kdfByName.set(name, kdfParams);
                await yieldTurns();
                return { format: 'bip39', wallet: { id: `id-${name}`, name } };
            },
            restoreLabelSyncAfterImport: undefined,
        },
    };
});

function keyFor(params) {
    const n = Number(String(params.salt).slice(1));
    return new Uint8Array(32).fill(n);
}

const { storage } = await import('@xchain-wallet/core');
const {
    handleWalletCreateWithMnemonic,
    handleWalletImport,
} = await import('../../../packages/extension/src/background/walletCreate.js');
const { FileStorageBackend, vaultPathFor } = await import('../../../packages/desktop/main/storage.js');

function makeMeta() {
    let meta = null;
    return {
        load: async () => meta,
        save: async (next) => { meta = next; },
        clear: async () => { meta = null; },
    };
}

function makeDeps(storageBackend, metaBackend) {
    return {
        storageBackend,
        metaBackend,
        sessionBackend: { save: async () => {} },
        signingSecretBackend: { save: async () => {} },
        chainRegistry: {},
        sdkRegistry: {},
    };
}

const create = (name, deps) => handleWalletCreateWithMnemonic({ password: 'pw', name }, deps);
const importPhrase = (name, deps) => handleWalletImport({ password: 'pw', mnemonic: 'abandon about', name }, deps);

/** Both lanes see the same backends, as two windows over one main process do. */
async function race(storageBackend, laneA, laneB) {
    const metaBackend = makeMeta();
    const settled = await Promise.allSettled([
        laneA('A', makeDeps(storageBackend, metaBackend)),
        laneB('B', makeDeps(storageBackend, metaBackend)),
    ]);
    return { settled, metaBackend };
}

async function expectOneWinnerKept({ settled, metaBackend }, storageBackend) {
    const won = settled.filter((s) => s.status === 'fulfilled');
    const lost = settled.filter((s) => s.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason?.name).toBe('WalletExistsError');

    const winnerKdf = kdfByName.get(won[0].value.walletName);
    const meta = await metaBackend.load();
    expect(meta).not.toBe(null);
    expect(meta.kdfParams).toEqual(winnerKdf);
    expect(await storageBackend.load()).not.toBe(null);

    // The stored blob opens under the winner's key, so the install unlocks.
    const vault = new storage.Vault({ backend: storageBackend, masterKey: keyFor(winnerKdf), autoSave: false });
    await expect(vault.open()).resolves.toBeUndefined();
    vault.close();
}

let dir;
beforeEach(() => {
    kdfByName.clear();
    dir = mkdtempSync(join(tmpdir(), 'xchain-create-race-'));
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const BACKENDS = [
    { name: 'in-memory storage', make: () => new storage.InMemoryBackend() },
    { name: 'desktop file storage', make: () => new FileStorageBackend(vaultPathFor(join(dir, 'profile'))) },
];

describe('concurrent pre-host onboarding keeps one wallet', () => {
    for (const backend of BACKENDS) {
        it(`${backend.name}: two creates at once leave the winner's blob and meta`, async () => {
            const storageBackend = backend.make();
            await expectOneWinnerKept(await race(storageBackend, create, create), storageBackend);
        });

        it(`${backend.name}: a create beside an import leaves the winner's blob and meta`, async () => {
            const storageBackend = backend.make();
            await expectOneWinnerKept(await race(storageBackend, create, importPhrase), storageBackend);
        });
    }

    it('two backend instances on one vault file: the conflicting lane clears nothing', async () => {
        const path = vaultPathFor(join(dir, 'profile'));
        const metaBackend = makeMeta();
        const settled = await Promise.allSettled([
            create('A', makeDeps(new FileStorageBackend(path), metaBackend)),
            create('B', makeDeps(new FileStorageBackend(path), metaBackend)),
        ]);
        await expectOneWinnerKept({ settled, metaBackend }, new FileStorageBackend(path));
    });
});

describe('FileStorageBackend compare-and-swap', () => {
    it('refuses a save whose expected blob is stale', async () => {
        const backend = new FileStorageBackend(vaultPathFor(join(dir, 'profile')));
        await backend.save(new Uint8Array([1, 2, 3]), { expected: null });
        await expect(backend.save(new Uint8Array([9]), { expected: null }))
            .rejects.toMatchObject({ name: 'VaultConflictError' });
        await expect(backend.save(new Uint8Array([9]), { expected: new Uint8Array([7]) }))
            .rejects.toMatchObject({ name: 'VaultConflictError' });
        expect(await backend.load()).toEqual(new Uint8Array([1, 2, 3]));
        await backend.save(new Uint8Array([4]), { expected: new Uint8Array([1, 2, 3]) });
        expect(await backend.load()).toEqual(new Uint8Array([4]));
    });

    it('lets one of two saves that expect an empty file win', async () => {
        const backend = new FileStorageBackend(vaultPathFor(join(dir, 'profile')));
        const settled = await Promise.allSettled([
            backend.save(new Uint8Array([1]), { expected: null }),
            backend.save(new Uint8Array([2]), { expected: null }),
        ]);
        expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
        expect(settled.filter((s) => s.status === 'rejected')[0].reason?.name).toBe('VaultConflictError');
        expect(await backend.load()).toEqual(new Uint8Array([1]));
    });

    it('keeps a save with no expected option as a plain write', async () => {
        const backend = new FileStorageBackend(vaultPathFor(join(dir, 'profile')));
        await backend.save(new Uint8Array([1]));
        await backend.save(new Uint8Array([2]));
        expect(await backend.load()).toEqual(new Uint8Array([2]));
    });
});
