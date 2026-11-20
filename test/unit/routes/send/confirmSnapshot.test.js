// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createSendConfirmSnapshot } from '../../../../packages/core/src/shared/routes/send/confirmSnapshot.js';

describe('Send confirmation snapshot', () => {
    it('keeps the composed recipients and totals when the draft changes', () => {
        const legs = [
            { id: 'a', to: 'first', tick: 'PEPE', amount: '4' },
            { id: 'b', to: 'second', tick: 'PEPE', amount: '5' },
        ];
        const totals = [{ tick: 'PEPE', amount: '9' }];
        const snapshot = createSendConfirmSnapshot({
            sendBase: {
                chainId: 'bitcoin-mainnet', from: { address: 'source' }, to: 'first',
                tick: 'PEPE', amount: '4', legs,
            },
            sendTotals: totals,
            isMultiSend: true,
            isNativeSend: false,
            coinControlEnabled: false,
            coinControlLabel: '',
            feeEstimateAmount: '0.0001',
        });

        legs[0].amount = '1';
        legs.pop();
        totals[0].amount = '5';
        expect(snapshot.legs).toEqual([
            { id: 'a', to: 'first', tick: 'PEPE', amount: '4' },
            { id: 'b', to: 'second', tick: 'PEPE', amount: '5' },
        ]);
        expect(snapshot.totals).toEqual([{ tick: 'PEPE', amount: '9' }]);
    });
});
