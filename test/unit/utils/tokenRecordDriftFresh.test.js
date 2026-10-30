// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The token-record re-check that Mint, Sell ownership, Sleep and token admin
// run at review decides whether the form may go on to sign, and the form read
// the same record moments earlier, so the re-check asks for a fresh read.

import { describe, it, expect, vi } from 'vitest';
import { tokenRecordChangedSince } from '../../../packages/core/src/shared/utils/tokenRecordDrift.js';

describe('tokenRecordChangedSince reads the token fresh', () => {
    it('asks the host for a fresh token record', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({ tick: 'GATE', owner: 'bc1qnew' });
        const moved = await tokenRecordChangedSince({
            messaging: { getTokenInfo },
            chainId: 'bitcoin-regtest',
            tick: 'GATE',
            current: { tick: 'GATE', owner: 'bc1qold' },
            keys: ['owner'],
        });
        expect(getTokenInfo).toHaveBeenCalledWith({ chainId: 'bitcoin-regtest', tick: 'GATE', demo: false, fresh: true });
        expect(moved).toBe(true);
    });
});
