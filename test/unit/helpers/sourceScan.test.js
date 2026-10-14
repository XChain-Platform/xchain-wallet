// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    globSync: vi.fn(() => ['b.js', 'a.js']),
    readFileSync: vi.fn((path) => `source:${path}`),
}));

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        default: { ...actual.default, ...mocks },
        ...mocks,
    };
});

import { cachedSourceFiles } from '../../helpers/sourceScan.js';

it('caches file lists and source reads across repeated scans', () => {
    const first = cachedSourceFiles('/repo', '**/*.js');
    const second = cachedSourceFiles('/repo', '**/*.js');

    expect(second).toEqual(first);
    expect(first.map((file) => file.relativePath)).toEqual(['a.js', 'b.js']);
    expect(mocks.globSync).toHaveBeenCalledTimes(1);
    expect(mocks.readFileSync).toHaveBeenCalledTimes(2);
});
