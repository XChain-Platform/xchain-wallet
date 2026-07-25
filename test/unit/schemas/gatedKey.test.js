// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// GatedKey schema (PC-25): the vault row carrying a gated pack key.
// The shape checks are load-bearing: keyHex/keyHash are fed straight
// into AES + the BATCH wire string at publish time.

import { describe, it, expect } from 'vitest';
import {
    createGatedKey,
    validateGatedKey,
    gatedKeyId,
    gatedKeyMetadata,
} from '../../../packages/core/src/schemas/gatedKey.js';

const INPUT = {
    walletId: 'w1',
    chainId: 'btc-regtest',
    gateTicker: 'mytoken',
    keyHash: 'A'.repeat(64),
    keyHex: 'ab'.repeat(32),
    source: 'published',
};

describe('schemas/gatedKey', () => {
    it('creates a valid record with canonical id, uppercased tick, lowercased hash', () => {
        const r = createGatedKey(INPUT);
        expect(validateGatedKey(r).ok).toBe(true);
        expect(r.gateTicker).toBe('MYTOKEN');
        expect(r.keyHash).toBe('a'.repeat(64));
        expect(r.id).toBe(`w1::btc-regtest::MYTOKEN::${'a'.repeat(64)}`);
        expect(r.id).toBe(gatedKeyId(INPUT));
    });

    it('rejects malformed keyHash / keyHex shapes', () => {
        const r = createGatedKey(INPUT);
        expect(validateGatedKey({ ...r, keyHash: 'zz'.repeat(32) }).ok).toBe(false);
        expect(validateGatedKey({ ...r, keyHash: 'a'.repeat(63) }).ok).toBe(false);
        expect(validateGatedKey({ ...r, keyHex: 'ab'.repeat(31) }).ok).toBe(false);
        expect(validateGatedKey({ ...r, keyHex: '' }).ok).toBe(false);
    });

    it('rejects unknown sources and missing fields', () => {
        const r = createGatedKey(INPUT);
        expect(validateGatedKey({ ...r, source: 'guessed' }).ok).toBe(false);
        expect(validateGatedKey({ ...r, walletId: '' }).ok).toBe(false);
        expect(validateGatedKey({ ...r, gateTicker: '' }).ok).toBe(false);
    });

    it('gatedKeyMetadata strips the secret and nothing else', () => {
        const r = createGatedKey(INPUT);
        const meta = gatedKeyMetadata(r);
        expect(meta.keyHex).toBeUndefined();
        expect(meta).toMatchObject({
            id: r.id,
            walletId: 'w1',
            chainId: 'btc-regtest',
            gateTicker: 'MYTOKEN',
            keyHash: 'a'.repeat(64),
            source: 'published',
        });
    });
});
