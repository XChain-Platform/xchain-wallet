// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// signMultisigLocally signs for exactly one local cosigner, so a config
// with two of this wallet's own keys could be funded and never reach its
// threshold from inside the wallet. createMultisigConfig refuses it.

import { describe, it, expect, vi } from 'vitest';
import { HDKey } from '@scure/bip32';
import { createMultisigConfig } from '../../../packages/core/src/flows/createMultisigConfig.js';

const TESTNET_VERSIONS = { private: 0x04358394, public: 0x043587cf };
const MAINNET_VERSIONS = { private: 0x0488ade4, public: 0x0488b21e };
const PK_A = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

function externalKey(versions = TESTNET_VERSIONS) {
    const account = HDKey.fromMasterSeed(new Uint8Array(32).fill(7), versions)
        .derive("m/48'/1'/0'");
    const child = account.derive('m/0/0');
    return {
        xpub: account.publicExtendedKey,
        pubkey: Array.from(child.publicKey, (byte) => byte.toString(16).padStart(2, '0')).join(''),
        path: "m/48'/1'/0'/0/0",
    };
}

const EXTERNAL = externalKey();

function fakeVault() {
    const wallet = { id: 'w-1', name: 'Main', multisigs: [] };
    return {
        wallets: {
            get: vi.fn(async (id) => (id === 'w-1' ? wallet : null)),
            put: vi.fn(async () => {}),
        },
    };
}

function local(name, pubkey, path) {
    return { name, pubkey, fingerprint: '73c5da0a', origin: 'local', localSignerId: 'wallet:w-1', derivationPath: path };
}

function opts(cosigners, vault = fakeVault()) {
    return {
        vault,
        sdkRegistry: { get: () => null },
        chainId: 'bitcoin-testnet',
        walletId: 'w-1',
        scheme: 'p2wsh-multisig',
        threshold: 2,
        cosigners,
    };
}

describe('createMultisigConfig local cosigners', () => {
    it('refuses a second local cosigner before touching the vault', async () => {
        const vault = fakeVault();
        await expect(createMultisigConfig(opts([
            local('Mine 1', PK_A, "m/84'/1'/0'/0/0"),
            local('Mine 2', EXTERNAL.pubkey, "m/84'/1'/0'/0/1"),
        ], vault))).rejects.toThrow(/only one cosigner can be this wallet's own key \(found 2\)/);
        expect(vault.wallets.put).not.toHaveBeenCalled();
    });

    it('accepts one local cosigner beside an external one', async () => {
        const vault = fakeVault();
        const { config } = await createMultisigConfig(opts([
            local('Mine', PK_A, "m/84'/1'/0'/0/0"),
            { name: 'Bob', pubkey: EXTERNAL.pubkey, fingerprint: '11223344', origin: 'external-xpub', xpub: EXTERNAL.xpub, derivationPath: EXTERNAL.path },
        ], vault));
        expect(config.cosigners.filter((c) => c.origin === 'local')).toHaveLength(1);
        expect(vault.wallets.put).toHaveBeenCalledTimes(1);
    });
});

describe('createMultisigConfig key validation', () => {
    it('refuses a duplicate key and names the duplicate cosigner', async () => {
        const duplicate = { name: 'Bob', pubkey: PK_A.toUpperCase(), fingerprint: '11223344', origin: 'external-hardware', derivationPath: "m/48'/1'/0'/0/0" };

        await expect(createMultisigConfig(opts([
            local('Mine', PK_A, "m/84'/1'/0'/0/0"),
            duplicate,
        ]))).rejects.toThrow('Cosigner 2 duplicates an earlier cosigner public key');
    });

    it('refuses a malformed compressed key and names its cosigner', async () => {
        await expect(createMultisigConfig(opts([
            local('Mine', PK_A, "m/84'/1'/0'/0/0"),
            { name: 'Bob', pubkey: '03'.padEnd(66, 'b'), fingerprint: '11223344', origin: 'external-hardware', derivationPath: "m/48'/1'/0'/0/0" },
        ]))).rejects.toThrow(/Cosigner 2 public key must be a 33-byte compressed secp256k1 key/);
    });

    it('refuses an xpub for the wrong network and names its cosigner', async () => {
        const mainnet = externalKey(MAINNET_VERSIONS);

        await expect(createMultisigConfig(opts([
            local('Mine', PK_A, "m/84'/1'/0'/0/0"),
            { name: 'Bob', pubkey: mainnet.pubkey, fingerprint: '11223344', origin: 'external-xpub', xpub: mainnet.xpub, derivationPath: mainnet.path },
        ]))).rejects.toThrow('Cosigner 2: xpub is for Bitcoin mainnet, not this test network.');
    });

    it.each([0, 3])('refuses threshold %s outside the key count', async (threshold) => {
        const request = opts([
            local('Mine', PK_A, "m/84'/1'/0'/0/0"),
            { name: 'Bob', pubkey: EXTERNAL.pubkey, fingerprint: '11223344', origin: 'external-xpub', xpub: EXTERNAL.xpub, derivationPath: EXTERNAL.path },
        ]);
        request.threshold = threshold;

        await expect(createMultisigConfig(request)).rejects.toThrow(/threshold/);
    });
});
