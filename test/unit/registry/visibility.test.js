// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for chain visibility helpers. Regtest descriptors are
// hidden from user-facing pickers unless Developer Mode is on.

import { describe, it, expect } from 'vitest';
import {
    filterChainsForUser,
    isChainVisibleToUser,
} from '../../../packages/core/src/registry/visibility.js';

const CHAINS = [
    { networkKind: 'mainnet', id: 'BTC' },
    { networkKind: 'testnet', id: 'TBTC' },
    { networkKind: 'regtest', id: 'RBTC' },
];

describe('registry/visibility', () => {
    describe('filterChainsForUser', () => {
        it('hides regtest chains when developer mode is off', () => {
            const out = filterChainsForUser(CHAINS, { developerMode: false });
            expect(out.map((c) => c.id)).toEqual(['BTC', 'TBTC']);
        });

        it('treats missing settings as developer mode off', () => {
            expect(filterChainsForUser(CHAINS, null).map((c) => c.id)).toEqual(['BTC', 'TBTC']);
            expect(filterChainsForUser(CHAINS, undefined).map((c) => c.id)).toEqual(['BTC', 'TBTC']);
        });

        it('shows every chain (including regtest) when developer mode is on', () => {
            const out = filterChainsForUser(CHAINS, { developerMode: true });
            expect(out.map((c) => c.id)).toEqual(['BTC', 'TBTC', 'RBTC']);
        });

        it('returns a fresh array (does not mutate or alias the input) in dev mode', () => {
            const out = filterChainsForUser(CHAINS, { developerMode: true });
            expect(out).not.toBe(CHAINS);
            expect(out).toEqual(CHAINS);
        });
    });

    describe('isChainVisibleToUser', () => {
        it('returns true for a mainnet chain regardless of mode', () => {
            expect(isChainVisibleToUser({ networkKind: 'mainnet' }, null)).toBe(true);
        });

        it('returns false for a regtest chain when developer mode is off', () => {
            expect(isChainVisibleToUser({ networkKind: 'regtest' }, { developerMode: false })).toBe(false);
        });

        it('returns true for a regtest chain when developer mode is on', () => {
            expect(isChainVisibleToUser({ networkKind: 'regtest' }, { developerMode: true })).toBe(true);
        });

        it('handles a null descriptor without throwing (off mode)', () => {
            expect(isChainVisibleToUser(null, null)).toBe(true);
        });
    });
});
