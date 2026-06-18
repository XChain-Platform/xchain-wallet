// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: crypto secure-context fallout.
//
// Past incidents pinned here:
//
//   [P0] 2026-04-25: `crypto.subtle.importKey` threw on plain HTTP
//        because Web Crypto's SubtleCrypto is gated on a secure
//        context. The wallet's KDF / AEAD / RANDOM-UUID paths reached
//        for SubtleCrypto, breaking onboarding under any LAN-hosted
//        HTTP origin. Fix: switched AEAD to `@noble/ciphers/aes`,
//        SHA-256 to `@noble/hashes/sha2`, and randomUUID to a
//        `crypto.getRandomValues`-based polyfill.
//
//   [P0] 2026-04-25: `crypto.randomUUID is not a function` thrown
//        from every schema factory that minted an entity id (12 schema
//        files affected) for the same reason. Fix: shared
//        `packages/core/src/util/uuid.js` helper used by every schema.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { encrypt, decrypt } from '../../packages/core/src/crypto/aead.js';
import { randomUUID } from '../../packages/core/src/util/uuid.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('regression/crypto-secure-context', () => {
    it('[REGRESSION P0] AEAD round-trips when crypto.subtle is undefined', async () => {
        // Simulate a non-secure context: no subtle, but getRandomValues
        // is still available (matches plain HTTP browsers).
        vi.stubGlobal('crypto', {
            getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
        });
        const key = new Uint8Array(32).fill(1);
        const ct = await encrypt(key, new TextEncoder().encode('hi'));
        const pt = await decrypt(key, ct);
        expect(new TextDecoder().decode(pt)).toBe('hi');
    });

    it('[REGRESSION P0] randomUUID returns a v4 string when crypto.randomUUID is undefined', () => {
        vi.stubGlobal('crypto', {
            getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
        });
        const id = randomUUID();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
});
