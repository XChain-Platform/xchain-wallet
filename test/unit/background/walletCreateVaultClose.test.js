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
} = await import('../../../packages/extension/src/background/walletCreate.js');

function makeDeps(over = {}) {
    let blob = null;
    return {
        storageBackend: {
            async load() { return blob; },
            async save(next) { blob = next; },
        },
        metaBackend: { load: async () => null, save: vi.fn(async () => {}) },
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
            await expect(lane.call(deps)).rejects.toThrow('disk full');
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
