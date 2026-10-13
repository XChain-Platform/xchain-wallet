// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    addBlockedOrigin,
    isOriginBlocked,
    normalizeBlocklistEntry,
    removeBlockedOrigin,
} from '../../../packages/core/src/flows/blocklist.js';

function storage(settings, sites = []) {
    const put = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    return {
        vault: {
            settings: { get: vi.fn(async () => settings), put },
            connectedSites: {
                list: vi.fn(async () => sites),
                findBy: vi.fn(async () => []),
                delete: remove,
            },
        },
        put,
        remove,
    };
}

describe('blocklist flow', () => {
    beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-10-13T12:00:00Z')));
    afterEach(() => vi.useRealTimers());

    it('canonicalizes DNS trailing dots before exact and wildcard matching', () => {
        expect(normalizeBlocklistEntry('https://Example.COM./path')).toBe('https://example.com');
        expect(isOriginBlocked(['https://example.com'], 'https://example.com.')).toBe(true);
        expect(isOriginBlocked(['*.example.com'], 'https://wallet.example.com.')).toBe(true);
        expect(isOriginBlocked(['*.example.com'], 'https://example.com.')).toBe(false);
        expect(isOriginBlocked(['*.example.com'], 'https://notexample.com.')).toBe(false);
    });

    it('persists a wildcard, audits it, and evicts only matching connected sites', async () => {
        const { vault, put, remove } = storage(
            { id: 'settings', blockedOrigins: ['https://blocked.test'], theme: 'dark' },
            [
                { id: 'sub', origin: 'https://app.example.com' },
                { id: 'apex', origin: 'https://example.com' },
                { id: 'other', origin: 'https://example.net' },
            ],
        );

        await expect(addBlockedOrigin({ vault, origin: '*.Example.com' })).resolves.toEqual({
            blocked: '*.example.com',
            alreadyBlocked: false,
            evictedSiteIds: ['sub'],
        });
        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledWith('sub');
        expect(put).toHaveBeenCalledWith({
            id: 'settings',
            theme: 'dark',
            blockedOrigins: ['https://blocked.test', '*.example.com'],
            blocklistAuditLog: [{
                at: Date.parse('2026-10-13T12:00:00Z'),
                action: 'add',
                entry: '*.example.com',
                evictedSiteIds: ['sub'],
            }],
        });
    });

    it('removes a canonical match while preserving unrelated settings and audit entries', async () => {
        const prior = { at: 1, action: 'add', entry: 'https://example.com' };
        const { vault, put } = storage({
            id: 'settings',
            blockedOrigins: ['https://example.com', '*.example.net'],
            blocklistAuditLog: [prior],
            theme: 'light',
        });

        await expect(removeBlockedOrigin({ vault, origin: 'example.com.' })).resolves.toEqual({
            removed: 'https://example.com',
        });
        expect(put).toHaveBeenCalledWith({
            id: 'settings',
            blockedOrigins: ['*.example.net'],
            blocklistAuditLog: [prior, {
                at: Date.parse('2026-10-13T12:00:00Z'),
                action: 'remove',
                entry: 'https://example.com',
            }],
            theme: 'light',
        });
    });
});
