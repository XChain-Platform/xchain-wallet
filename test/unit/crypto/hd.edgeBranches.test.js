// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import {
    accountXpub,
    derive,
    masterFingerprint,
    zeroDerivedKey,
} from '../../../packages/core/src/crypto/hd.js';

describe('crypto/hd edge branches', () => {
    it('returns public-only derivations with an undefined private key', () => {
        const child = {
            publicKey: new Uint8Array([2, 3, 4]),
            privateKey: null,
            chainCode: new Uint8Array([5, 6]),
            fingerprint: new Uint8Array([0, 0, 0, 9]),
        };
        const root = { derive: vi.fn(() => child) };

        expect(derive(root, 'm/0')).toEqual({
            privateKey: undefined,
            publicKey: child.publicKey,
            chainCode: child.chainCode,
            publicKeyHex: '020304',
            fingerprint: '00000009',
            path: 'm/0',
        });
    });

    it.each([
        ['derive', (root) => derive(root, 'm/1')],
        ['accountXpub', (root) => accountXpub(root, 'm/1')],
    ])('%s rejects a child without a public key', (_label, invoke) => {
        const root = { derive: vi.fn(() => ({ publicKey: null })) };
        expect(() => invoke(root)).toThrow(/produced no public key for m\/1/);
    });

    it('returns an account extended public key', () => {
        const root = {
            derive: vi.fn(() => ({ publicKey: new Uint8Array([2]), publicExtendedKey: 'xpub-test' })),
        };
        expect(accountXpub(root, "m/84'/0'/0'")).toBe('xpub-test');
    });

    it.each([null, {}, { depth: 1, fingerprint: 1 }])(
        'rejects a non-master node when reading the master fingerprint',
        (root) => {
            expect(() => masterFingerprint(root)).toThrow(/needs the master/);
        },
    );

    it('renders numeric, byte-array, and other fingerprint representations', () => {
        expect(masterFingerprint({ depth: 0, fingerprint: 10 })).toBe('0000000a');
        expect(masterFingerprint({ depth: 0, fingerprint: new Uint8Array([1, 2, 3, 4]) }))
            .toBe('01020304');
        expect(masterFingerprint({ depth: 0, fingerprint: 'fingerprint' })).toBe('fingerprint');
    });

    it('zeroes whichever sensitive buffers are present', () => {
        const privateOnly = { privateKey: new Uint8Array([1, 2]) };
        const chainOnly = { chainCode: new Uint8Array([3, 4]) };
        zeroDerivedKey(privateOnly);
        zeroDerivedKey(chainOnly);
        expect(privateOnly.privateKey).toEqual(new Uint8Array(2));
        expect(chainOnly.chainCode).toEqual(new Uint8Array(2));
        expect(() => zeroDerivedKey({})).not.toThrow();
    });
});
