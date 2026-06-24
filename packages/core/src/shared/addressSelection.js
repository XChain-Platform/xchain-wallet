// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shared from-address (SOURCE) selection for spend-from-balance action forms.
//
// An XChain action has a single SOURCE (the owner of the transaction's first
// input), so every "spend my balance" form picks exactly one funding address.
// To keep that choice consistent with Home and Send, these helpers prefer the
// chain's active (operating) address and fall back to the newest HD external
// address. Owner-gated actions (mint, dividend, transfer-ownership, etc.) do
// NOT use these: they must source from the token's owner address instead.

/**
 * Newest HD external address (BIP44 change-depth 0), highest derivation index.
 * This is the long-standing default these forms used before the active-address
 * model; it remains the fallback when no active address is resolvable.
 *
 * @param {Array<{ id: string, source?: string, derivationPath?: string }>} addresses
 * @returns {string | null} the chosen address id, or null when none qualifies
 */
export function newestHdExternalId(addresses) {
    const hd = (addresses || []).filter(
        (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
    );
    if (hd.length === 0) return null;
    const sorted = [...hd].sort((a, b) => (
        Number(b.derivationPath?.split('/')?.[5] ?? -1)
        - Number(a.derivationPath?.split('/')?.[5] ?? -1)
    ));
    return sorted[0].id;
}

/**
 * The active (operating) address id for a chain when it's present in
 * `addresses`. Matches by id first, then by address string (the active map
 * carries both). Returns null when no active address applies to this set.
 *
 * @param {Array<{ id: string, address: string }>} addresses
 * @param {{ id?: string, address?: string } | undefined} activeEntry  getActiveAddresses()[chainId]
 * @returns {string | null}
 */
export function activeSourceId(addresses, activeEntry) {
    const all = addresses || [];
    if (activeEntry?.id && all.some((a) => a.id === activeEntry.id)) return activeEntry.id;
    if (activeEntry?.address) {
        const match = all.find((a) => a.address === activeEntry.address);
        if (match) return match.id;
    }
    return null;
}

/**
 * Preferred funding/source address id for a chain: the active address when
 * resolvable, otherwise the newest HD external address. Mirrors Send's
 * resolution so every spend-from-balance action defaults to the same address.
 *
 * @param {Array<{ id: string, address: string, source?: string, derivationPath?: string }>} addresses
 * @param {{ id?: string, address?: string } | undefined} activeEntry  getActiveAddresses()[chainId]
 * @returns {string | null}
 */
export function preferredSourceId(addresses, activeEntry) {
    return activeSourceId(addresses, activeEntry) || newestHdExternalId(addresses);
}
