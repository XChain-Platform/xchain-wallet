// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the asset-page to History scoping helper. The pairing with
// applyHistoryFilters proves the scope it hands History actually keeps a
// token's rows and drops the parent chain's plain transfers.

import { describe, it, expect } from 'vitest';
import { historyScopeForAsset } from '../../../packages/core/src/shared/utils/historyEntryScope.js';
import { applyHistoryFilters } from '../../../packages/core/src/shared/utils/historyFilter.js';

const DOGE = 'dogecoin-testnet';

function entry(over) {
    return {
        key: `${over.chainId || DOGE}:${over.actionIndex}`,
        chainId: over.chainId || DOGE,
        address: 'nmUN3SanVb323ZECB4fVWtrrWoCmxgmVoL',
        actionIndex: String(over.actionIndex),
        action: over.action || 'SEND',
        blockIndex: 1,
        timestamp: over.timestamp || 1789823111,
        txHash: over.txHash || 'ab'.repeat(32),
        source: 'nmUN3SanVb323ZECB4fVWtrrWoCmxgmVoL',
        raw: over.raw || {},
        link: null,
    };
}

describe('historyScopeForAsset', () => {
    it('scopes a token to its chain and seeds the search with its tick', () => {
        expect(historyScopeForAsset({ chainId: DOGE, tick: 'P00P', kind: 'token' }))
            .toEqual({ chainCoin: 'dogecoin', searchQuery: 'P00P' });
    });

    it('scopes a subtoken the same way', () => {
        expect(historyScopeForAsset({ chainId: 'bitcoin-mainnet', tick: 'FUFU.ART', kind: 'subtoken' }))
            .toEqual({ chainCoin: 'bitcoin', searchQuery: 'FUFU.ART' });
    });

    it('scopes a native coin to its chain only, so plain transfers stay visible', () => {
        expect(historyScopeForAsset({ chainId: 'bitcoin-mainnet', tick: 'BTC', kind: 'native' }))
            .toEqual({ chainCoin: 'bitcoin', searchQuery: '' });
    });

    it('treats a ref with no kind as a token (ManageToken passes chainId and tick only)', () => {
        expect(historyScopeForAsset({ chainId: DOGE, tick: 'P00P' }))
            .toEqual({ chainCoin: 'dogecoin', searchQuery: 'P00P' });
    });

    it('is total over a missing ref', () => {
        expect(historyScopeForAsset(null)).toEqual({ chainCoin: '', searchQuery: '' });
        expect(historyScopeForAsset({})).toEqual({ chainCoin: '', searchQuery: '' });
    });

    it('keeps the token rows and drops the parent chain transfer when applied', () => {
        const rows = [
            entry({ actionIndex: 2058, action: 'ISSUE', raw: { tick: 'P00P' } }),
            entry({ actionIndex: 2059, action: 'SEND', raw: { tick: 'P00P', amount: '1' } }),
            // A plain DOGE transfer from two weeks earlier: no tick in its payload.
            entry({ actionIndex: 1, action: 'SEND', timestamp: 1788600000, raw: { amount: '5' } }),
        ];
        const scope = historyScopeForAsset({ chainId: DOGE, tick: 'P00P', kind: 'token' });
        const kept = applyHistoryFilters(rows, { searchQuery: scope.searchQuery });
        expect(kept.map((e) => e.actionIndex)).toEqual(['2058', '2059']);
    });

    it('keeps the plain transfer for the native coin page', () => {
        const rows = [
            entry({ actionIndex: 2059, action: 'SEND', raw: { tick: 'P00P', amount: '1' } }),
            entry({ actionIndex: 1, action: 'SEND', raw: { amount: '5' } }),
        ];
        const scope = historyScopeForAsset({ chainId: DOGE, tick: 'DOGE', kind: 'native' });
        const kept = applyHistoryFilters(rows, { searchQuery: scope.searchQuery });
        expect(kept).toHaveLength(2);
    });
});
