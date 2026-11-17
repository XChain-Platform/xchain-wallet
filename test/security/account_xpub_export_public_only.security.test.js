// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Account Details' Extended public keys page reads `pairing.payload` with
// publicExport and no password (operator ruling 2026-11-15). The keys come
// from the unlocked session's software signer, and the reply that crosses to
// the UI must carry only account-level extended PUBLIC keys: no private
// extended key, no seed, no recovery words, no raw key material.

import { describe, expect, it } from 'vitest';
import { mnemonicToSeedSync } from '@scure/bip39';
import { createBackgroundHost } from '../../packages/extension/src/background/createBackgroundHost.js';
import { SoftwareSigner } from '../../packages/core/src/signers/SoftwareSigner.js';
import { ChainRegistry } from '../../packages/core/src/registry/index.js';

// The public BIP39 test vector phrase; it guards nothing.
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED = mnemonicToSeedSync(PHRASE);
const SEED_HEX = Buffer.from(SEED).toString('hex');
const PUBLIC_EXTENDED_KEY = /^(?:xpub|ypub|zpub|tpub|upub|vpub)[1-9A-HJ-NP-Za-km-z]{100,}$/;
const CHAINS = ['bitcoin-mainnet', 'bitcoin-testnet'];

function softwareSigner() {
    const signer = new SoftwareSigner({
        id: 'sw-1',
        displayName: 'Test',
        chainRegistry: { get: () => ({}) },
        walletEncryption: {},
        sdkRegistry: { get: () => ({ wallet: {} }) },
    });
    signer._acceptUnlockedState({ mnemonicBytes: new TextEncoder().encode(PHRASE), seed: SEED, importedWifs: new Map() });
    return signer;
}

function makeHost(signerPool, wallet = { id: 'w-1', name: 'Main', format: 'bip39', walletMode: 'full' }) {
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: {
            settings: { get: async () => ({}) },
            wallets: {
                list: async () => [wallet],
                get: async (id) => (id === wallet.id ? wallet : null),
                put: async () => {},
            },
        },
        chainRegistry: new ChainRegistry(),
        sdkRegistry: { for: () => ({}) },
        signerPool,
    });
}

function exportRequest(extra = {}) {
    return { type: 'pairing.payload', request: { walletId: 'w-1', accountIndex: 1, chainIds: CHAINS, publicExport: true, ...extra } };
}

describe('account extended public key export crosses only public keys', () => {
    it('answers from the unlocked session with no password and returns only xpub style strings', async () => {
        const signer = softwareSigner();
        const host = makeHost({ get: (id) => (id === 'w-1' ? signer : null) });

        const res = await host.handle(exportRequest());

        expect(res.ok, JSON.stringify(res.error)).toBe(true);
        const keys = res.result.payload.keys;
        expect(keys.length).toBeGreaterThan(0);
        for (const key of keys) {
            expect(Object.keys(key).sort()).toEqual(['addressType', 'chainId', 'path', 'xpub']);
            expect(key.xpub).toMatch(PUBLIC_EXTENDED_KEY);
            expect(key.path).toMatch(/^m\/\d+'\/\d+'\/1'$/);
        }
        expect(res.result.encoded).toBeNull();

        const wire = JSON.stringify(res);
        expect(wire).not.toMatch(/[xyztuv]prv/);
        expect(wire).not.toContain(SEED_HEX);
        expect(wire).not.toContain('abandon');
        expect(wire).not.toMatch(/publicKey|chainCode|privateKey|mnemonic|seed/i);
        // Only the extended public keys carry long base58 runs.
        const base58Runs = wire.match(/[1-9A-HJ-NP-Za-km-z]{60,}/g) || [];
        expect(base58Runs.every((run) => PUBLIC_EXTENDED_KEY.test(run))).toBe(true);
        // The pool owns the session signer: the export leaves it unlocked.
        expect(signer._unlocked).not.toBeNull();
    });

    it('refuses without keys when the session holds no signer and no password was typed', async () => {
        const host = makeHost({ get: () => null });

        const res = await host.handle(exportRequest());

        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/Unlock this wallet again/);
        expect(JSON.stringify(res)).not.toMatch(/[xyztuv]pub[1-9A-HJ-NP-Za-km-z]{20,}/);
    });

    it('never reads a device signer for the export', async () => {
        const device = { kind: 'trezor', getPublicKey: async () => { throw new Error('device read'); }, getAccountXpub: async () => 'xpub-device' };
        const host = makeHost({ get: () => device });

        const res = await host.handle(exportRequest());

        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/Unlock this wallet again/);
    });

    it('refuses a hardware wallet, whose keys stay on the device', async () => {
        const signer = softwareSigner();
        const host = makeHost(
            { get: () => signer },
            { id: 'w-1', name: 'My Trezor', format: 'hardware', walletMode: 'full' },
        );

        const res = await host.handle(exportRequest());

        expect(res.ok).toBe(false);
        expect(JSON.stringify(res)).not.toMatch(/[xyztuv]pub[1-9A-HJ-NP-Za-km-z]{20,}/);
    });

    it('ignores a device signerId on the export and still reads only the session software signer', async () => {
        const signer = softwareSigner();
        const host = makeHost({ get: (id) => (id === 'w-1' ? signer : null) });

        const res = await host.handle(exportRequest({ signerId: 'hw-1' }));

        expect(res.ok, JSON.stringify(res.error)).toBe(true);
        expect(res.result.payload.keys.every((key) => PUBLIC_EXTENDED_KEY.test(key.xpub))).toBe(true);
    });
});
