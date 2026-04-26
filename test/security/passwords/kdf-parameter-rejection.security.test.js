// Security: KDF must reject non-Argon2id algorithms and salts below
// the floor, so a downgrade attack via a tampered wallet record can't
// trick the wallet into deriving a fast / weak key.

import { describe, it, expect } from 'vitest';
import { deriveMasterKey } from '../../../packages/core/src/crypto/kdf.js';

const BASE = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};

describe('security/passwords/kdf-parameter-rejection', () => {
    it('rejects PBKDF2 (downgrade attempt)', () => {
        expect(() => deriveMasterKey('p', { ...BASE, algorithm: 'pbkdf2' })).toThrow();
    });

    it('rejects scrypt (downgrade attempt)', () => {
        expect(() => deriveMasterKey('p', { ...BASE, algorithm: 'scrypt' })).toThrow();
    });

    it('rejects an unknown algorithm string', () => {
        expect(() => deriveMasterKey('p', { ...BASE, algorithm: 'turbo-md5' })).toThrow();
    });

    it('rejects an empty / 1-byte salt', () => {
        expect(() => deriveMasterKey('p', { ...BASE, salt: '' })).toThrow();
        expect(() => deriveMasterKey('p', { ...BASE, salt: 'AA==' })).toThrow();
    });
});
