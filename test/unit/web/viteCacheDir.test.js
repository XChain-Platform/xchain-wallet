// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('web Vite dependency cache', () => {
    it('honors the cache directory selected by visual comparison tooling', async () => {
        const original = process.env.XCHAIN_VITE_CACHE_DIR;
        const cacheDir = join('/tmp', 'visual-report-fixture', 'vite-cache', 'baseline');
        process.env.XCHAIN_VITE_CACHE_DIR = cacheDir;

        try {
            const config = (await import('../../../packages/web/vite.config.js?cache-dir-test')).default;
            expect(config.cacheDir).toBe(cacheDir);
        } finally {
            if (original === undefined) delete process.env.XCHAIN_VITE_CACHE_DIR;
            else process.env.XCHAIN_VITE_CACHE_DIR = original;
        }
    });
});
