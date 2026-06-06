// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Security: AEAD nonce/IV uniqueness across many encrypt() calls with
// the same key. Birthday-bound is 2^48 for 12-byte nonces; we sample
// 10K and assert no collisions, which is overkill for unit-test scale
// but catches the catastrophic case of a deterministic IV.

import { describe, it, expect } from 'vitest';
import { encrypt } from '../../../packages/core/src/crypto/aead.js';

const KEY = new Uint8Array(32).fill(1);

describe('security/crypto/aead-nonce-uniqueness', () => {
    it('encrypt() never reuses an IV across 10K calls with the same key', async () => {
        const seen = new Set();
        for (let i = 0; i < 10_000; i += 1) {
            const ct = await encrypt(KEY, new Uint8Array([i & 0xff]));
            // First 12 bytes of the blob = IV
            const ivHex = Array.from(ct.slice(0, 12))
                .map((b) => b.toString(16).padStart(2, '0')).join('');
            expect(seen.has(ivHex)).toBe(false);
            seen.add(ivHex);
        }
    }, 30_000);
});
