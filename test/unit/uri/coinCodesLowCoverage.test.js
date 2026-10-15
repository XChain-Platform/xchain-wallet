// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { coinCodeForChainId } from '../../../packages/core/src/uri/coinCodes.js';

describe('coin code low-coverage branches', () => {
    it('rejects missing inputs before consulting a registry', () => {
        const registry = { descriptorFor: vi.fn() };

        expect(coinCodeForChainId('', registry)).toBeNull();
        expect(coinCodeForChainId('bitcoin-mainnet', null)).toBeNull();
        expect(registry.descriptorFor).not.toHaveBeenCalled();
    });

    it('uses a map-like registry when descriptorFor is absent', () => {
        const registry = {
            get: vi.fn((chainId) => (chainId === 'litecoin-regtest'
                ? { coin: 'litecoin', networkKind: 'regtest' }
                : null)),
        };

        expect(coinCodeForChainId('litecoin-regtest', registry)).toBe('RLTC');
        expect(coinCodeForChainId('missing', registry)).toBeNull();
        expect(registry.get).toHaveBeenCalledTimes(2);
    });

    it('rejects descriptors with unsupported coins or networks', () => {
        expect(coinCodeForChainId('monero-mainnet', {
            descriptorFor: () => ({ coin: 'monero', networkKind: 'mainnet' }),
        })).toBeNull();
        expect(coinCodeForChainId('bitcoin-signet', {
            descriptorFor: () => ({ coin: 'bitcoin', networkKind: 'signet' }),
        })).toBeNull();
    });
});
