// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A restore that replaces the Settings record carries custom chains and
// endpoint overrides the host's boot pass never saw. The boot pass latches on
// its first completed read, so the restore routes have to hydrate the running
// registry themselves, chains first and endpoint overrides second.
//
// Real vault, real backup envelope, real registries and the real host routes.

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { encryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import { makeFreshKdfParams, deriveMasterKey } from '../../../packages/core/src/crypto/kdf.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { exportBackupFile } from '../../../packages/core/src/flows/backupFile.js';
import { ChainRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import { SDKRegistry, joinEndpoint } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { createVaultKeyring } from '../../../packages/extension/src/background/vaultKeyring.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const DEVICE = 'device-unlock-password';
const SOURCE_WALLET = 'source-wallet-password';
const FILE = 'backup-file-password';
const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const OPERATOR_EXPLORER = 'http://10.0.0.9:18080';
const template = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');
const CUSTOM = { ...template, id: 'operator-regtest', displayName: 'Operator' };

async function flush(rounds = 200) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function backupFileContent({ withCustomChain }) {
    const kdfParams = makeFreshKdfParams({ iterations: 1, memory: 8 * 1024 });
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: deriveMasterKey(SOURCE_WALLET, kdfParams) });
    await vault.open();
    const sealed = await encryptWalletSeed({
        password: SOURCE_WALLET,
        seed: new TextEncoder().encode(MNEMONIC),
        kdfParams,
    });
    await vault.wallets.put({
        ...createWallet({
            name: 'Backed up',
            origin: 'created',
            format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: sealed.encryptedSeed,
            kdfParams: sealed.kdfParams,
        }),
        id: 'wallet-from-backup',
    });
    const settings = createDefaultSettings();
    if (withCustomChain) {
        settings.customChains = [CUSTOM];
        settings.sdkEndpoints = {
            [CUSTOM.id]: {
                explorerUrl: OPERATOR_EXPLORER,
                encoderUrl: joinEndpoint(CUSTOM.encoder),
                hubUrl: joinEndpoint(CUSTOM.hub),
                custom: true,
            },
        };
    }
    await vault.settings.put(settings);
    const { fileContent } = await exportBackupFile({
        vault,
        walletId: 'wallet-from-backup',
        password: FILE,
        kdfParams: makeFreshKdfParams({ iterations: 1, memory: 8 * 1024 }),
    });
    return fileContent;
}

async function openHost() {
    const kdfParams = makeFreshKdfParams({ iterations: 1, memory: 8 * 1024 });
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: deriveMasterKey(DEVICE, kdfParams) });
    await vault.open();
    await vault.settings.put(createDefaultSettings());
    const chainRegistry = new ChainRegistry();
    const sdkCalls = [];
    const sdkRegistry = new SDKRegistry({
        chainRegistry,
        sdkFactory: (opts) => { sdkCalls.push(opts); return { network: opts.network }; },
    });
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry,
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        vaultKeyring: createVaultKeyring({ metaBackend: { load: async () => ({ kdfParams }) } }),
    });
    // The boot pass completes against the pre-restore record and latches.
    expect((await host.handle({ type: 'settings.get', request: {} })).ok).toBe(true);
    await flush();
    expect(chainRegistry.has(CUSTOM.id)).toBe(false);
    return { host, chainRegistry, sdkRegistry, sdkCalls };
}

const restoreRequest = (extra) => ({
    password: FILE,
    walletPassword: SOURCE_WALLET,
    devicePassword: DEVICE,
    onConflict: 'overwrite',
    ...extra,
});

describe('a restore that replaces Settings re-hydrates the running host', () => {
    it('installs the restored custom chain and its endpoint through wallet.importBackup', async () => {
        const fileContent = await backupFileContent({ withCustomChain: true });
        const h = await openHost();

        const reply = await h.host.handle({ type: 'wallet.importBackup', request: restoreRequest({ fileContent }) });

        expect(reply.ok, JSON.stringify(reply.error ?? {})).toBe(true);
        expect(reply.result.writes.settings).toBe(true);
        expect(h.chainRegistry.get(CUSTOM.id)?.isUserAdded).toBe(true);
        h.sdkRegistry.get(CUSTOM.id);
        expect(h.sdkCalls.at(-1).explorerUrl).toBe(OPERATOR_EXPLORER);
    });

    it('does the same through wallet.importBackupPointer', async () => {
        const fileContent = await backupFileContent({ withCustomChain: true });
        const h = await openHost();
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => fileContent })));
        try {
            const reply = await h.host.handle({
                type: 'wallet.importBackupPointer',
                request: restoreRequest({ pointer: { location: 'https://example.invalid/backup.xchain-wallet' } }),
            });

            expect(reply.ok, JSON.stringify(reply.error ?? {})).toBe(true);
            expect(h.chainRegistry.has(CUSTOM.id)).toBe(true);
            h.sdkRegistry.get(CUSTOM.id);
            expect(h.sdkCalls.at(-1).explorerUrl).toBe(OPERATOR_EXPLORER);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('leaves the registry alone when the restore keeps the vault settings', async () => {
        const fileContent = await backupFileContent({ withCustomChain: true });
        const h = await openHost();

        const reply = await h.host.handle({
            type: 'wallet.importBackup',
            request: restoreRequest({ fileContent, onConflict: 'preserve', mode: 'add' }),
        });

        expect(reply.ok, JSON.stringify(reply.error ?? {})).toBe(true);
        expect(reply.result.writes.settings).toBe(false);
        expect(h.chainRegistry.has(CUSTOM.id)).toBe(false);
    });
});
