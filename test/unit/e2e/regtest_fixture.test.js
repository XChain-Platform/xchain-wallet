// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
    INDEX_WAIT_TIMEOUT_MS,
    createIndexWaitProgress,
} from '../../e2e/fixtures/regtest.js';

describe('regtest index waits', () => {
    it('allows twenty minutes for the shared indexer to catch up', () => {
        expect(INDEX_WAIT_TIMEOUT_MS).toBe(1_200_000);
    });

    it('reports indexed and target heights once per minute', async () => {
        let time = 0;
        const log = vi.fn();
        const fetchStatus = vi.fn(async () => ({
            last_block: { RBTC: 120 },
            chain_tip: { RBTC: 127 },
        }));
        const progress = createIndexWaitProgress('action abc', {
            coin: 'RBTC',
            fetchStatus,
            log,
            now: () => time,
        });

        await progress();
        time = 59_999;
        await progress();
        expect(log).not.toHaveBeenCalled();

        time = 60_000;
        await progress();
        expect(log).toHaveBeenCalledWith(
            '[regtest RBTC] waiting for action abc: indexer height 120 / target 127',
        );

        time = 119_999;
        await progress();
        expect(log).toHaveBeenCalledTimes(1);
        expect(fetchStatus).toHaveBeenCalledTimes(1);

        time = 120_000;
        await progress();
        expect(log).toHaveBeenCalledTimes(2);
        expect(fetchStatus).toHaveBeenCalledTimes(2);
    });
});
