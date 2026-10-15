// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { encrypt } from '../../../packages/core/src/crypto/aead.js';
import {
    DOCUMENT_VERSION,
    decodeDocument,
    emptyDocument,
    encodeDocument,
} from '../../../packages/core/src/storage/codec.js';

const KEY = new Uint8Array(32).fill(53);

describe('storage codec edge branches', () => {
    it('rejects authenticated plaintext that is not valid JSON', async () => {
        const blob = await encrypt(KEY, new TextEncoder().encode('{not json'));
        await expect(decodeDocument(KEY, blob)).rejects.toBeInstanceOf(SyntaxError);
    });

    it('rejects JSON primitives and arrays as documents', async () => {
        for (const value of [false, 0, 'vault']) {
            const blob = await encodeDocument(KEY, value);
            await expect(decodeDocument(KEY, blob)).rejects.toThrow(
                'codec: decoded payload is not an object',
            );
        }

        const arrayBlob = await encodeDocument(KEY, []);
        await expect(decodeDocument(KEY, arrayBlob)).rejects.toThrow(
            `codec: unsupported documentVersion undefined (expected ${DOCUMENT_VERSION})`,
        );
    });

    it('preserves present falsy fields while filling only nullish fields', async () => {
        const document = {
            ...emptyDocument(),
            wallets: false,
            accounts: null,
            settings: false,
        };
        const decoded = await decodeDocument(KEY, await encodeDocument(KEY, document));

        expect(decoded.wallets).toBe(false);
        expect(decoded.accounts).toEqual([]);
        expect(decoded.settings).toBe(false);
    });
});
