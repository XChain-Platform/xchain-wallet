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

describe('desktop file references', () => {
    it('returns a path reference with the file size', () => {
        const file = stubFile(123);
        const bridge = { filePathOf: vi.fn(() => '/tmp/example.bin') };

        expect(desktopFileRefOf(file, bridge)).toEqual({
            kind: 'path',
            path: '/tmp/example.bin',
            size: 123,
        });
        expect(bridge.filePathOf).toHaveBeenCalledWith(file);
        expect(file.arrayBuffer).not.toHaveBeenCalled();
        expect(file.text).not.toHaveBeenCalled();
        expect(file.stream).not.toHaveBeenCalled();
        expect(file.slice).not.toHaveBeenCalled();
    });

    it.each([
        ['an empty path', stubFile(), { filePathOf: () => '' }],
        ['a non-string path', stubFile(), { filePathOf: () => 123 }],
        ['a throwing path lookup', stubFile(), { filePathOf: () => { throw new Error('unavailable'); } }],
        ['a missing bridge', stubFile(), undefined],
        ['a bridge without filePathOf', stubFile(), {}],
        ['a string argument', 'file', { filePathOf: () => '/tmp/example.bin' }],
        ['a negative size', stubFile(-1), { filePathOf: () => '/tmp/example.bin' }],
        ['a fractional size', stubFile(1.5), { filePathOf: () => '/tmp/example.bin' }],
        ['an unsafe size', stubFile(Number.MAX_SAFE_INTEGER + 1), { filePathOf: () => '/tmp/example.bin' }],
    ])('returns null for %s', (_label, file, bridge) => {
        expect(desktopFileRefOf(file, bridge)).toBeNull();
    });

    it('does not read file contents when path lookup fails', () => {
        const files = [stubFile(), stubFile(), stubFile()];

        desktopFileRefOf(files[0], { filePathOf: () => '' });
        desktopFileRefOf(files[1], { filePathOf: () => ({}) });
        desktopFileRefOf(files[2], { filePathOf: () => { throw new Error('unavailable'); } });

        for (const file of files) {
            expect(file.arrayBuffer).not.toHaveBeenCalled();
            expect(file.text).not.toHaveBeenCalled();
            expect(file.stream).not.toHaveBeenCalled();
            expect(file.slice).not.toHaveBeenCalled();
        }
    });
});
