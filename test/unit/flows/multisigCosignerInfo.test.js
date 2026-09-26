// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// §22.2 cosigner fields: Create multisig requires a BIP32 master
// fingerprint for every cosigner, the local one included, and the other
// party needs this wallet's xpub, pubkey and path to add it. These pin the
// derivation against the BIP39 "abandon ... about" test vector, whose master
// fingerprint is the well-known 73c5da0a, and the refusals that keep a wrong
// fingerprint from being auto-filled.

import { describe, it, expect } from 'vitest';
import { mnemonicToSeedSync } from '@scure/bip39';
import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';
import { hdKeyFromSeed, masterFingerprint } from '../../../packages/core/src/crypto/hd.js';
import {
    deriveCosignerKeys,
    getMultisigCosignerInfo,
} from '../../../packages/core/src/flows/multisigCosignerInfo.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED = mnemonicToSeedSync(MNEMONIC);
const PATH = "m/84'/1'/0'/0/0";
const ACCOUNT_PATH = "m/84'/1'/0'";
const PUBKEY = hdKeyFromSeed(SEED).derive(PATH).publicKey;
const PUBKEY_HEX = Buffer.from(PUBKEY).toString('hex');

function unlockedSigner() {
    const signer = new SoftwareSigner({
        id: 'sw-1',
        displayName: 'Test',
        chainRegistry: { get: () => ({}) },
        walletEncryption: {},
        sdkRegistry: { get: () => ({ wallet: {} }) },
    });
    signer._acceptUnlockedState({
        mnemonicBytes: new Uint8Array(0),
        seed: SEED,
        importedWifs: new Map(),
    });
    return signer;
}

function fakeVault({ address, account }) {
    return {
        addresses: { get: async (id) => (address && address.id === id ? address : null) },
        accounts: { get: async (id) => (account && account.id === id ? account : null) },
    };
}

const HD_ADDRESS = {
    id: 'addr-1',
    accountId: 'acct-1',
    source: 'hd',
    derivationPath: PATH,
    publicKey: PUBKEY_HEX,
    address: 'tb1qexample',
};
const ACCOUNT = { id: 'acct-1', walletId: 'w-1' };

describe('master fingerprint', () => {
    it('matches the BIP39 test vector for the unlocked seed', async () => {
        expect(await unlockedSigner().getMasterFingerprint()).toBe('73c5da0a');
        expect(masterFingerprint(hdKeyFromSeed(SEED))).toBe('73c5da0a');
    });

    it('refuses a non-master node', () => {
        expect(() => masterFingerprint(hdKeyFromSeed(SEED).derive(ACCOUNT_PATH))).toThrow(/master/);
    });
});

describe('deriveCosignerKeys', () => {
    it('returns fingerprint, account xpub, path and pubkey for the path', async () => {
        const info = await deriveCosignerKeys({ signer: unlockedSigner(), derivationPath: PATH, expectedPubkey: PUBKEY_HEX });
        expect(info).toEqual({
            fingerprint: '73c5da0a',
            derivationPath: PATH,
            accountPath: ACCOUNT_PATH,
            xpub: hdKeyFromSeed(SEED).derive(ACCOUNT_PATH).publicExtendedKey,
            pubkey: PUBKEY_HEX,
        });
        expect(info.xpub).not.toMatch(/prv/);
    });

    it('refuses when the signer holds a different seed than the address', async () => {
        await expect(deriveCosignerKeys({
            signer: unlockedSigner(),
            derivationPath: PATH,
            expectedPubkey: '02'.padEnd(66, 'a'),
        })).rejects.toThrow(/not held by the unlocked seed/);
    });

    it('refuses a signer that cannot report its fingerprint', async () => {
        const hw = { getPublicKey: async () => ({ publicKey: PUBKEY_HEX }) };
        await expect(deriveCosignerKeys({ signer: hw, derivationPath: PATH }))
            .rejects.toThrow(/cannot report its master fingerprint/);
    });

    it('refuses a path that is not HD', async () => {
        await expect(deriveCosignerKeys({ signer: unlockedSigner(), derivationPath: null }))
            .rejects.toThrow(/no HD derivation path/);
    });
});

describe('getMultisigCosignerInfo', () => {
    it('resolves the address record and reads its cosigner fields', async () => {
        const info = await getMultisigCosignerInfo({
            vault: fakeVault({ address: HD_ADDRESS, account: ACCOUNT }),
            walletId: 'w-1',
            addressId: 'addr-1',
            signer: unlockedSigner(),
        });
        expect(info.fingerprint).toBe('73c5da0a');
        expect(info.addressId).toBe('addr-1');
        expect(info.address).toBe('tb1qexample');
    });

    it('refuses an address that belongs to another wallet', async () => {
        await expect(getMultisigCosignerInfo({
            vault: fakeVault({ address: HD_ADDRESS, account: { ...ACCOUNT, walletId: 'w-other' } }),
            walletId: 'w-1',
            addressId: 'addr-1',
            signer: unlockedSigner(),
        })).rejects.toThrow(/does not belong to this wallet/);
    });

    it('refuses an imported key', async () => {
        await expect(getMultisigCosignerInfo({
            vault: fakeVault({ address: { ...HD_ADDRESS, source: 'imported-wif', derivationPath: null }, account: ACCOUNT }),
            walletId: 'w-1',
            addressId: 'addr-1',
            signer: unlockedSigner(),
        })).rejects.toThrow(/imported or watch-only/);
    });
});
