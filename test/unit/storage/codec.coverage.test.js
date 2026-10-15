// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    DOCUMENT_VERSION,
    decodeDocument,
    emptyDocument,
    encodeDocument,
} from '../../../packages/core/src/storage/codec.js';

const KEY = new Uint8Array(32).fill(79);

describe('storage codec uncovered branches', () => {
    it('fills wallets when a version-one document omits the collection', async () => {
        const blob = await encodeDocument(KEY, { documentVersion: DOCUMENT_VERSION });

        await expect(decodeDocument(KEY, blob)).resolves.toEqual(emptyDocument());
    });
});
