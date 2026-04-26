// Unit tests for the UUIDv4 helper that polyfills `crypto.randomUUID`
// for non-secure-context (plain HTTP) execution.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from '../../../packages/core/src/util/uuid.js';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => { vi.unstubAllGlobals(); });

describe('util/uuid', () => {
    describe('randomUUID', () => {
        it('returns a valid v4 string under the native path', () => {
            const id = randomUUID();
            expect(id).toMatch(UUID_V4_RE);
        });

        it('produces unique values across many calls', () => {
            const seen = new Set();
            for (let i = 0; i < 256; i += 1) seen.add(randomUUID());
            expect(seen.size).toBe(256);
        });

        it('falls back to getRandomValues when crypto.randomUUID is unavailable', () => {
            const fakeCrypto = {
                getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
                // randomUUID intentionally absent
            };
            vi.stubGlobal('crypto', fakeCrypto);
            const id = randomUUID();
            expect(id).toMatch(UUID_V4_RE);
        });

        it('fallback path version + variant bits are correct', () => {
            const fakeCrypto = {
                getRandomValues: (bytes) => {
                    // Fill with all-1s; the helper must clamp the version
                    // (digit 13 = '4') and variant (digit 17 ∈ 8/9/a/b)
                    // bits regardless.
                    for (let i = 0; i < bytes.length; i += 1) bytes[i] = 0xff;
                    return bytes;
                },
            };
            vi.stubGlobal('crypto', fakeCrypto);
            const id = randomUUID();
            expect(id[14]).toBe('4');
            expect(['8', '9', 'a', 'b']).toContain(id[19]);
        });
    });
});
