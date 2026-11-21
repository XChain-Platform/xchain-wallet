// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/wallet - createWallet + validateWallet.

import { describe, it, expect } from 'vitest';
import {
    createWallet,
    validateWallet,
    WALLET_ORIGINS,
    WALLET_FORMATS,
    WALLET_MODES,
    CURRENT_VERSION,
    walletModeOf,
    usesBip39Passphrase,
} from '../../../packages/core/src/schemas/wallet.js';

const BASE_KDF = {
    algorithm: 'argon2id',
    salt: 'c2FsdHZhbHVl',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};

const BASE_INPUT = {
    name: 'My Wallet',
    origin: 'created',
    format: 'bip39',
    passphraseEnabled: false,
    encryptedSeed: 'c2VlZGRhdGE=',
    kdfParams: BASE_KDF,
};

const HARDWARE_INPUT = {
    name: 'My Trezor',
    origin: 'connected-hardware',
    format: 'hardware',
    passphraseEnabled: false,
    encryptedSeed: '',
    kdfParams: BASE_KDF,
    walletMode: 'full',
};

describe('hardware wallet format (seedless, keys on the device)', () => {
    const errorsFor = (patch) => validateWallet({ ...createWallet(HARDWARE_INPUT), ...patch }).errors;

    it('lists the format and origin', () => {
        expect(WALLET_FORMATS).toContain('hardware');
        expect(WALLET_ORIGINS).toContain('connected-hardware');
    });

    it('accepts a seedless record with no keys, no passphrase, full mode', () => {
        const r = validateWallet(createWallet(HARDWARE_INPUT));
        expect(r.errors).toEqual([]);
        expect(r.ok).toBe(true);
    });

    it('refuses any seed, imported key or passphrase', () => {
        expect(errorsFor({ encryptedSeed: 'c2VlZGRhdGE=' }).some((e) => e.startsWith('encryptedSeed'))).toBe(true);
        expect(errorsFor({
            importedKeys: [{ addressId: 'a1', encryptedWif: 'c2VlZA==', importedAt: new Date().toISOString() }],
        }).some((e) => e.startsWith('importedKeys'))).toBe(true);
        expect(errorsFor({ passphraseEnabled: true }).some((e) => e.startsWith('passphraseEnabled'))).toBe(true);
        expect(errorsFor({ encryptedPassphrase: 'Y2lwaGVy' }).some((e) => e.startsWith('encryptedPassphrase')))
            .toBe(true);
    });

    it('refuses the two-phone modes', () => {
        expect(errorsFor({ walletMode: 'watcher' }).some((e) => e.startsWith('walletMode'))).toBe(true);
        expect(errorsFor({ walletMode: 'signer' }).some((e) => e.startsWith('walletMode'))).toBe(true);
    });

    it('keeps the origin and the format together', () => {
        expect(errorsFor({ origin: 'created' }).some((e) => e.startsWith('origin'))).toBe(true);
        const seeded = createWallet({ ...BASE_INPUT, origin: 'connected-hardware' });
        expect(validateWallet(seeded).errors.some((e) => e.startsWith('format'))).toBe(true);
    });
});

describe('WALLET_ORIGINS', () => {
    it('contains expected origins', () => {
        expect(WALLET_ORIGINS).toContain('created');
        expect(WALLET_ORIGINS).toContain('imported-mnemonic');
        expect(WALLET_ORIGINS).toContain('imported-wif');
        expect(WALLET_ORIGINS).toContain('imported-xchain-backup');
        expect(WALLET_ORIGINS).toContain('imported-freewallet');
    });
});

describe('WALLET_FORMATS', () => {
    it('contains bip39, counterwallet-legacy, wif-only', () => {
        expect(WALLET_FORMATS).toContain('bip39');
        expect(WALLET_FORMATS).toContain('counterwallet-legacy');
        expect(WALLET_FORMATS).toContain('wif-only');
    });
});

