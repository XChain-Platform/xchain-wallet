// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import {
    chainIdForCoinCode,
    coinCodeForChainId,
    isKnownCoinCode,
} from '../../../packages/core/src/uri/coinCodes.js';

const CHAINS = {
    'bitcoin-mainnet': { coin: 'bitcoin', networkKind: 'mainnet' },
    'bitcoin-testnet': { coin: 'bitcoin', networkKind: 'testnet' },
    'dogecoin-regtest': { coin: 'dogecoin', networkKind: 'regtest' },
};

function makeRegistry() {
    return {
        descriptorFor: vi.fn((chainId) => CHAINS[chainId] ?? null),
        chainIdFor: vi.fn((coin, networkKind) => Object.entries(CHAINS)
            .find(([, descriptor]) => descriptor.coin === coin
                && descriptor.networkKind === networkKind)?.[0] ?? null),
    };
}

describe('coin code conversion', () => {
    it('round-trips a known chain id through its short code', () => {
        const registry = makeRegistry();

        const code = coinCodeForChainId('bitcoin-testnet', registry);

        expect(code).toBe('TBTC');
        expect(chainIdForCoinCode(code, registry)).toBe('bitcoin-testnet');
        expect(registry.descriptorFor).toHaveBeenCalledWith('bitcoin-testnet');
        expect(registry.chainIdFor).toHaveBeenCalledWith('bitcoin', 'testnet');
    });

    it('returns null for unknown chain ids and coin codes', () => {
        const registry = makeRegistry();

        expect(coinCodeForChainId('monero-mainnet', registry)).toBeNull();
        expect(chainIdForCoinCode('XMR', registry)).toBeNull();
        expect(registry.chainIdFor).not.toHaveBeenCalled();
    });

    it('accepts mixed case but does not trim coin codes', () => {
        const registry = makeRegistry();

        expect(chainIdForCoinCode('tBtC', registry)).toBe('bitcoin-testnet');
        expect(isKnownCoinCode('tBtC')).toBe(true);
        expect(chainIdForCoinCode(' TBTC ', registry)).toBeNull();
        expect(isKnownCoinCode(' TBTC ')).toBe(false);
    });

    it('agrees on codes emitted from known chains and rejected code inputs', () => {
        const registry = makeRegistry();
        const chainIds = Object.keys(CHAINS);

        for (const chainId of chainIds) {
            const code = coinCodeForChainId(chainId, registry);
            expect(isKnownCoinCode(code)).toBe(true);
            expect(chainIdForCoinCode(code, registry)).toBe(chainId);
        }

        for (const code of ['TRON', ' BTC ', '', null]) {
            expect(isKnownCoinCode(code)).toBe(false);
            expect(chainIdForCoinCode(code, registry)).toBeNull();
        }
    });
});
