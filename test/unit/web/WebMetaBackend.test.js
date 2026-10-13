// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_META_KEY,
    WebMetaBackend,
} from '../../../packages/web/src/storage/WebMetaBackend.js';

function memoryStorage(seed = {}) {
    const values = new Map(Object.entries(seed));
    return {
        values,
        getItem: vi.fn((key) => values.get(key) ?? null),
        setItem: vi.fn((key, value) => values.set(key, String(value))),
        removeItem: vi.fn((key) => values.delete(key)),
    };
}

describe('WebMetaBackend', () => {
    it('returns null when no metadata is stored', async () => {
        const storage = memoryStorage();
        const backend = new WebMetaBackend({ storage });

        await expect(backend.load()).resolves.toBeNull();
        expect(storage.getItem).toHaveBeenCalledWith(DEFAULT_META_KEY);
    });

    it('round-trips metadata as JSON under the default key', async () => {
        const storage = memoryStorage();
        const backend = new WebMetaBackend({ storage });
        const metadata = {
            kdfParams: {
                algorithm: 'argon2id',
                salt: 'c2FsdA==',
                iterations: 3,
                memoryKib: 65536,
            },
        };

        await backend.save(metadata);

        expect(storage.setItem).toHaveBeenCalledWith(
            DEFAULT_META_KEY,
            JSON.stringify(metadata),
        );
        await expect(backend.load()).resolves.toEqual(metadata);
    });

    it('uses an injected key without disturbing the default record', async () => {
        const storage = memoryStorage({
            [DEFAULT_META_KEY]: JSON.stringify({ wallet: 'default' }),
        });
        const backend = new WebMetaBackend({ key: 'secondary-wallet', storage });

        await backend.save({ wallet: 'secondary' });

        expect(storage.values.get(DEFAULT_META_KEY)).toBe(JSON.stringify({ wallet: 'default' }));
        expect(storage.values.get('secondary-wallet')).toBe(JSON.stringify({ wallet: 'secondary' }));
    });

    it('removes only its configured record when cleared', async () => {
        const storage = memoryStorage({
            [DEFAULT_META_KEY]: JSON.stringify({ wallet: 'default' }),
            unrelated: 'keep me',
        });
        const backend = new WebMetaBackend({ storage });

        await backend.clear();

        expect(storage.removeItem).toHaveBeenCalledWith(DEFAULT_META_KEY);
        expect(storage.values.has(DEFAULT_META_KEY)).toBe(false);
        expect(storage.values.get('unrelated')).toBe('keep me');
    });

    it('reports the key and parse failure for malformed metadata', async () => {
        const storage = memoryStorage({ broken: '{not json' });
        const backend = new WebMetaBackend({ key: 'broken', storage });

        await expect(backend.load()).rejects.toThrow(
            /WebMetaBackend\.load: invalid JSON at key "broken":/,
        );
    });
});
