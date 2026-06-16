// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/wallet — createWallet + validateWallet.

import { describe, it, expect } from 'vitest';
import {
    createWallet,
    validateWallet,
    WALLET_ORIGINS,
    WALLET_FORMATS,
    CURRENT_VERSION,
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
            const w = createWallet({ ...BASE_INPUT, origin });
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

    it('rejects malformed kdfParams — wrong algorithm', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, kdfParams: { ...BASE_KDF, algorithm: 'pbkdf2' } });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('kdfParams'))).toBe(true);
    });

    it('rejects malformed kdfParams — non-integer iterations', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, kdfParams: { ...BASE_KDF, iterations: 1.5 } });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed kdfParams — negative memory', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, kdfParams: { ...BASE_KDF, memory: -1 } });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed kdfParams — empty salt', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({ ...w, kdfParams: { ...BASE_KDF, salt: '' } });
        expect(r.ok).toBe(false);
    });

    it('rejects non-array importedKeys', () => {
        const w = createWallet(BASE_INPUT);
        expect(validateWallet({ ...w, importedKeys: 'bad' }).ok).toBe(false);
    });

    it('rejects malformed importedKey — empty addressId', () => {
        const w = createWallet(BASE_INPUT);
        const r = validateWallet({
            ...w,
            importedKeys: [{ addressId: '', encryptedWif: 'abc', importedAt: new Date().toISOString() }],
        });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed importedKey — invalid importedAt', () => {
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
