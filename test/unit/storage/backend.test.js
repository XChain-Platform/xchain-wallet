// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the storage backend contract + the in-memory implementation.

import { describe, it, expect } from 'vitest';
import {
    StorageBackend,
    InMemoryBackend,
    AbstractBackendMethodError,
} from '../../../packages/core/src/storage/backend.js';

describe('storage/backend', () => {
    describe('StorageBackend (abstract contract)', () => {
        it('load/save/clear all throw AbstractBackendMethodError naming the method', async () => {
            const b = new StorageBackend();
            await expect(b.load()).rejects.toBeInstanceOf(AbstractBackendMethodError);
            await expect(b.save(new Uint8Array(1))).rejects.toThrow(/"save"/);
            await expect(b.clear()).rejects.toThrow(/"clear"/);
        });

        it('AbstractBackendMethodError carries a descriptive name + message', () => {
            const e = new AbstractBackendMethodError('load');
            expect(e.name).toBe('AbstractBackendMethodError');
            expect(e.message).toMatch(/abstract method "load" not implemented/);
        });
    });

    describe('InMemoryBackend', () => {
        it('loads null when constructed empty', async () => {
            expect(await new InMemoryBackend().load()).toBeNull();
        });

        it('seeds from an initial blob and returns a defensive copy on load', async () => {
            const seed = new Uint8Array([1, 2, 3]);
            const b = new InMemoryBackend(seed);
            const loaded = await b.load();
            expect(Array.from(loaded)).toEqual([1, 2, 3]);
            // Mutating the loaded copy must not affect the stored blob.
            loaded[0] = 99;
            expect(Array.from(await b.load())).toEqual([1, 2, 3]);
            // Mutating the original seed must not affect the stored blob either.
            seed[0] = 88;
            expect(Array.from(await b.load())).toEqual([1, 2, 3]);
        });

        it('save then load round-trips a copy of the blob', async () => {
            const b = new InMemoryBackend();
            const blob = new Uint8Array([9, 8, 7]);
            await b.save(blob);
            blob[0] = 0; // post-save mutation must not leak in
            expect(Array.from(await b.load())).toEqual([9, 8, 7]);
        });

        it('save rejects a non-Uint8Array blob', async () => {
            const b = new InMemoryBackend();
            await expect(b.save([1, 2, 3])).rejects.toThrow(/must be a Uint8Array/);
        });

        it('clear drops the persisted blob back to null', async () => {
            const b = new InMemoryBackend(new Uint8Array([1]));
            await b.clear();
            expect(await b.load()).toBeNull();
        });

        it('is a StorageBackend', () => {
            expect(new InMemoryBackend()).toBeInstanceOf(StorageBackend);
        });
    });
});
