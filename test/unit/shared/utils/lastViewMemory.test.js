// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { normalizeRouteParams } from '../../../../packages/core/src/shared/utils/lastViewMemory.js';

describe('shared/utils/lastViewMemory normalizeRouteParams', () => {
    it.each([
        ['token detail', 'token-detail', {
            chainId: 'bitcoin-mainnet',
            tick: 'XCP',
            divisibility: 8,
            ignored: 'value',
        }, { chainId: 'bitcoin-mainnet', tick: 'XCP', divisibility: 8 }],
        ['market', 'market', {
            chainId: 'bitcoin-mainnet', tick1: 'XCP', tick2: 'BTC', ignored: true,
        }, { chainId: 'bitcoin-mainnet', tick1: 'XCP', tick2: 'BTC' }],
        ['list detail', 'list-detail', {
            chainId: 'bitcoin-mainnet', actionIndex: '12', origin: 'wallet', ignored: true,
        }, { chainId: 'bitcoin-mainnet', actionIndex: '12', origin: 'wallet' }],
        ['dispenser detail', 'dispenser-detail', {
            chainId: 'bitcoin-mainnet', actionIndex: '34', directoryChainId: 'litecoin-mainnet',
        }, { chainId: 'bitcoin-mainnet', actionIndex: '34', directoryChainId: 'litecoin-mainnet' }],
        ['non-contextual view', 'home', { chainId: 'bitcoin-mainnet' }, null],
        ['array params', 'market', [], null],
        ['missing chain', 'market', { tick1: 'XCP', tick2: 'BTC' }, null],
        ['incomplete market', 'market', { chainId: 'bitcoin-mainnet', tick1: 'XCP' }, null],
        ['oversized tick', 'token-detail', { chainId: 'bitcoin-mainnet', tick: 'x'.repeat(513) }, null],
    ])('normalizes %s params', (_label, view, params, expected) => {
        expect(normalizeRouteParams(view, params)).toEqual(expected);
    });
});
