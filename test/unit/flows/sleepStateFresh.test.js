// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A lock-state check just before signing must see the indexer as it stands,
// so it asks the explorer for a read past the reuse window and the HTTP cache.

import { describe, expect, it, vi } from 'vitest';
import { sleepStateFor } from '../../../packages/core/src/flows/sleepQueries.js';

function registryWith(getSleeps) {
    return { get: () => ({ getSleeps }) };
}

describe('sleepStateFor read freshness', () => {
    it('asks for a fresh read when the caller does', async () => {
        const getSleeps = vi.fn(async () => ({ data: [] }));
        await sleepStateFor({ sdkRegistry: registryWith(getSleeps), chainId: 'c', query: 'addr-1', type: 'address', fresh: true });
        expect(getSleeps).toHaveBeenCalledWith('addr-1', 'address', { fresh: true });
    });

    it('keeps an ordinary read for every other caller', async () => {
        const getSleeps = vi.fn(async () => ({ data: [] }));
        await sleepStateFor({ sdkRegistry: registryWith(getSleeps), chainId: 'c', query: 'TOKEN', type: 'token' });
        expect(getSleeps).toHaveBeenCalledWith('TOKEN', 'token');
    });
});
