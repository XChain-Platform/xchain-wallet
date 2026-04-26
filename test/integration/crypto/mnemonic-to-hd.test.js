// Integration: BIP39 mnemonic → seed → HD root → child paths.
// Pins the chain every onboarding flow runs.

import { describe, it, expect } from 'vitest';
import {
    bip39MnemonicToSeedSync,
    generateBip39Mnemonic,
    isValidBip39Mnemonic,
} from '../../../packages/core/src/crypto/mnemonic.js';
import { hdKeyFromSeed, derive } from '../../../packages/core/src/crypto/hd.js';

describe('integration/crypto/mnemonic-to-hd', () => {
    it('generated mnemonic → HD root → BTC account-0 derivation', () => {
        const m = generateBip39Mnemonic(128);
        expect(isValidBip39Mnemonic(m)).toBe(true);
        const seed = bip39MnemonicToSeedSync(m);
        const root = hdKeyFromSeed(seed);
        const acct = derive(root, "m/44'/0'/0'");
        // derive() returns DerivedKey { privateKey, publicKey, ... }
        expect(acct.publicKey).toBeInstanceOf(Uint8Array);
        expect(acct.publicKey.length).toBe(33);
        expect(typeof acct.publicKeyHex).toBe('string');
    });

    it('passphrase changes the resulting HD root', () => {
        const m = generateBip39Mnemonic(128);
        const seedA = bip39MnemonicToSeedSync(m, '');
        const seedB = bip39MnemonicToSeedSync(m, 'extra');
        const xpubA = hdKeyFromSeed(seedA).publicExtendedKey;
        const xpubB = hdKeyFromSeed(seedB).publicExtendedKey;
        expect(xpubA).not.toBe(xpubB);
    });

    it('same mnemonic + same passphrase → identical full derivation tree', () => {
        const m = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
        const a = derive(hdKeyFromSeed(bip39MnemonicToSeedSync(m)), "m/44'/0'/0'/0/0").publicKey;
        const b = derive(hdKeyFromSeed(bip39MnemonicToSeedSync(m)), "m/44'/0'/0'/0/0").publicKey;
        expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
    });
});