describe('walletMode (§20, per wallet)', () => {
    it('defaults a new wallet to Normal and keeps a chosen mode', () => {
        expect(createWallet(BASE_INPUT).walletMode).toBe('full');
        for (const walletMode of WALLET_MODES) {
            const w = createWallet({ ...BASE_INPUT, walletMode });
            expect(w.walletMode).toBe(walletMode);
            expect(validateWallet(w).ok).toBe(true);
        }
    });

    it('refuses a record with no mode or an unknown one', () => {
        const { walletMode: _omit, ...without } = createWallet(BASE_INPUT);
        expect(validateWallet(without).ok).toBe(false);
        expect(validateWallet({ ...createWallet(BASE_INPUT), walletMode: 'observer' }).ok).toBe(false);
    });

    it('walletModeOf reads anything unknown as Normal', () => {
        expect(walletModeOf({ walletMode: 'signer' })).toBe('signer');
        expect(walletModeOf({ walletMode: 'nope' })).toBe('full');
        expect(walletModeOf(null)).toBe('full');
    });
});

describe('usesBip39Passphrase', () => {
    it('treats the flag as meaningful only for BIP39 seeds', () => {
        expect(usesBip39Passphrase({ format: 'bip39', passphraseEnabled: true })).toBe(true);
        expect(usesBip39Passphrase({ format: 'bip39', passphraseEnabled: false })).toBe(false);
        expect(usesBip39Passphrase({ format: 'counterwallet-legacy', passphraseEnabled: true })).toBe(false);
        expect(usesBip39Passphrase({ format: 'wif-only', passphraseEnabled: true })).toBe(false);
        expect(usesBip39Passphrase({ passphraseEnabled: true })).toBe(true);
    });
});

describe('createWallet', () => {
    it('creates a well-formed wallet', () => {
        const w = createWallet(BASE_INPUT);
        expect(w.schemaVersion).toBe(CURRENT_VERSION);
        expect(typeof w.id).toBe('string');
        expect(w.name).toBe('My Wallet');
        expect(typeof w.createdAt).toBe('string');
        expect(w.origin).toBe('created');
        expect(w.format).toBe('bip39');
        expect(w.passphraseEnabled).toBe(false);
        expect(w.encryptionAlgorithm).toBe('aes-256-gcm');
        expect(w.encryptedSeed).toBe('c2VlZGRhdGE=');
        expect(w.kdfParams).toEqual(BASE_KDF);
        expect(w.importedKeys).toEqual([]);
        expect(w.multisigs).toEqual([]);
    });

    it('generates unique ids', () => {
        const w1 = createWallet(BASE_INPUT);
        const w2 = createWallet(BASE_INPUT);
        expect(w1.id).not.toBe(w2.id);
    });

    it('passes validation immediately after creation', () => {
        const r = validateWallet(createWallet(BASE_INPUT));
        expect(r.ok).toBe(true);
    });

    it('always sets encryptionAlgorithm to aes-256-gcm', () => {
        const w = createWallet(BASE_INPUT);
        expect(w.encryptionAlgorithm).toBe('aes-256-gcm');
    });
});

