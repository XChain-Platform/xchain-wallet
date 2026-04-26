// Unit tests for the wallet's KDF primitive (Argon2id via @noble/hashes).
// Argon2id is intentionally slow — these tests use the floor parameters
// to keep total test time reasonable.

import { describe, it, expect } from 'vitest';
import {
    deriveMasterKey,
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
});
