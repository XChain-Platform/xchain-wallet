// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A restore that replaces the whole Settings record must leave the running
// registry and its cached SDK clients matching the vault, not only add to
// them: a chain whose descriptor changed has to be rebuilt against the new
// endpoints, a chain the backup does not list has to leave, and the other
// realms are told to reconcile.
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
const template = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');
const BEFORE = { ...template, id: 'operator-regtest', displayName: 'Operator' };
const AFTER = {
    ...BEFORE,
    displayName: 'Operator relocated',
    explorer: { defaultUrl: 'http://10.0.0.77', defaultPort: 18080 },
};
const BUNDLED = BUNDLED_DESCRIPTORS.find((d) => d.id === 'litecoin-regtest');

async function flush(rounds = 200) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function backupFileContent(customChains, sdkEndpoints) {
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
    // `undefined` leaves the record exactly as a wallet that never added a
    // custom chain stores it: no list at all.
    if (customChains !== undefined) settings.customChains = customChains;
    if (sdkEndpoints !== undefined) settings.sdkEndpoints = sdkEndpoints;
    await vault.settings.put(settings);
    const { fileContent } = await exportBackupFile({
        vault,
        walletId: 'wallet-from-backup',
        password: FILE,
        kdfParams: makeFreshKdfParams({ iterations: 1, memory: 8 * 1024 }),
    });
    return fileContent;
}

/** A host whose vault already holds BEFORE and whose registry is seeded with it. */
async function openHostWithChain({ hookThrows = false } = {}) {
    const kdfParams = makeFreshKdfParams({ iterations: 1, memory: 8 * 1024 });
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: deriveMasterKey(DEVICE, kdfParams) });
    await vault.open();
    const settings = createDefaultSettings();
    settings.customChains = [BEFORE];
    await vault.settings.put(settings);
    const chainRegistry = new ChainRegistry();
    const sdkCalls = [];
    const sdkRegistry = new SDKRegistry({
        chainRegistry,
        rateLimiter: null,
        sdkFactory: (opts) => { sdkCalls.push(opts); return { network: opts.network, explorerUrl: opts.explorerUrl }; },
    });
    const published = [];
    const dropped = [];
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
        surfaceStateEvents: { publish: async (kind) => { published.push(kind); } },
        onSdkEndpointsChanged: async (ids) => {
            if (hookThrows) throw new Error('refresh failed');
            dropped.push(ids);
        },
    });
    expect((await host.handle({ type: 'settings.get', request: {} })).ok).toBe(true);
    await flush();
    expect(chainRegistry.has(BEFORE.id)).toBe(true);
    return { host, chainRegistry, sdkRegistry, sdkCalls, published, dropped };
}

const restore = (h, fileContent) => h.host.handle({
    type: 'wallet.importBackup',
    request: {
        password: FILE,
        walletPassword: SOURCE_WALLET,
        devicePassword: DEVICE,
        onConflict: 'overwrite',
        fileContent,
    },
});

describe('an overwrite restore reconciles the running registry with the vault', () => {
    it('rebuilds the client of a chain whose restored descriptor moved its endpoints', async () => {
        const fileContent = await backupFileContent([AFTER]);
        const h = await openHostWithChain();
        const stale = h.sdkRegistry.get(BEFORE.id);
        expect(stale.explorerUrl).toBe('http://localhost:18080');
        const callsBefore = h.sdkCalls.length;

        const reply = await restore(h, fileContent);

        expect(reply.ok, JSON.stringify(reply.error ?? {})).toBe(true);
        expect(h.chainRegistry.get(BEFORE.id).displayName).toBe('Operator relocated');
        const fresh = h.sdkRegistry.get(BEFORE.id);
        expect(fresh).not.toBe(stale);
        expect(h.sdkCalls.length).toBe(callsBefore + 1);
        expect(fresh.explorerUrl).toBe('http://10.0.0.77:18080');
        expect(h.published).toContain('custom-chains');
        expect(h.dropped).toEqual([[BEFORE.id]]);
    });

    it('removes a chain the backup does not list and drops its cached client', async () => {
        const fileContent = await backupFileContent([]);
        const h = await openHostWithChain();
        h.sdkRegistry.get(BEFORE.id);

        const reply = await restore(h, fileContent);

        expect(reply.ok, JSON.stringify(reply.error ?? {})).toBe(true);
        expect(h.chainRegistry.has(BEFORE.id)).toBe(false);
        expect(h.sdkRegistry.activeChainIds()).not.toContain(BEFORE.id);
        expect(h.published).toContain('custom-chains');
        expect(h.dropped).toEqual([[BEFORE.id]]);
    });

    it('removes the chain when the backup record carries no custom chain list at all', async () => {
        const fileContent = await backupFileContent(undefined);
        const h = await openHostWithChain();
        h.sdkRegistry.get(BEFORE.id);

        const reply = await restore(h, fileContent);

        expect(reply.ok, JSON.stringify(reply.error ?? {})).toBe(true);
        expect((await h.host.handle({ type: 'settings.get', request: {} })).result.customChains ?? []).toEqual([]);
        expect(h.chainRegistry.has(BEFORE.id)).toBe(false);
        expect(h.sdkRegistry.activeChainIds()).not.toContain(BEFORE.id);
    });

    it('stays quiet and keeps the client when the restored chains match the registry', async () => {
        const fileContent = await backupFileContent([BEFORE]);
        const h = await openHostWithChain();
        const live = h.sdkRegistry.get(BEFORE.id);

        const reply = await restore(h, fileContent);

        expect(reply.ok, JSON.stringify(reply.error ?? {})).toBe(true);
        expect(h.sdkRegistry.get(BEFORE.id)).toBe(live);
        expect(h.published).not.toContain('custom-chains');
        expect(h.dropped).toEqual([]);
    });

    it('reports a bundled client dropped by a restored endpoint override', async () => {
        const override = {
            explorerUrl: 'http://10.0.0.9:18080',
            encoderUrl: joinEndpoint(BUNDLED.encoder),
            hubUrl: joinEndpoint(BUNDLED.hub),
            custom: true,
        };
        const fileContent = await backupFileContent([BEFORE], { [BUNDLED.id]: override });
        const h = await openHostWithChain();
        h.sdkRegistry.get(BUNDLED.id);

        const reply = await restore(h, fileContent);

        expect(reply.ok, JSON.stringify(reply.error ?? {})).toBe(true);
        expect(h.dropped).toEqual([[BUNDLED.id]]);
    });

    it('keeps the completed restore when the socket refresh hook fails', async () => {
        const fileContent = await backupFileContent([AFTER]);
        const h = await openHostWithChain({ hookThrows: true });
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

        const reply = await restore(h, fileContent);

        expect(reply.ok, JSON.stringify(reply.error ?? {})).toBe(true);
        expect(logged).toHaveBeenCalledOnce();
        logged.mockRestore();
    });
});
