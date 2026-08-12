// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Interop vector: does a Counterwallet-format import reproduce the
// addresses a REAL Counterwallet server shows for the same phrase?
//
// This is the test whose absence let ship. Everything else about
// the legacy lane was self-consistent - the wallet imported the phrase,
// stamped the record `counterwallet-legacy`, derived addresses, and
// round-tripped them - while deriving BIP84 addresses the user's own
// wallet had never displayed. Only a comparison against ground truth
// from outside this codebase can catch that, so the vector below is
// pinned rather than computed.
//
// Ground truth captured 2026-07-26 from a Counterparty Counterwallet
// server (operator-supplied). It also settles the encoding question the
// implementation cannot answer by inspection: Counterwallet feeds BIP32
// the RAW 16 seed bytes. The other candidate - the 32-char hex read as
// ASCII - produces a different wallet entirely, and a wrong choice there
// is invisible except against a vector like this one.

import { describe, it, expect } from 'vitest';
import { HDKey } from '@scure/bip32';
import {
    counterwalletMnemonicToSeedBytes,
    counterwalletMnemonicToSeedHex,
    counterwalletDerivationPath,
    COUNTERWALLET_DEFAULT_ADDRESS_TYPE,
} from '../../../packages/core/src/crypto/counterwallet.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';

// A real Counterwallet wallet. Kept here as a derivation fixture only.
const VECTOR = {
    mnemonic: 'explode gaze wolf admit nice charm except three any guitar into color',
    seedHex: '9b55c1fc6d4e847cee15c6962537570b',
    // Counterwallet derives ONE chain and picks the address TYPE per
    // address, so legacy and segwit share a single index space: what the
    // server UI labels "first legacy" and "first segwit" are indexes 0
    // and 1 of the same branch.
    addresses: [
        { index: 0, path: "m/0'/0/0", p2pkh: '13Mhb9posbsWvRd1WaCHMqmc49JdKh2fVp' },
        { index: 1, path: "m/0'/0/1", p2wpkh: 'bc1qfl0qlf7rlvxhnpzg9dkq4zvzq4fp8l2a7vjvvv' },
    ],
};

/** Minimal p2pkh/p2wpkh encoders, so the vector does not depend on the SDK. */
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { base58check, bech32 } from '@scure/base';

const hash160 = (b) => ripemd160(sha256(b));
const b58c = base58check(sha256);

function p2pkhAddress(pubkey) {
    return b58c.encode(new Uint8Array([0x00, ...hash160(pubkey)]));
}
function p2wpkhAddress(pubkey) {
    const words = bech32.toWords(hash160(pubkey));
    return bech32.encode('bc', [0, ...words]);
}

describe('crypto/counterwallet interop vector', () => {
    it('decodes the mnemonic to the expected 16-byte seed', () => {
        expect(counterwalletMnemonicToSeedHex(VECTOR.mnemonic)).toBe(VECTOR.seedHex);
        expect(counterwalletMnemonicToSeedBytes(VECTOR.mnemonic)).toHaveLength(16);
    });

    it('reproduces the real wallet addresses from the raw-byte seed', () => {
        const root = HDKey.fromMasterSeed(counterwalletMnemonicToSeedBytes(VECTOR.mnemonic));
        for (const want of VECTOR.addresses) {
            const path = counterwalletDerivationPath(0, want.index);
            expect(path).toBe(want.path);
            const pubkey = root.derive(path).publicKey;
            if (want.p2pkh) expect(p2pkhAddress(pubkey)).toBe(want.p2pkh);
            if (want.p2wpkh) expect(p2wpkhAddress(pubkey)).toBe(want.p2wpkh);
        }
    });

    it('does NOT match when the seed is the hex string read as ASCII', () => {
        // The encoding that was ruled out. If this ever starts passing,
        // the seed decoder changed meaning underneath the vector above.
        const root = HDKey.fromMasterSeed(
            new TextEncoder().encode(counterwalletMnemonicToSeedHex(VECTOR.mnemonic)),
        );
        const pubkey = root.derive("m/0'/0/0").publicKey;
        expect(p2pkhAddress(pubkey)).not.toBe(VECTOR.addresses[0].p2pkh);
    });

    it('does NOT match at the BIP84 path - the pre-fix behavior', () => {
        // itself: the legacy seed fed into the chain descriptor's
        // modern template. Kept as a test so the regression is named.
        const root = HDKey.fromMasterSeed(counterwalletMnemonicToSeedBytes(VECTOR.mnemonic));
        const pubkey = root.derive("m/84'/0'/0'/0/0").publicKey;
        expect(p2wpkhAddress(pubkey)).not.toBe(VECTOR.addresses[1].p2wpkh);
    });

    describe('ChainRegistry.derivationPathFor', () => {
        const registry = new ChainRegistry();

        it('returns the legacy path for a counterwallet-legacy wallet', () => {
            const path = registry.derivationPathFor(
                'bitcoin-mainnet', 'p2pkh', 0, 0, 0, { format: 'counterwallet-legacy' },
            );
            expect(path).toBe("m/0'/0/0");
        });

        it('ignores the address type: one index space for every type', () => {
            const legacy = registry.derivationPathFor(
                'bitcoin-mainnet', 'p2pkh', 0, 0, 1, { format: 'counterwallet-legacy' },
            );
            const segwit = registry.derivationPathFor(
                'bitcoin-mainnet', 'p2wpkh', 0, 0, 1, { format: 'counterwallet-legacy' },
            );
            expect(legacy).toBe("m/0'/0/1");
            expect(segwit).toBe(legacy);
        });

        it('honours the change branch', () => {
            expect(registry.derivationPathFor(
                'bitcoin-mainnet', 'p2pkh', 0, 1, 3, { format: 'counterwallet-legacy' },
            )).toBe("m/0'/1/3");
        });

        it('refuses a second account rather than aliasing account 0', () => {
            expect(() => registry.derivationPathFor(
                'bitcoin-mainnet', 'p2pkh', 1, 0, 0, { format: 'counterwallet-legacy' },
            )).toThrow(/single account/);
        });

        it('leaves BIP39 wallets on the descriptor template', () => {
            expect(registry.derivationPathFor('bitcoin-mainnet', 'p2wpkh', 0, 0, 0))
                .toBe("m/84'/0'/0'/0/0");
            expect(registry.derivationPathFor(
                'bitcoin-mainnet', 'p2wpkh', 0, 0, 0, { format: 'bip39' },
            )).toBe("m/84'/0'/0'/0/0");
        });
    });

    it('defaults a legacy wallet to the address type Counterwallet showed first', () => {
        expect(COUNTERWALLET_DEFAULT_ADDRESS_TYPE).toBe('p2pkh');
    });
});
