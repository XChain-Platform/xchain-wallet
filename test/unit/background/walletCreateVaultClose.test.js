// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The pre-host create, import and fresh-restore lanes close the Vault they
// built on every exit. Vault keeps a private copy of the master key and only
// close() zeros it, so a flow or save that throws must not skip the close.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    startLabelSyncRestoreTask,
    waitForLabelSyncRestoreTask,
} from '../../../packages/extension/src/background/labelSyncRestoreTasks.js';

const flowBehaviour = {};
/** @type {{ vault: any, key: Uint8Array, closes: number }[]} */
const built = [];

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    // A real Vault that remembers the key buffer it copied, since close() nulls the field.
    class RecordingVault extends actual.storage.Vault {
        constructor(opts) {
            super(opts);
            this._record = { vault: this, key: this._masterKey, closes: 0 };
            built.push(this._record);
        }
        close() {
            this._record.closes += 1;
            super.close();
        }
    }
    const scripted = (name) => (...args) => flowBehaviour[name](...args);
    return {
        ...actual,
        crypto: {
            ...actual.crypto,
            makeFreshKdfParams: () => ({ algorithm: 'argon2id', salt: 'x', memory: 1, iterations: 1, parallelism: 1 }),
            deriveMasterKey: () => new Uint8Array(32).fill(7),
        },
        storage: { ...actual.storage, Vault: RecordingVault },
        flows: {
            ...actual.flows,
            createWallet: scripted('createWallet'),
            importMnemonic: scripted('importMnemonic'),
            importBackupFile: scripted('importBackupFile'),
            restoreLabelSyncAfterImport: undefined,
        },
    };
});

const {
    handleWalletCreateWithMnemonic,
    handleWalletImport,
    handleWalletImportBackup,
    assertFreshVault,
} = await import('../../../packages/extension/src/background/walletCreate.js');

function makeDeps(over = {}) {
    let blob = null;
    let meta = null;
    return {
        storageBackend: {
            async load() { return blob; },
            async save(next) { blob = next; },
            async clear() { blob = null; },
        },
        metaBackend: {
            load: async () => meta,
            save: vi.fn(async (next) => { meta = next; }),
            clear: async () => { meta = null; },
        },
        sessionBackend: { save: vi.fn(async () => {}) },
        signingSecretBackend: { save: vi.fn(async () => {}) },
        chainRegistry: {},
        sdkRegistry: {},
        ...over,
    };
}

const LANES = [
    {
        name: 'create',
        flow: 'createWallet',
        ok: async () => ({ mnemonic: 'abandon '.repeat(11) + 'about', wallet: { id: 'w1', name: 'Main Wallet' } }),
        call: (deps) => handleWalletCreateWithMnemonic({ password: 'pw' }, deps),
    },
    {
        name: 'import',
        flow: 'importMnemonic',
        ok: async () => ({ format: 'bip39', wallet: { id: 'w1', name: 'Imported Wallet' } }),
        call: (deps) => handleWalletImport({ password: 'pw', mnemonic: 'abandon about' }, deps),
    },
    {
        name: 'restore',
        flow: 'importBackupFile',
        ok: async () => ({ walletId: 'w1', payload: { wallet: { name: 'Restored' } }, writes: {}, skipped: {}, rekeyed: false }),
        call: (deps) => handleWalletImportBackup(
            { password: 'pw', backupPassword: 'bp', walletPassword: 'wp', fileContent: '{"x":1}' },
            deps,
        ),
    },
];

const zeroed = (key) => key.every((b) => b === 0);

beforeEach(() => {
    built.length = 0;
    for (const lane of LANES) flowBehaviour[lane.flow] = lane.ok;
});

describe('pre-host onboarding closes its Vault on every exit', () => {
    for (const lane of LANES) {
        it(`${lane.name}: a throwing flow still zeros the Vault's key copy`, async () => {
            flowBehaviour[lane.flow] = async () => { throw new Error('flow refused'); };
            const deps = makeDeps();
            await expect(lane.call(deps)).rejects.toThrow('flow refused');
            expect(built).toHaveLength(1);
            expect(built[0].closes).toBe(1);
            expect(zeroed(built[0].key)).toBe(true);
            expect(deps.metaBackend.save).not.toHaveBeenCalled();
        });

        it(`${lane.name}: a refused vault save still zeros the Vault's key copy`, async () => {
            const deps = makeDeps();
            deps.storageBackend.save = async () => { throw new Error('disk full'); };
            await expect(lane.call(deps)).rejects.toThrow('Storage is full');
            expect(built).toHaveLength(1);
            expect(built[0].closes).toBe(1);
            expect(zeroed(built[0].key)).toBe(true);
        });

        it(`${lane.name}: the success path closes exactly once`, async () => {
            const deps = makeDeps();
            await lane.call(deps);
            expect(built).toHaveLength(1);
            expect(built[0].closes).toBe(1);
            expect(zeroed(built[0].key)).toBe(true);
            expect(deps.metaBackend.save).toHaveBeenCalledTimes(1);
        });
    }
});