describe('validateWallet', () => {
    it('accepts a valid record', () => {
        const r = validateWallet(createWallet(BASE_INPUT));
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('accepts only string-valued active address overrides', () => {
        const wallet = createWallet(BASE_INPUT);
        expect(validateWallet({
            ...wallet, activeAddressByChainId: { 'bitcoin-regtest': 'addr-1' },
        }).ok).toBe(true);
        expect(validateWallet({
            ...wallet, activeAddressByChainId: { 'bitcoin-regtest': null },
        }).ok).toBe(false);
        expect(validateWallet({ ...wallet, activeAddressByChainId: [] }).ok).toBe(false);
    });

    it('rejects non-object input', () => {
        expect(validateWallet(null).ok).toBe(false);
        expect(validateWallet('x').ok).toBe(false);
        expect(validateWallet(42).ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, schemaVersion: 1 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects empty name', () => {
        const w = createWallet(BASE_INPUT);
        expect(validateWallet({ ...w, name: '' }).ok).toBe(false);
    });

    it('rejects invalid createdAt', () => {
        const w = createWallet(BASE_INPUT);
        expect(validateWallet({ ...w, createdAt: 'bad' }).ok).toBe(false);
    });

    it('rejects invalid origin', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, origin: 'unknown-origin' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('origin'))).toBe(true);
    });

    it('accepts all valid origins', () => {
        for (const origin of WALLET_ORIGINS) {
            // A connected-hardware origin only travels with the seedless format.
            const w = origin === 'connected-hardware'
                ? createWallet({ ...HARDWARE_INPUT })
                : createWallet({ ...BASE_INPUT, origin });
            expect(validateWallet(w).ok).toBe(true);
        }
    });

    it('rejects invalid format', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, format: 'unknown' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('format'))).toBe(true);
    });

    it('rejects non-boolean passphraseEnabled', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, passphraseEnabled: 'yes' });
        expect(r.ok).toBe(false);
    });

    it('rejects wrong encryptionAlgorithm', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, encryptionAlgorithm: 'aes-128-gcm' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('encryptionAlgorithm'))).toBe(true);
    });

    it('rejects empty encryptedSeed for non-wif-only wallet', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, encryptedSeed: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('encryptedSeed'))).toBe(true);
    });

    it('allows empty encryptedSeed for wif-only format', () => {
        // wif-only needs at least 1 importedKey too
        const w = createWallet({ ...BASE_INPUT, format: 'wif-only', encryptedSeed: '', passphraseEnabled: false });
        const withKey = {
            ...w,
            importedKeys: [{ addressId: 'addr-1', encryptedWif: 'c2VlZA==', importedAt: new Date().toISOString() }],
        };
        const r = validateWallet(withKey);
        expect(r.ok).toBe(true);
    });

    it('rejects wif-only wallet with no importedKeys', () => {
        const w = createWallet({ ...BASE_INPUT, format: 'wif-only', encryptedSeed: '', passphraseEnabled: false });
        const r = validateWallet({ ...w, importedKeys: [] });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('wif-only wallet must have at least one entry'))).toBe(true);
    });

    it('rejects wif-only wallet with passphraseEnabled=true', () => {
        const w = createWallet({ ...BASE_INPUT, format: 'wif-only', encryptedSeed: '', passphraseEnabled: true });
        const withKey = {
            ...w,
            importedKeys: [{ addressId: 'addr-1', encryptedWif: 'c2VlZA==', importedAt: new Date().toISOString() }],
        };
        const r = validateWallet(withKey);
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('passphraseEnabled'))).toBe(true);
    });

    it('rejects malformed kdfParams: wrong algorithm', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, kdfParams: { ...BASE_KDF, algorithm: 'pbkdf2' } });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('kdfParams'))).toBe(true);
    });

    it('rejects malformed kdfParams: non-integer iterations', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, kdfParams: { ...BASE_KDF, iterations: 1.5 } });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed kdfParams: negative memory', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, kdfParams: { ...BASE_KDF, memory: -1 } });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed kdfParams: empty salt', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, kdfParams: { ...BASE_KDF, salt: '' } });
        expect(r.ok).toBe(false);
    });

    it('rejects non-array importedKeys', () => {
        const w = createWallet(BASE_INPUT);
        expect(validateWallet({ ...w, importedKeys: 'bad' }).ok).toBe(false);
    });

    it('rejects malformed importedKey: empty addressId', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({
            ...w,
            importedKeys: [{ addressId: '', encryptedWif: 'abc', importedAt: new Date().toISOString() }],
        });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed importedKey: invalid importedAt', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({
            ...w,
            importedKeys: [{ addressId: 'addr-1', encryptedWif: 'abc', importedAt: 'bad' }],
        });
        expect(r.ok).toBe(false);
    });

    it('rejects non-array multisigs', () => {
        const w = createWallet(BASE_INPUT);
        expect(validateWallet({ ...w, multisigs: 'bad' }).ok).toBe(false);
    });

    it('accepts empty multisigs array', () => {
        const w = createWallet(BASE_INPUT);
        expect(validateWallet({ ...w, multisigs: [] }).ok).toBe(true);
    });

    it('rejects duplicate multisig ids', () => {
        const NOW = new Date().toISOString();
        const PK_A = '02' + 'a'.repeat(64);
        const PK_B = '03' + 'b'.repeat(64);
        const cosigner = (pubkey) => ({
            name: 'X',
            pubkey,
            fingerprint: 'aabb0011',
            origin: 'local',
            localSignerId: null,
            xpub: null,
            derivationPath: "m/48'/0'/0'/2'",
            addedAt: NOW,
        });
        const multisig = {
            schemaVersion: 2,
            id: 'same-id',
            scheme: 'p2wsh-multisig',
            threshold: 2,
            cosigners: [cosigner(PK_A), cosigner(PK_B)],
            scriptTemplate: `multi:2:${PK_A}:${PK_B}`,
        };
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, multisigs: [multisig, multisig] });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('duplicate id'))).toBe(true);
    });
});

