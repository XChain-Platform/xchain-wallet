// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A holder list that names one address twice. Measured against the summary:
// a sole owner listed twice read as a distributed token, and a holder listed
// twice counted as two CALLBACK recipients owed twice the payout.

import { describe, expect, it } from 'vitest';
import { tokenHolderSummary } from '../../../packages/core/src/flows/tokenHolders.js';

const OWNER = 'bcrt1qzpe0rftccmlvgfmwz7ek683ma5nr9rcg6d9nkg';
const HOLDER = 'bcrt1qmr46t4ca5wh35k6mczdzrkepqw2d8ne956f48f';

const summary = (holders) => tokenHolderSummary({
    sdkRegistry: { get: () => ({ getHolders: async () => ({ total: holders.length, data: holders }) }) },
    chainId: 'bitcoin-regtest', tick: 'XCHAIN', owner: OWNER, callbackAmount: '2',
});

describe('a holder listed twice is one holder', () => {
    it('a sole owner listed twice is not a distributed token', async () => {
        const s = await summary([{ address: OWNER, amount: '1000' }, { address: OWNER, amount: '1000' }]);
        expect(s.isDistributed).toBe(false);
        expect(s.topHolders).toEqual([{ address: OWNER, amount: '1000' }]);
    });

    it('a holder listed twice is one recipient owed one payout', async () => {
        const s = await summary([
            { address: OWNER, amount: '500' },
            { address: HOLDER, amount: '500' },
            { address: HOLDER, amount: '500' },
        ]);
        expect(s.recipientCount).toBe(1);
        expect(s.totalPayout).toBe('1000');
        expect(s.topHolders.map((h) => h.address)).toEqual([OWNER, HOLDER]);
    });
});
