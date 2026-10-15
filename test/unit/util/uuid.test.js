// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the UUIDv4 helper that polyfills `crypto.randomUUID`
// for non-secure-context (plain HTTP) execution.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from '../../../packages/core/src/util/uuid.js';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => { vi.unstubAllGlobals(); });

describe('util/uuid', () => {
    describe('randomUUID', () => {
        it('returns a valid v4 string under the native path', () => {
            vi.stubGlobal('crypto', {
                randomUUID: () => '123e4567-e89b-42d3-a456-426614174000',
            });
            const id = randomUUID();
            expect(id).toMatch(UUID_V4_RE);
        });

        it('produces unique values across many calls', () => {
            let sequence = 0;
            vi.stubGlobal('crypto', {
                randomUUID: () => {
                    sequence += 1;
                    return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
                },
            });
            const seen = new Set();
            for (let i = 0; i < 256; i += 1) seen.add(randomUUID());
            expect(seen.size).toBe(256);
            for (const id of seen) expect(id).toMatch(UUID_V4_RE);
        });

        it('falls back to getRandomValues when crypto.randomUUID is unavailable', () => {
            const fakeCrypto = {
                getRandomValues: (bytes) => {
                    bytes.set(Array.from({ length: bytes.length }, (_, index) => index));
                    return bytes;
                },
                // randomUUID intentionally absent
            };
            vi.stubGlobal('crypto', fakeCrypto);
            const id = randomUUID();
            expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
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
