// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the wallet's KDF primitive (Argon2id via @noble/hashes).
// Argon2id is intentionally slow — these tests use the floor parameters
// to keep total test time reasonable.

import { describe, it, expect } from 'vitest';
import {
    deriveMasterKey,
    makeFreshKdfParams,
    calibrateKdfParams,
    bytesToBase64,
    base64ToBytes,
    KDF_KEY_LENGTH,
    KDF_MIN_MEMORY_KIB,
    KDF_MIN_ITERATIONS,
    KDF_DEFAULT_PARALLELISM,
} from '../../../packages/core/src/crypto/kdf.js';

const PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==', // 16 zero bytes, base64
    iterations: KDF_MIN_ITERATIONS,
    memory: KDF_MIN_MEMORY_KIB,
    parallelism: KDF_DEFAULT_PARALLELISM,
};

describe('crypto/kdf', () => {
    describe('deriveMasterKey', () => {
        it('returns a Uint8Array of the configured key length', () => {
            const key = deriveMasterKey('correct horse battery staple', PARAMS);
            expect(key).toBeInstanceOf(Uint8Array);
            expect(key.length).toBe(KDF_KEY_LENGTH);
        });

        it('is deterministic for the same password + params', () => {
            const a = deriveMasterKey('correct horse battery staple', PARAMS);
            const b = deriveMasterKey('correct horse battery staple', PARAMS);
            expect(a).toEqual(b);
        });

        it('produces different keys for different passwords (same salt)', () => {
            const a = deriveMasterKey('one', PARAMS);
            const b = deriveMasterKey('two', PARAMS);
            expect(a).not.toEqual(b);
        });

        it('produces different keys for different salts (same password)', () => {
            const otherParams = { ...PARAMS, salt: 'BBBBBBBBBBBBBBBBBBBBBA==' };
            const a = deriveMasterKey('same-password', PARAMS);
            const b = deriveMasterKey('same-password', otherParams);
            expect(a).not.toEqual(b);
        });

        it('rejects an unsupported algorithm', () => {
            const bad = { ...PARAMS, algorithm: 'pbkdf2' };
            expect(() => deriveMasterKey('p', bad)).toThrow(/algorithm/);
        });

        it('rejects a salt shorter than the floor (< 8 bytes)', () => {
            const tiny = { ...PARAMS, salt: 'AA==' }; // 1 byte base64
            expect(() => deriveMasterKey('p', tiny)).toThrow();
        });
    });

    describe('makeFreshKdfParams', () => {
        it('returns floor params with a 16-byte random salt by default', () => {
            const p = makeFreshKdfParams();
            expect(p.algorithm).toBe('argon2id');
            expect(p.iterations).toBe(KDF_MIN_ITERATIONS);
            expect(p.memory).toBe(KDF_MIN_MEMORY_KIB);
            expect(p.parallelism).toBe(KDF_DEFAULT_PARALLELISM);
            expect(base64ToBytes(p.salt).length).toBe(16);
        });

        it('produces a fresh random salt on each call', () => {
            expect(makeFreshKdfParams().salt).not.toBe(makeFreshKdfParams().salt);
        });

        it('honours iterations / memory / parallelism overrides', () => {
            const p = makeFreshKdfParams({ iterations: 9, memory: 131072, parallelism: 4 });
            expect(p.iterations).toBe(9);
            expect(p.memory).toBe(131072);
            expect(p.parallelism).toBe(4);
        });

        it('the fresh params are accepted by deriveMasterKey', () => {
            const p = makeFreshKdfParams();
            const key = deriveMasterKey('pw', p);
            expect(key.length).toBe(KDF_KEY_LENGTH);
        });
    });

    describe('calibrateKdfParams', () => {
        // Use tiny memory + targetMs:0 so the very first probe satisfies the
        // target and the loop breaks after a single (cheap) argon2id call.
        const FAST = { targetMs: 0, memory: 8, minIterations: KDF_MIN_ITERATIONS };

        it('returns argon2id params at the minimum iterations when the target is trivially met', () => {
            const p = calibrateKdfParams(FAST);
            expect(p.algorithm).toBe('argon2id');
            expect(p.iterations).toBe(KDF_MIN_ITERATIONS);
            expect(p.memory).toBe(8);
            expect(p.parallelism).toBe(KDF_DEFAULT_PARALLELISM);
            expect(base64ToBytes(p.salt).length).toBe(16);
        });

        it('defaults parallelism and minIterations when not supplied', () => {
            const p = calibrateKdfParams({ targetMs: 0, memory: 8 });
            expect(p.parallelism).toBe(KDF_DEFAULT_PARALLELISM);
            expect(p.iterations).toBe(KDF_MIN_ITERATIONS);
        });

        it('caps iterations at maxIterations when the target is never reached', () => {
            // targetMs huge + tiny memory → never hits target → the loop exhausts
            // and returns exactly maxIterations (the last value actually probed),
            // not maxIterations + 1.
            const p = calibrateKdfParams({
                targetMs: 1e9, memory: 8, minIterations: 1, maxIterations: 2,
            });
            expect(p.iterations).toBe(2);
        });
    });

    describe('base64 helpers', () => {
        it('round-trips arbitrary bytes through bytesToBase64 → base64ToBytes', () => {
            const bytes = new Uint8Array([0, 1, 2, 127, 128, 200, 255]);
            const round = base64ToBytes(bytesToBase64(bytes));
            expect(Array.from(round)).toEqual(Array.from(bytes));
        });

        it('encodes empty input to an empty string', () => {
            expect(bytesToBase64(new Uint8Array(0))).toBe('');
        });
    });
});
