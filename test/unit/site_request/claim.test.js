// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    CALLBACK_BODY_MAX_BYTES,
    callbackBodyFits,
    mintClaim,
} from '../../../packages/core/src/site_request/claim.js';

const jsonByteLength = (body) => new TextEncoder().encode(JSON.stringify(body)).length;

function bodyWithJsonByteLength(byteLength) {
    const multibyte = 'é';
    const wrapperBytes = jsonByteLength({ result: '' });
    const multibyteBytes = new TextEncoder().encode(multibyte).length;
    return {
        result: `${multibyte}${'a'.repeat(byteLength - wrapperBytes - multibyteBytes)}`,
    };
}

describe('site request claim helpers', () => {
    it('encodes a fixed 128-bit source as unpadded base64url', () => {
        const randomBytes = vi.fn((length) => (
            Uint8Array.from({ length }, (_, index) => index)
        ));

        expect(mintClaim(randomBytes)).toBe('AAECAwQFBgcICQoLDA0ODw');
        expect(randomBytes).toHaveBeenCalledOnce();
        expect(randomBytes).toHaveBeenCalledWith(16);
    });

    it('keeps the claim length and charset across many mints', () => {
        let mintIndex = 0;

        for (let index = 0; index < 256; index += 1) {
            const claim = mintClaim((length) => {
                const seed = mintIndex;
                mintIndex += 1;
                return Uint8Array.from(
                    { length },
                    (_, byteIndex) => (seed * 17 + byteIndex * 29) & 0xff,
                );
            });

            expect(claim).toHaveLength(22);
            expect(claim).toMatch(/^[A-Za-z0-9_-]{22}$/);
        }

        expect(mintIndex).toBe(256);
    });

    it('accepts 10,240 JSON UTF-8 bytes and refuses 10,241', () => {
        const atLimit = bodyWithJsonByteLength(CALLBACK_BODY_MAX_BYTES);
        const overLimit = bodyWithJsonByteLength(CALLBACK_BODY_MAX_BYTES + 1);

        expect(atLimit.result).toContain('é');
        expect(overLimit.result).toContain('é');
        expect(jsonByteLength(atLimit)).toBe(10240);
        expect(jsonByteLength(overLimit)).toBe(10241);
        expect(callbackBodyFits(atLimit)).toBe(true);
        expect(callbackBodyFits(overLimit)).toBe(false);
    });
});
