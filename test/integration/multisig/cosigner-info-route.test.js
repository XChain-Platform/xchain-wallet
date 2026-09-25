// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Integration: `multisig.cosignerInfo` on the background host every shell
// runs. It must answer from the unlocked session's pooled signer and refuse,
// with a reason the form can show, when no signer is pooled; it never takes
// a password.

import { describe, it, expect } from 'vitest';
import { mnemonicToSeedSync } from '@scure/bip39';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';
import { hdKeyFromSeed } from '../../../packages/core/src/crypto/hd.js';

const SEED = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const PATH = "m/84'/1'/0'/0/0";
const PUBKEY_HEX = Buffer.from(hdKeyFromSeed(SEED).derive(PATH).publicKey).toString('hex');

function pooledSigner() {
    const signer = new SoftwareSigner({
        id: 'sw-1',
        displayName: 'Test',
        chainRegistry: { get: () => ({}) },
        walletEncryption: {},
        sdkRegistry: { get: () => ({ wallet: {} }) },
    });
    signer._acceptUnlockedState({ mnemonicBytes: new Uint8Array(0), seed: SEED, importedWifs: new Map() });
    return signer;
}

function makeHost(signerPool) {
    const address = {
        id: 'addr-1', accountId: 'acct-1', source: 'hd', derivationPath: PATH,
        publicKey: PUBKEY_HEX, address: 'tb1qexample',
    };
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: {
            settings: { get: async () => ({}) },
            wallets: { list: async () => [{ id: 'w-1', name: 'Main' }] },
            addresses: { get: async (id) => (id === address.id ? address : null) },
            accounts: { get: async (id) => (id === 'acct-1' ? { id, walletId: 'w-1' } : null) },
        },
        chainRegistry: { get: () => null, list: () => [] },
        sdkRegistry: { for: () => ({}) },
        signerPool,
    });
}

describe('integration/multisig/cosigner-info-route', () => {
    it('returns the cosigner fields from the pooled signer', async () => {
        const signer = pooledSigner();
        const host = makeHost({ get: (id) => (id === 'w-1' ? signer : null) });
        const res = await host.handle({ type: 'multisig.cosignerInfo', request: { walletId: 'w-1', addressId: 'addr-1' } });

        expect(res.ok, JSON.stringify(res.error)).toBe(true);
        expect(res.result.fingerprint).toBe('73c5da0a');
        expect(res.result.pubkey).toBe(PUBKEY_HEX);
        expect(res.result.accountPath).toBe("m/84'/1'/0'");
        expect(res.result.xpub.startsWith('xpub')).toBe(true);
    });

    it('refuses with a reason when the wallet has no pooled signer', async () => {
        const host = makeHost({ get: () => null });
        const res = await host.handle({ type: 'multisig.cosignerInfo', request: { walletId: 'w-1', addressId: 'addr-1' } });

        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/not unlocked in this session/);
    });
});
