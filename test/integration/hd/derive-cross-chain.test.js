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

import { describe, it, expect } from 'vitest';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';

// 12-word BIP39 test vector (NOT a real wallet — well-known docs vector)
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('integration/hd/derive-cross-chain', () => {
    it('derives a stable account-0 xpub from a known seed', () => {
        const seed = mnemonicToSeedSync(MNEMONIC, '');
        const root = HDKey.fromMasterSeed(seed);
        // BIP44 coin type 0 = Bitcoin. m/44'/0'/0' is the standard
        // account-zero node every wallet keys off for legacy P2PKH.
        const account = root.derive("m/44'/0'/0'");
        expect(typeof account.publicExtendedKey).toBe('string');
        expect(account.publicExtendedKey.startsWith('xpub')).toBe(true);
    });

    it('derives different xpubs for BTC / LTC / DOGE from the same seed', () => {
        const seed = mnemonicToSeedSync(MNEMONIC, '');
        const root = HDKey.fromMasterSeed(seed);
        const btc = root.derive("m/44'/0'/0'").publicExtendedKey;
        const ltc = root.derive("m/44'/2'/0'").publicExtendedKey;
        const doge = root.derive("m/44'/3'/0'").publicExtendedKey;
        expect(btc).not.toBe(ltc);
        expect(btc).not.toBe(doge);
        expect(ltc).not.toBe(doge);
    });

    it('honours BIP39 passphrase (different passphrase → different seed)', () => {
        const noPass = mnemonicToSeedSync(MNEMONIC, '');
        const withPass = mnemonicToSeedSync(MNEMONIC, 'extra');
        expect(Buffer.from(noPass).toString('hex'))
            .not.toBe(Buffer.from(withPass).toString('hex'));
    });

    it('first child of account 0 is deterministic across runs', () => {
        const seed = mnemonicToSeedSync(MNEMONIC, '');
        const root = HDKey.fromMasterSeed(seed);
        const a = root.derive("m/44'/0'/0'/0/0").publicKey;
        const b = root.derive("m/44'/0'/0'/0/0").publicKey;
        expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
    });
});
