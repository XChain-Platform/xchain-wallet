// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import { VaultCorruptError } from '../../../packages/core/src/storage/backend.js';
import { ChromeStorageBackend } from '../../../packages/extension/src/storage/ChromeStorageBackend.js';

function storageWith(value) {
    return {
        get: vi.fn(async () => ({ vault: value })),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
    };
}

describe('ChromeStorageBackend', () => {
    it('refuses to replace a vault with an empty blob', async () => {
        const chromeStorage = storageWith('AQID');
        const backend = new ChromeStorageBackend({ key: 'vault', chromeStorage });

        await expect(backend.save(new Uint8Array())).rejects.toThrow(
            'refusing to persist an empty blob',
        );
        expect(chromeStorage.set).not.toHaveBeenCalled();
    });

    it.each([
        ['', 'empty vault'],
        ['not base64!', 'invalid base64'],
        [42, 'unexpected value type'],
    ])('reports corrupt persisted data %# as vault corruption', async (value, message) => {
        const backend = new ChromeStorageBackend({
            key: 'vault',
            chromeStorage: storageWith(value),
        });

        await expect(backend.load()).rejects.toEqual(
            expect.objectContaining({ name: 'VaultCorruptError', message: expect.stringContaining(message) }),
        );
        await expect(backend.load()).rejects.toBeInstanceOf(VaultCorruptError);
    });
});
