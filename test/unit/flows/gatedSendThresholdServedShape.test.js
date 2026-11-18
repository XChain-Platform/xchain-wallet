// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The threshold split reads the recipient's `/balances/` row. The explorer serves
// `amount` at HUMAN scale with the token's `decimals` beside it, so a recipient
// holding 3000 whole tokens must read as 3000 whatever the decimals. Reading it as
// atomic units understated the balance by 10^decimals and composed a plain SEND to
// a recipient who met the pack's threshold.

import { describe, it, expect, vi } from 'vitest';
import { splitGroupsByThreshold } from '../../../packages/core/src/flows/gatedSendGuard.js';

const CHAIN = 'btc-regtest';
const ACTIVE = { [CHAIN]: 100 };
const GROUP = {
    keyHash: 'ab'.repeat(32),
    files: [{ actionIndex: '100', gateMinAmount: '3000' }],
};

function split(row, amount = '1') {
    const sdk = {
        getStatus: vi.fn(async () => ({ last_block: { RBTC: 500 } })),
        getBalances: vi.fn(async () => ({ data: row ? [row] : [] })),
    };
    return splitGroupsByThreshold({
        sdkRegistry: { get: () => sdk }, chainId: CHAIN, sdk, to: 'bcrt1qrecipient',
        tick: 'GATED', amount, groups: [GROUP], heights: ACTIVE,
    });
}

describe('splitGroupsByThreshold reads the served /balances/ row shape', () => {
    it('keeps the pack required when a decimals>0 recipient holds the threshold as a human amount', async () => {
        const out = await split({ tick: 'GATED', amount: '3000', decimals: 8 });
        expect(out.belowThresholdKeyHashes).toEqual([]);
        expect(out.requiredGroups).toHaveLength(1);
    });

    it('counts a fractional human amount instead of falling back on a parse error', async () => {
        const out = await split({ tick: 'GATED', amount: '2999.5', decimals: 8 }, '0.5');
        expect(out.belowThresholdKeyHashes).toEqual([]);
    });

    it('still drops the pack when the post-send balance is below the threshold', async () => {
        const out = await split({ tick: 'GATED', amount: '2998', decimals: 8 });
        expect(out.belowThresholdKeyHashes).toEqual([GROUP.keyHash]);
    });

    it('reads a row that carries atomic quantity at its divisibility', async () => {
        const out = await split({ tick: 'GATED', quantity: '300000000000', divisibility: 8 });
        expect(out.belowThresholdKeyHashes).toEqual([]);
    });

    it('keeps every pack required when the row amount cannot be read', async () => {
        const out = await split({ tick: 'GATED', amount: 'garbage', decimals: 8 });
        expect(out.belowThresholdKeyHashes).toEqual([]);
        expect(out.requiredGroups).toHaveLength(1);
    });
});
