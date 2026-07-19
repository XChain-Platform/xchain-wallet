// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: flows/effectiveNetwork. The active-network filter is the single
// source of truth for which configured chains are "live" given
// settings.activeNetwork. Defaults to mainnet when the setting is absent
// or invalid; unknown chainIds are excluded defensively (no fetch).

import { describe, it, expect } from 'vitest';
import {
    getActiveNetwork,
    isChainOnActiveNetwork,
    filterChainIdsByActiveNetwork,
} from '../../../packages/core/src/flows/effectiveNetwork.js';

// Minimal registry: chainId -> descriptor with a networkKind. descriptorFor
// returns undefined for anything not in the map (an unconfigured chain).
function mkRegistry(map) {
    return { descriptorFor: (id) => map[id] };
}

const registry = mkRegistry({
    'bitcoin-mainnet': { networkKind: 'mainnet' },
    'litecoin-mainnet': { networkKind: 'mainnet' },
    'bitcoin-testnet': { networkKind: 'testnet' },
    'bitcoin-regtest': { networkKind: 'regtest' },
});

describe('flows/effectiveNetwork getActiveNetwork', () => {
    it('returns each valid network verbatim', () => {
        expect(getActiveNetwork({ activeNetwork: 'mainnet' })).toBe('mainnet');
        expect(getActiveNetwork({ activeNetwork: 'testnet' })).toBe('testnet');
        expect(getActiveNetwork({ activeNetwork: 'regtest' })).toBe('regtest');
    });

    it('falls back to the mainnet default for absent/invalid/nullish input', () => {
        expect(getActiveNetwork(null)).toBe('mainnet');
        expect(getActiveNetwork(undefined)).toBe('mainnet');
        expect(getActiveNetwork({})).toBe('mainnet');
        expect(getActiveNetwork({ activeNetwork: 'bogus' })).toBe('mainnet');
    });
});

describe('flows/effectiveNetwork isChainOnActiveNetwork', () => {
    it('is true only when the descriptor networkKind matches the active network', () => {
        const s = { activeNetwork: 'mainnet' };
        expect(isChainOnActiveNetwork('bitcoin-mainnet', s, registry)).toBe(true);
        expect(isChainOnActiveNetwork('bitcoin-testnet', s, registry)).toBe(false);
    });

    it('defends against missing chainId, registry, or descriptor', () => {
        const s = { activeNetwork: 'mainnet' };
        expect(isChainOnActiveNetwork('', s, registry)).toBe(false);
        expect(isChainOnActiveNetwork('bitcoin-mainnet', s, null)).toBe(false);
        expect(isChainOnActiveNetwork('never-configured', s, registry)).toBe(false);
    });

    it('honors the mainnet default when settings omit activeNetwork', () => {
        expect(isChainOnActiveNetwork('bitcoin-mainnet', {}, registry)).toBe(true);
        expect(isChainOnActiveNetwork('bitcoin-regtest', {}, registry)).toBe(false);
    });
});

describe('flows/effectiveNetwork filterChainIdsByActiveNetwork', () => {
    it('keeps only chains on the active network, preserving order', () => {
        const s = { activeNetwork: 'mainnet' };
        const out = filterChainIdsByActiveNetwork(
            ['bitcoin-testnet', 'litecoin-mainnet', 'bitcoin-mainnet', 'bitcoin-regtest'],
            s,
            registry,
        );
        expect(out).toEqual(['litecoin-mainnet', 'bitcoin-mainnet']);
    });

    it('excludes unknown chainIds defensively', () => {
        const s = { activeNetwork: 'mainnet' };
        expect(filterChainIdsByActiveNetwork(['ghost-chain', 'bitcoin-mainnet'], s, registry))
            .toEqual(['bitcoin-mainnet']);
    });

    it('returns an empty array for non-array or empty input', () => {
        const s = { activeNetwork: 'mainnet' };
        expect(filterChainIdsByActiveNetwork([], s, registry)).toEqual([]);
        expect(filterChainIdsByActiveNetwork(null, s, registry)).toEqual([]);
        expect(filterChainIdsByActiveNetwork(undefined, s, registry)).toEqual([]);
    });

    it('returns an empty array when the registry is missing', () => {
        expect(filterChainIdsByActiveNetwork(['bitcoin-mainnet'], { activeNetwork: 'mainnet' }, null))
            .toEqual([]);
    });
});
