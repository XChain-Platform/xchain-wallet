// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    recentActivityEntries,
} from '../../../../packages/core/src/shared/utils/historyRow.js';

function entry({
    chainId,
    actionIndex,
    blockIndex,
    timestamp,
    label = `${chainId}:${actionIndex}`,
}) {
    return {
        chainId,
        actionIndex,
        blockIndex,
        timestamp,
        label,
    };
}

describe('recentActivityEntries', () => {
    it('returns pending first newest first, then confirmed by confirm time newest first across chains', () => {
        const referenceSeconds = 1_760_000_000;
        const rows = [
            entry({
                chainId: 'dogecoin-mainnet',
                actionIndex: '5900000',
                blockIndex: 5_900_000,
                timestamp: referenceSeconds - (3 * 24 * 60 * 60),
                label: 'old-doge',
            }),
            entry({
                chainId: 'bitcoin-mainnet',
                actionIndex: '920000',
                blockIndex: 920_000,
                timestamp: referenceSeconds - (10 * 60),
                label: 'recent-btc',
            }),
            entry({
                chainId: 'bitcoin-mainnet',
                actionIndex: '919999',
                blockIndex: 919_999,
                timestamp: referenceSeconds - (20 * 60),
                label: 'btc-lower-height',
            }),
            entry({
                chainId: 'bitcoin-mainnet',
                actionIndex: '920001',
                blockIndex: 920_001,
                timestamp: referenceSeconds - (20 * 60),
                label: 'btc-higher-height',
            }),
            entry({
                chainId: 'litecoin-mainnet',
                actionIndex: 'pending-older',
                blockIndex: 0,
                timestamp: referenceSeconds - (30 * 60),
                label: 'pending-seconds',
            }),
            entry({
                chainId: 'bitcoin-mainnet',
                actionIndex: 'pending-newer',
                blockIndex: 0,
                timestamp: (referenceSeconds - 60) * 1000,
                label: 'pending-milliseconds',
            }),
        ];

        expect(recentActivityEntries(rows).map(({ label }) => label)).toEqual([
            'pending-milliseconds',
            'pending-seconds',
            'recent-btc',
            'btc-higher-height',
            'btc-lower-height',
            'old-doge',
        ]);
    });

    it('deduplicates before applying the limit', () => {
        const duplicate = entry({
            chainId: 'bitcoin-mainnet',
            actionIndex: '7',
            blockIndex: 7,
            timestamp: 700,
            label: 'first-copy',
        });
        const rows = [
            duplicate,
            { ...duplicate, timestamp: 800, label: 'duplicate-copy' },
            entry({
                chainId: 'litecoin-mainnet',
                actionIndex: '8',
                blockIndex: 8,
                timestamp: 800,
                label: 'newest-unique',
            }),
            entry({
                chainId: 'dogecoin-mainnet',
                actionIndex: '6',
                blockIndex: 6,
                timestamp: 600,
                label: 'outside-limit',
            }),
        ];

        expect(recentActivityEntries(rows, 2).map(({ label }) => label)).toEqual([
            'newest-unique',
            'first-copy',
        ]);
    });
});
