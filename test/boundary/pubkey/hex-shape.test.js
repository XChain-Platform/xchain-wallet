// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Boundary: secp256k1 public-key hex shape. Compressed = 33 bytes (66
// hex chars) starting 02/03; uncompressed = 65 bytes (130 hex chars)
// starting 04. The wallet's multisig + signer code mostly lives in
// compressed-only territory.

import { describe, it, expect } from 'vitest';

function isCompressedPubkey(hex) {
    if (typeof hex !== 'string') return false;
    if (hex.length !== 66) return false;
    if (!/^(02|03)/.test(hex)) return false;
    return /^[0-9a-fA-F]+$/.test(hex);
}

function isUncompressedPubkey(hex) {
    if (typeof hex !== 'string') return false;
    if (hex.length !== 130) return false;
    if (!/^04/.test(hex)) return false;
    return /^[0-9a-fA-F]+$/.test(hex);
}

describe('boundary/pubkey/hex-shape', () => {
    describe('compressed', () => {
        it('accepts the canonical 02-prefix 66-char form', () => {
            expect(isCompressedPubkey('02' + 'a'.repeat(64))).toBe(true);
        });

        it('accepts the canonical 03-prefix 66-char form', () => {
            expect(isCompressedPubkey('03' + 'b'.repeat(64))).toBe(true);
        });

        it('rejects 65 chars (one short)', () => {
            expect(isCompressedPubkey('02' + 'a'.repeat(63))).toBe(false);
        });

        it('rejects 67 chars (one long)', () => {
            expect(isCompressedPubkey('02' + 'a'.repeat(65))).toBe(false);
        });

        it('rejects an uncompressed-prefixed (04) hex of compressed length', () => {
            expect(isCompressedPubkey('04' + 'a'.repeat(64))).toBe(false);
        });

        it('rejects a non-hex character in the body', () => {
            expect(isCompressedPubkey('02' + 'a'.repeat(63) + 'g')).toBe(false);
        });

        it('rejects empty / non-string', () => {
            expect(isCompressedPubkey('')).toBe(false);
            expect(isCompressedPubkey(null)).toBe(false);
            expect(isCompressedPubkey(undefined)).toBe(false);
            expect(isCompressedPubkey(42)).toBe(false);
        });
    });

    describe('uncompressed', () => {
        it('accepts the canonical 04-prefix 130-char form', () => {
            expect(isUncompressedPubkey('04' + 'a'.repeat(128))).toBe(true);
        });

        it('rejects compressed-length input', () => {
            expect(isUncompressedPubkey('04' + 'a'.repeat(64))).toBe(false);
        });
    });
});
