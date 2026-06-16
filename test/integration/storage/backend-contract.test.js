// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Integration: every concrete StorageBackend honours the abstract
// contract. Today only InMemoryBackend lives in core; per-shell
// backends (IndexedDB, chrome.storage, Electron file) are tested in
// their own packages but they are expected to satisfy the same
// load() / save() / clear() shape this test pins.

import { describe, it, expect } from 'vitest';
import {
    StorageBackend,
    InMemoryBackend,
    AbstractBackendMethodError,
} from '../../../packages/core/src/storage/backend.js';

describe('integration/storage/backend-contract', () => {
    describe('StorageBackend (abstract)', () => {
        it('throws on every contract method until subclassed', async () => {
            const b = new StorageBackend();
            await expect(b.load()).rejects.toThrow(AbstractBackendMethodError);
            await expect(b.save(new Uint8Array(1))).rejects.toThrow(AbstractBackendMethodError);
        });
    });

    describe('InMemoryBackend', () => {
        it('returns null on load when nothing has been saved', async () => {
            const b = new InMemoryBackend();
            expect(await b.load()).toBeNull();
        });

        it('round-trips a Uint8Array verbatim', async () => {
            const b = new InMemoryBackend();
            const blob = new Uint8Array([1, 2, 3, 4, 255]);
            await b.save(blob);
            const got = await b.load();
            expect(got).toBeInstanceOf(Uint8Array);
            expect(Array.from(got)).toEqual([1, 2, 3, 4, 255]);
        });

        it('overwrites a prior save with the next save', async () => {
            const b = new InMemoryBackend();
            await b.save(new Uint8Array([1]));
            await b.save(new Uint8Array([2, 2]));
            const got = await b.load();
            expect(Array.from(got)).toEqual([2, 2]);
        });

        it('refuses non-Uint8Array on save (load must always see opaque bytes)', async () => {
            const b = new InMemoryBackend();
            await expect(b.save('not bytes')).rejects.toThrow(/Uint8Array/);
            await expect(b.save(null)).rejects.toThrow(/Uint8Array/);
        });
    });
});
