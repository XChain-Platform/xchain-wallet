// Boundary: AEAD primitive at the size + key-length edges.

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../../packages/core/src/crypto/aead.js';

const KEY = new Uint8Array(32).fill(1);

describe('boundary/crypto/aead', () => {
    describe('plaintext sizes', () => {
        it('round-trips a zero-byte plaintext', async () => {
            const ct = await encrypt(KEY, new Uint8Array());
            const pt = await decrypt(KEY, ct);
            expect(pt.length).toBe(0);
        });

        it('round-trips a 1-byte plaintext', async () => {
            const ct = await encrypt(KEY, new Uint8Array([42]));
            const pt = await decrypt(KEY, ct);
            expect(pt[0]).toBe(42);
        });

        it('round-trips a 1-MiB plaintext', async () => {
            const big = new Uint8Array(1 << 20);
            for (let i = 0; i < big.length; i += 1) big[i] = i & 0xff;
            const ct = await encrypt(KEY, big);
            const pt = await decrypt(KEY, ct);
            expect(pt.length).toBe(big.length);
            expect(pt[1024]).toBe(0);
        });
    });

    describe('AAD sizes', () => {
        it('binds a zero-byte AAD (treated as no AAD)', async () => {
            const ct = await encrypt(KEY, new Uint8Array([1]), new Uint8Array());
            const pt = await decrypt(KEY, ct, new Uint8Array());
            expect(pt[0]).toBe(1);
        });

        it('binds a 4 KiB AAD', async () => {
            const aad = new Uint8Array(4096).fill(7);
            const ct = await encrypt(KEY, new Uint8Array([1]), aad);
            const pt = await decrypt(KEY, ct, aad);
            expect(pt[0]).toBe(1);
        });
    });

    describe('key length', () => {
        for (const bad of [0, 16, 24, 31, 33, 64]) {
            it(`rejects a ${bad}-byte key`, async () => {
                await expect(
                    encrypt(new Uint8Array(bad), new Uint8Array([1])),
                ).rejects.toThrow();
            });
        }
    });

    describe('blob length', () => {
        it('rejects a blob shorter than IV + tag (28 bytes)', async () => {
            await expect(decrypt(KEY, new Uint8Array(27))).rejects.toThrow(/too short/);
        });

        it('accepts the smallest possible round-trip (empty plaintext = 28 bytes)', async () => {
            const ct = await encrypt(KEY, new Uint8Array());
            expect(ct.length).toBe(28);
        });
    });
});
