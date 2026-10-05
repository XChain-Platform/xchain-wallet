// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBackupPointerContent } from '../../../packages/extension/src/background/backupPointerResolver.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('resolveBackupPointerContent', () => {
    it.each([
        ['a missing pointer', undefined],
        ['a non-string location', { location: 42 }],
        ['a blank location', { location: '   \n\t' }],
    ])('rejects %s with the no-location error', async (_name, pointer) => {
        await expect(resolveBackupPointerContent(pointer)).rejects.toThrow(
            'backup pointer has no location to resolve',
        );
    });

    it('rejects a non-URL location', async () => {
        await expect(resolveBackupPointerContent({ location: 'not a URL' })).rejects.toThrow(
            'backup pointer location is not a URL',
        );
    });

    it('rejects http without fetching', async () => {
        const fetch = vi.fn();
        globalThis.fetch = fetch;

        await expect(resolveBackupPointerContent({ location: 'http://backup.example/vault' })).rejects.toThrow(
            'unsupported backup-pointer location scheme "http:"',
        );
        expect(fetch).not.toHaveBeenCalled();
    });

    it('fetches a normalized https URL and resolves its text', async () => {
        const fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: vi.fn().mockResolvedValue('encrypted envelope'),
        });
        globalThis.fetch = fetch;

        await expect(resolveBackupPointerContent({
            location: '  https://backup.example/a/../vault?version=1  ',
        })).resolves.toBe('encrypted envelope');
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledWith(
            'https://backup.example/vault?version=1',
            { redirect: 'follow' },
        );
    });

    it('includes a failed response status in the error', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

        await expect(resolveBackupPointerContent({ location: 'https://backup.example/vault' })).rejects.toThrow(
            'backup pointer fetch failed: HTTP 503',
        );
    });
});
