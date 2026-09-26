// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// How the History route is scoped when a reader arrives from an asset page
// (TokenDetail or ManageToken, in the web app and the extension popup).
//
// History takes two entry scopes: a chain-coin filter and a free-text search
// (see History.jsx `initialChainCoin` / `initialSearchQuery`). Scoping by coin
// alone shows the whole parent chain, which a tester read as an unrelated
// transaction sitting in their token's history. Scoping by tick alone would
// hide a native coin's plain transfers, which carry no tick in their payload.
// So: every asset scopes to its chain, and a non-native asset also seeds the
// search box with its tick, which the reader can see and clear.

/**
 * @param {{ chainId?: string, tick?: string, kind?: string } | null | undefined} asset
 * @returns {{ chainCoin: string, searchQuery: string }}
 */
export function historyScopeForAsset(asset) {
    const chainId = String(asset?.chainId || '');
    const chainCoin = chainId.split('-')[0] || '';
    const tick = String(asset?.tick || '').trim();
    const native = String(asset?.kind || '') === 'native';
    return { chainCoin, searchQuery: native ? '' : tick };
}
