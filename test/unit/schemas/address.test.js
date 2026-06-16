// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/address — createAddress + validateAddress.

import { describe, it, expect } from 'vitest';
import {
    createAddress,
    validateAddress,
    CURRENT_VERSION,
} from '../../../packages/core/src/schemas/address.js';

const BASE_INPUT = {
    accountId: 'acct-1',
    chain: 'BTC',
    network: 'mainnet',
    source: 'hd',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    publicKey: '02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc',
};

describe('createAddress', () => {
    it('creates a well-formed address', () => {
        const a = createAddress(BASE_INPUT);
        expect(a.schemaVersion).toBe(CURRENT_VERSION);
        expect(typeof a.id).toBe('string');
        expect(a.accountId).toBe('acct-1');
        expect(a.chain).toBe('BTC');
        expect(a.network).toBe('mainnet');
        expect(a.source).toBe('hd');
        expect(a.addressType).toBe('p2wpkh');
        expect(a.derivationPath).toBe("m/84'/0'/0'/0/0");
        expect(a.address).toBe('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
        expect(a.publicKey).toBe('02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc');
        expect(a.label).toBe('');
        expect(a.pinned).toBe(false);
        expect(a.hidden).toBe(false);
        expect(a.signerId).toBeNull();
        expect(typeof a.createdAt).toBe('string');
    });

    it('allows null accountId (imported WIF / watch-only)', () => {
        const a = createAddress({ ...BASE_INPUT, accountId: null, source: 'watch-only', derivationPath: null });
        expect(a.accountId).toBeNull();
        expect(a.derivationPath).toBeNull();
    });

    it('defaults label to empty string', () => {
        const a = createAddress(BASE_INPUT);
        expect(a.label).toBe('');
    });

    it('uses provided label', () => {
        const a = createAddress({ ...BASE_INPUT, label: 'Savings' });
        expect(a.label).toBe('Savings');
    });

    it('defaults pinned to false', () => {
        const a = createAddress(BASE_INPUT);
        expect(a.pinned).toBe(false);
    });

    it('uses provided pinned=true', () => {
        const a = createAddress({ ...BASE_INPUT, pinned: true });
        expect(a.pinned).toBe(true);
    });

    it('defaults hidden to false', () => {
        const a = createAddress(BASE_INPUT);
        expect(a.hidden).toBe(false);
    });

    it('defaults signerId to null', () => {
        const a = createAddress(BASE_INPUT);
        expect(a.signerId).toBeNull();
    });

    it('uses provided signerId', () => {
        const a = createAddress({ ...BASE_INPUT, signerId: 'signer-xyz' });
        expect(a.signerId).toBe('signer-xyz');
    });

    it('passes validation immediately after creation', () => {
        const r = validateAddress(createAddress(BASE_INPUT));
        expect(r.ok).toBe(true);
    });
});

describe('validateAddress', () => {
    it('accepts a valid record', () => {
        const r = validateAddress(createAddress(BASE_INPUT));
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
        expect(validateAddress(null).ok).toBe(false);
        expect(validateAddress('x').ok).toBe(false);
        expect(validateAddress(42).ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const a = createAddress(BASE_INPUT);
        const r = validateAddress({ ...a, schemaVersion: 1 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects empty id', () => {
        const a = createAddress(BASE_INPUT);
        expect(validateAddress({ ...a, id: '' }).ok).toBe(false);
    });

    it('rejects empty string accountId (must be null or non-empty)', () => {
        const a = createAddress(BASE_INPUT);
        const r = validateAddress({ ...a, accountId: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('accountId'))).toBe(true);
    });

    it('accepts null accountId', () => {
        const a = createAddress({ ...BASE_INPUT, accountId: null, source: 'watch-only', derivationPath: null });
        const r = validateAddress(a);
        expect(r.ok).toBe(true);
    });

    it('rejects empty chain', () => {
        const a = createAddress(BASE_INPUT);
        const r = validateAddress({ ...a, chain: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('chain'))).toBe(true);
    });

    it('rejects invalid network', () => {
        const a = createAddress(BASE_INPUT);
        const r = validateAddress({ ...a, network: 'devnet' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('network'))).toBe(true);
    });

    it('accepts all valid networks', () => {
        for (const network of ['mainnet', 'testnet', 'regtest']) {
            const a = createAddress({ ...BASE_INPUT, network });
            expect(validateAddress(a).ok).toBe(true);
        }
    });

    it('rejects invalid source', () => {
        const a = createAddress(BASE_INPUT);
        const r = validateAddress({ ...a, source: 'unknown' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('source'))).toBe(true);
    });

    it('accepts all valid sources', () => {
        for (const source of ['hd', 'imported-wif', 'watch-only', 'trezor', 'ledger']) {
            const a = createAddress({ ...BASE_INPUT, source });
            expect(validateAddress(a).ok).toBe(true);
        }
    });

    it('rejects empty addressType', () => {
        const a = createAddress(BASE_INPUT);
        expect(validateAddress({ ...a, addressType: '' }).ok).toBe(false);
    });

    it('rejects empty string derivationPath (must be null or non-empty)', () => {
        const a = createAddress(BASE_INPUT);
        const r = validateAddress({ ...a, derivationPath: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('derivationPath'))).toBe(true);
    });

    it('accepts null derivationPath', () => {
        const a = createAddress({ ...BASE_INPUT, accountId: null, source: 'watch-only', derivationPath: null });
        expect(validateAddress(a).ok).toBe(true);
    });

    it('rejects empty address field', () => {
        const a = createAddress(BASE_INPUT);
        expect(validateAddress({ ...a, address: '' }).ok).toBe(false);
    });

    it('rejects empty publicKey', () => {
        const a = createAddress(BASE_INPUT);
        expect(validateAddress({ ...a, publicKey: '' }).ok).toBe(false);
    });

    it('rejects non-boolean pinned', () => {
        const a = createAddress(BASE_INPUT);
        const r = validateAddress({ ...a, pinned: 1 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('pinned'))).toBe(true);
    });

    it('rejects non-boolean hidden', () => {
        const a = createAddress(BASE_INPUT);
        const r = validateAddress({ ...a, hidden: 'yes' });
        expect(r.ok).toBe(false);
    });

    it('rejects empty string signerId', () => {
        const a = createAddress(BASE_INPUT);
        const r = validateAddress({ ...a, signerId: '' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('signerId'))).toBe(true);
    });

    it('accepts null signerId', () => {
        const a = createAddress(BASE_INPUT);
        expect(validateAddress({ ...a, signerId: null }).ok).toBe(true);
    });

    it('accepts non-empty signerId', () => {
        const a = createAddress(BASE_INPUT);
        expect(validateAddress({ ...a, signerId: 'signer-1' }).ok).toBe(true);
    });

    it('rejects invalid createdAt', () => {
        const a = createAddress(BASE_INPUT);
        const r = validateAddress({ ...a, createdAt: 'bad-date' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('createdAt'))).toBe(true);
    });

    it('rejects non-string label', () => {
        const a = createAddress(BASE_INPUT);
        const r = validateAddress({ ...a, label: 42 });
        expect(r.ok).toBe(false);
    });
});
