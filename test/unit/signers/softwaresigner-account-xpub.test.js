// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

//  / §20.5: the watcher <-> signer pairing lane reads a wallet's
// account-level public material through the Signer interface.
// `getAccountXpub` is the optional half of that (software signers have it;
// hardware signers do not, and `collectPairingKeys` feature-detects it),
// so this pins the contract that matters: it unlocks-gated, it agrees with
// `getPublicKey` on the same node, and it never emits an xprv.

import { describe, it, expect } from 'vitest';
import { mnemonicToSeedSync } from '@scure/bip39';
import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';
import { hdKeyFromSeed, derive } from '../../../packages/core/src/crypto/hd.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED = mnemonicToSeedSync(MNEMONIC);
const ACCOUNT_PATH = "m/84'/0'/0'";

function makeSigner() {
    const signer = new SoftwareSigner({
        id: 'sw-1',
        displayName: 'Test',
        chainRegistry: { get: () => ({}) },
        walletEncryption: {},
        sdkRegistry: { get: () => ({ wallet: {} }) },
    });
    return signer;
}

function unlocked() {
    const signer = makeSigner();
    signer._acceptUnlockedState({
        mnemonicBytes: new Uint8Array(0),
        seed: SEED,
        importedWifs: new Map(),
    });
    return signer;
}

describe('SoftwareSigner.getAccountXpub ', () => {
    it('returns the account-level xpub for the unlocked seed', async () => {
        const xpub = await unlocked().getAccountXpub({ path: ACCOUNT_PATH });
        expect(xpub.startsWith('xpub')).toBe(true);
        expect(xpub).not.toMatch(/xprv/);
    });

    it('matches direct derivation from the same seed', async () => {
        const xpub = await unlocked().getAccountXpub({ path: ACCOUNT_PATH });
        const expected = hdKeyFromSeed(SEED).derive(ACCOUNT_PATH).publicExtendedKey;
        expect(xpub).toBe(expected);
    });

    it('describes the same node getPublicKey reports', async () => {
        const signer = unlocked();
        const pub = await signer.getPublicKey({ path: ACCOUNT_PATH });
        const direct = derive(hdKeyFromSeed(SEED), ACCOUNT_PATH);
        expect(pub.publicKey).toBe(direct.publicKeyHex);
    });

    it('refuses a path that is not a derivation path', async () => {
        await expect(unlocked().getAccountXpub({ path: 'not-a-path' })).rejects.toThrow(/invalid path/);
    });

    it('refuses to answer while locked', async () => {
        await expect(makeSigner().getAccountXpub({ path: ACCOUNT_PATH })).rejects.toThrow();
    });
});