describe('pre-host onboarding leaves no half-written wallet behind', () => {
    for (const lane of LANES) {
        it(`${lane.name}: a refused kdfParams save discards the blob so the install is fresh again`, async () => {
            const deps = makeDeps();
            deps.metaBackend.save.mockRejectedValue(new Error('metadata could not be persisted'));
            await expect(lane.call(deps)).rejects.toThrow('metadata could not be persisted');
            expect(await deps.storageBackend.load()).toBeNull();
            await expect(assertFreshVault(deps)).resolves.toBeUndefined();
        });

        it(`${lane.name}: a refused session save discards the blob and the kdfParams`, async () => {
            const deps = makeDeps();
            deps.sessionBackend.save.mockRejectedValue(new Error('session store refused'));
            await expect(lane.call(deps)).rejects.toThrow('session store refused');
            expect(await deps.storageBackend.load()).toBeNull();
            expect(await deps.metaBackend.load()).toBeNull();
        });

        it(`${lane.name}: a flow that throws after its first write discards the blob`, async () => {
            flowBehaviour[lane.flow] = async () => { throw new Error('storage is full'); };
            const deps = makeDeps();
            await deps.storageBackend.save(new Uint8Array(0));
            deps.storageBackend.load = async () => null;
            const clear = vi.spyOn(deps.storageBackend, 'clear');
            await expect(lane.call(deps)).rejects.toThrow('storage is full');
            expect(clear).toHaveBeenCalledTimes(1);
        });

        it(`${lane.name}: a clear that also fails still reports the original error`, async () => {
            const deps = makeDeps();
            deps.metaBackend.save.mockRejectedValue(new Error('metadata could not be persisted'));
            deps.storageBackend.clear = async () => { throw new Error('clear refused'); };
            await expect(lane.call(deps)).rejects.toThrow('metadata could not be persisted');
        });
    }

    it('a wallet that already exists is never discarded by the refusal', async () => {
        const deps = makeDeps();
        await deps.metaBackend.save({ kdfParams: {} });
        const clear = vi.spyOn(deps.storageBackend, 'clear');
        await expect(LANES[0].call(deps)).rejects.toThrow('A wallet already exists');
        expect(clear).not.toHaveBeenCalled();
    });
});

describe('pre-host mnemonic import honours a pinned format', () => {
    it('hands the caller\'s format to the flow', async () => {
        const seen = [];
        flowBehaviour.importMnemonic = async (opts) => {
            seen.push(opts.format);
            return { format: opts.format, wallet: { id: 'w1', name: 'FreeWallet' } };
        };
        const result = await handleWalletImport(
            { password: 'pw', mnemonic: 'abandon about', format: 'counterwallet-legacy' },
            makeDeps(),
        );
        expect(seen).toEqual(['counterwallet-legacy']);
        expect(result.format).toBe('counterwallet-legacy');
    });
});

describe('pre-host mnemonic import hands label restore to the unlocked host', () => {
    it('returns before restore finishes and keeps the result available', async () => {
        let finishRestore;
        const restore = vi.fn(() => new Promise((resolve) => {
            finishRestore = resolve;
        }));
        const deps = makeDeps({
            onUnlocked: vi.fn(async () => {}),
            startLabelSyncRestore: ({ walletId }) => startLabelSyncRestoreTask({
                walletId,
                run: restore,
            }),
        });

        const imported = await handleWalletImport({ password: 'pw', mnemonic: 'abandon about' }, deps);
        expect(imported.labelSyncToken).toEqual(expect.any(String));
        expect(deps.onUnlocked).toHaveBeenCalledTimes(1);

        let resultSettled = false;
        const resultPromise = waitForLabelSyncRestoreTask(imported.labelSyncToken).then((value) => {
            resultSettled = true;
            return value;
        });
        await Promise.resolve();
        expect(resultSettled).toBe(false);

        const applied = { restored: true, contactsUpdated: 1 };
        finishRestore(applied);
        await expect(resultPromise).resolves.toEqual(applied);
    });

    it('does not turn a background restore failure into an import failure', async () => {
        const deps = makeDeps({
            onUnlocked: vi.fn(async () => {}),
            startLabelSyncRestore: ({ walletId }) => startLabelSyncRestoreTask({
                walletId,
                run: async () => { throw new Error('restore failed'); },
            }),
        });

        const imported = await handleWalletImport({ password: 'pw', mnemonic: 'abandon about' }, deps);
        await expect(waitForLabelSyncRestoreTask(imported.labelSyncToken)).resolves.toBeNull();
    });
});

describe('pre-host mnemonic import lands on the network the caller asked for', () => {
    // Demo mode asks for mainnet. Without `activeNetwork` the import flow
    // infers the network from the first chain id, so the field must reach it.
    it('forwards activeNetwork to the import flow', async () => {
        const importMnemonic = vi.fn(async () => ({ format: 'bip39', wallet: { id: 'w1', name: 'Demo Wallet' } }));
        flowBehaviour.importMnemonic = importMnemonic;
        await handleWalletImport({
            password: 'pw',
            mnemonic: 'abandon about',
            origin: 'demo',
            activeChainIds: ['bitcoin-mainnet', 'bitcoin-regtest'],
            activeNetwork: 'mainnet',
        }, makeDeps());
        expect(importMnemonic).toHaveBeenCalledWith(expect.objectContaining({ activeNetwork: 'mainnet' }));
    });

    it('leaves activeNetwork unset when the caller names none', async () => {
        const importMnemonic = vi.fn(async () => ({ format: 'bip39', wallet: { id: 'w1', name: 'Imported Wallet' } }));
        flowBehaviour.importMnemonic = importMnemonic;
        await handleWalletImport({ password: 'pw', mnemonic: 'abandon about' }, makeDeps());
        expect(importMnemonic.mock.calls[0][0].activeNetwork).toBeUndefined();
    });
});
