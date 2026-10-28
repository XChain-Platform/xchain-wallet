// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A SLEEP row whose RESUME_BLOCK is not a block number is an unreadable lock
// state, not an awake one. Returned as NaN, it crosses the extension message
// channel as null, and Lock address reads a locked address as awake and signs
// a lock the indexer refuses after the fee is spent. The read fails instead,
// so every form treats the state as unread.

import { describe, it, expect, vi } from 'vitest';
import { sleepStateFor } from '../../../packages/core/src/flows/sleepQueries.js';

function sdkWith(rows) {
    return { get: () => ({ getSleeps: vi.fn(async () => ({ data: rows })) }) };
}

describe('sleepStateFor with a malformed RESUME_BLOCK', () => {
    it('fails the read when the latest row carries a word for a block', async () => {
        const read = sleepStateFor({
            sdkRegistry: sdkWith([{ action_index: 7, resume_block: 'soon', status: 'valid' }]),
            chainId: 'c', query: 'addr-1', type: 'address',
        });
        await expect(read).rejects.toThrow(/RESUME_BLOCK/);
    });

    it('fails the read for a fractional or out-of-range block', async () => {
        for (const rb of ['12.5', '-7', 'Infinity']) {
            const read = sleepStateFor({
                sdkRegistry: sdkWith([{ action_index: 7, resume_block: rb, status: 'valid' }]),
                chainId: 'c', query: 'GATE', type: 'token',
            });
            await expect(read).rejects.toThrow(/RESUME_BLOCK/);
        }
    });

    it('reads block numbers sent as strings', async () => {
        for (const [rb, want] of [['-1', -1], ['0', 0], ['950', 950]]) {
            const s = await sleepStateFor({
                sdkRegistry: sdkWith([{ action_index: 7, resume_block: rb, status: 'valid' }]),
                chainId: 'c', query: 'addr-1', type: 'address',
            });
            expect(s.resumeBlock).toBe(want);
        }
    });
});
