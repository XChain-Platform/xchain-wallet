// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Integration: from a single BIP39 seed, the wallet derives the
// expected base xpub for each supported chain family. Pins the
// derivation paths the rest of the wallet keys off, so any future
// change to BIP44 coin types or path templates fails this test
// before it ships into a vault on disk.
//
// The account paths are built FROM the chain descriptors (via
// ChainRegistry.derivationPathFor), never from literals baked into
// this file, and each derived xpub is asserted against a pinned
// expected value. Both legs matter: sourcing paths from the registry
// means a descriptor coin-type edit changes what we derive, and the
// pinned xpubs mean that change fails loudly here instead of shipping
// a vault whose addresses the backend cannot see.

import { describe, it, expect } from 'vitest';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

// 12-word BIP39 test vector (NOT a real wallet; this is a well-known docs vector)
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Per chain family: the descriptor-sourced p2pkh account-0 node and the xpub
// this exact docs vector must produce there. SLIP-44 mainnet slots (0'/2'/3')
// are the wallet's parity anchor on EVERY network, so a "fix" of any
// descriptor to the generic testnet 1' slot breaks both assertions below.
const FAMILY_VECTORS = [
    {
        chainId: 'bitcoin-mainnet',
        accountPath: "m/44'/0'/0'",
        xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
    },
    {
        chainId: 'litecoin-mainnet',
        accountPath: "m/44'/2'/0'",
        xpub: 'xpub6BnJJjq783EdyBeQPA9P9ao9DTS3fUqyKG5NJDcrCiwwxEkesGoHN94LZRGE7rz1jgcvmmp8j55BNx573KFq1WBwKiemzkdfNKffKx6Mvku',
    },
    {
        chainId: 'dogecoin-mainnet',
        accountPath: "m/44'/3'/0'",
        xpub: 'xpub6Bxse8AT19u9HExKtP1EAudLi9CpLxPpxDvanL2fFtM7UFE2Q7TTWRg4bnMnmT4KcyN6GQkSgZmPWDtyUywSii3MDpMNfXSTuzH7gvZywLU',
    },
];

// The account node is the descriptor's p2pkh template with the C/I leaf
// stripped: derivationPathFor(chain, 'p2pkh', 0, 0, 0) === `${account}/0/0`.
function descriptorAccountPath(chainId) {
    const full = defaultRegistry().derivationPathFor(chainId, 'p2pkh', 0, 0, 0);
    expect(full, `${chainId} p2pkh path`).toBeTruthy();
    expect(full.endsWith('/0/0')).toBe(true);
    return full.slice(0, -'/0/0'.length);
}

describe('integration/hd/derive-cross-chain', () => {
    const seed = mnemonicToSeedSync(MNEMONIC, '');
    const root = HDKey.fromMasterSeed(seed);

    for (const { chainId, accountPath, xpub } of FAMILY_VECTORS) {
        it(`${chainId}: descriptor sources the ${accountPath} account node and the docs vector pins its xpub`, () => {
            const fromDescriptor = descriptorAccountPath(chainId);
            // Leg 1: the descriptor still anchors the SLIP-44 mainnet slot.
            expect(fromDescriptor).toBe(accountPath);
            // Leg 2: deriving AT THE DESCRIPTOR PATH yields the pinned xpub.
            const account = root.derive(fromDescriptor);
            expect(account.publicExtendedKey).toBe(xpub);
        });
    }

    it("testnet/regtest descriptors stay on the mainnet coin-type slot (no generic 1')", () => {
        for (const family of ['bitcoin', 'litecoin', 'dogecoin']) {
            const mainnet = descriptorAccountPath(`${family}-mainnet`);
            for (const network of ['testnet', 'regtest']) {
                const id = `${family}-${network}`;
                const path = defaultRegistry().derivationPathFor(id, 'p2pkh', 0, 0, 0);
                if (path === null) continue; // network not bundled for this family
                expect(descriptorAccountPath(id), id).toBe(mainnet);
            }
        }
    });

    it('derives different xpubs for BTC / LTC / DOGE from the same seed', () => {
        const xpubs = FAMILY_VECTORS.map(({ chainId }) =>
            root.derive(descriptorAccountPath(chainId)).publicExtendedKey);
        expect(new Set(xpubs).size).toBe(xpubs.length);
    });

    it('honours BIP39 passphrase (different passphrase → different seed)', () => {
        const noPass = mnemonicToSeedSync(MNEMONIC, '');
        const withPass = mnemonicToSeedSync(MNEMONIC, 'extra');
        expect(Buffer.from(noPass).toString('hex'))
            .not.toBe(Buffer.from(withPass).toString('hex'));
    });

    it('first child of account 0 is deterministic across runs', () => {
        const path = defaultRegistry().derivationPathFor('bitcoin-mainnet', 'p2pkh', 0, 0, 0);
        const a = root.derive(path).publicKey;
        const b = root.derive(path).publicKey;
        expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
    });
});