describe('validateWallet: encryptedPassphrase (§15.6)', () => {
    const withPassphrase = () =>
        createWallet({ ...BASE_INPUT, format: 'bip39', passphraseEnabled: true });
    const errorFor = (record) =>
        validateWallet(record).errors.filter((e) => e.startsWith('encryptedPassphrase'));

    it('createWallet seeds the field null', () => {
        expect(createWallet(BASE_INPUT).encryptedPassphrase).toBeNull();
    });

    it('a fresh record is at schema version 4', () => {
        expect(createWallet(BASE_INPUT).schemaVersion).toBe(4);
        expect(CURRENT_VERSION).toBe(4);
    });

    it('accepts null on a bip39 passphrase wallet (the legacy, awaiting-capture state)', () => {
        expect(errorFor({ ...withPassphrase(), encryptedPassphrase: null })).toEqual([]);
    });

    it('accepts a non-empty string on a bip39 passphrase wallet', () => {
        expect(errorFor({ ...withPassphrase(), encryptedPassphrase: 'Y2lwaGVy' })).toEqual([]);
    });

    it('rejects an empty string on a bip39 passphrase wallet', () => {
        expect(errorFor({ ...withPassphrase(), encryptedPassphrase: '' })).toHaveLength(1);
    });

    it('rejects a non-null value when the wallet has no passphrase', () => {
        const w = createWallet({ ...BASE_INPUT, passphraseEnabled: false });
        expect(errorFor({ ...w, encryptedPassphrase: 'Y2lwaGVy' })).toHaveLength(1);
    });

    it('rejects a non-null value on counterwallet-legacy even with passphraseEnabled', () => {
        // The passphraseEnabled rule above guards wif-only only; the format
        // half of this rule is what covers counterwallet-legacy.
        const w = createWallet({
            ...BASE_INPUT,
            format: 'counterwallet-legacy',
            passphraseEnabled: true,
        });
        expect(errorFor({ ...w, encryptedPassphrase: 'Y2lwaGVy' })).toHaveLength(1);
    });

    it('rejects undefined (an unmigrated v2 record) in every state', () => {
        const w = createWallet(BASE_INPUT);
        delete w.encryptedPassphrase;
        expect(errorFor(w)).toHaveLength(1);
    });

    it('rejects a v2 record outright', () => {
        const r = validateWallet({ ...createWallet(BASE_INPUT), schemaVersion: 2 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.startsWith('schemaVersion'))).toBe(true);
    });
});
