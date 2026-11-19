// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import { desktopFileRefOf } from '../../../packages/desktop/renderer/desktopFileRef.js';

function stubFile(size = 42) {
    return {
        size,
        arrayBuffer: vi.fn(),
        text: vi.fn(),
        stream: vi.fn(),
        slice: vi.fn(),
    };
}

const ok = (token = 'tok-1', size = 42) => vi.fn(async () => ({ token, size }));

describe('desktop file references', () => {
    it('returns a path reference with the file size', async () => {
        const file = stubFile(123);
        const bridge = { fileTokenOf: ok('tok-123', 123) };

        await expect(desktopFileRefOf(file, bridge)).resolves.toEqual({
            kind: 'picked',
            token: 'tok-123',
            size: 123,
        });
        expect(bridge.fileTokenOf).toHaveBeenCalledWith(file);
        expect(file.arrayBuffer).not.toHaveBeenCalled();
        expect(file.text).not.toHaveBeenCalled();
        expect(file.stream).not.toHaveBeenCalled();
        expect(file.slice).not.toHaveBeenCalled();
    });

    it.each([
        ['an empty path', stubFile(), { fileTokenOf: async () => null }],
        ['a non-string path', stubFile(), { fileTokenOf: async () => ({ token: 123, size: 42 }) }],
        ['a throwing path lookup', stubFile(), { fileTokenOf: async () => { throw new Error('unavailable'); } }],
        ['a missing bridge', stubFile(), undefined],
        ['a bridge without filePathOf', stubFile(), {}],
        ['a string argument', 'file', { fileTokenOf: ok() }],
        ['a negative size', stubFile(-1), { fileTokenOf: ok() }],
        ['a fractional size', stubFile(1.5), { fileTokenOf: ok() }],
        ['an unsafe size', stubFile(Number.MAX_SAFE_INTEGER + 1), { fileTokenOf: ok() }],
        ['an empty token', stubFile(), { fileTokenOf: ok('') }],
        ['a token registered for a different size', stubFile(42), { fileTokenOf: ok('tok-1', 43) }],
        ['a synchronous throw from the lookup', stubFile(), { fileTokenOf: () => { throw new Error('unavailable'); } }],
    ])('returns null for %s', async (_label, file, bridge) => {
        await expect(desktopFileRefOf(file, bridge)).resolves.toBeNull();
    });

    it('does not read file contents when path lookup fails', async () => {
        const files = [stubFile(), stubFile(), stubFile()];

        await desktopFileRefOf(files[0], { fileTokenOf: async () => null });
        await desktopFileRefOf(files[1], { fileTokenOf: async () => ({}) });
        await desktopFileRefOf(files[2], { fileTokenOf: async () => { throw new Error('unavailable'); } });

        for (const file of files) {
            expect(file.arrayBuffer).not.toHaveBeenCalled();
            expect(file.text).not.toHaveBeenCalled();
            expect(file.stream).not.toHaveBeenCalled();
            expect(file.slice).not.toHaveBeenCalled();
        }
    });

    it('never carries a filesystem path in the reference it returns', async () => {
        const bridge = { fileTokenOf: vi.fn(async () => ({ token: 'tok-9', size: 42, path: '/etc/hosts' })) };

        const ref = await desktopFileRefOf(stubFile(42), bridge);

        expect(Object.keys(ref).sort()).toEqual(['kind', 'size', 'token']);
        expect(JSON.stringify(ref)).not.toContain('/etc/hosts');
    });
});
