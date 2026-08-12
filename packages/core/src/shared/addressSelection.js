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
 * The external (change=0) index a derivation path ends on, or null when the
 * path is internal or unparseable.
 *
 * Read from the END of the path, never by fixed position. A BIP44 path is
 * m/purpose'/coin'/account'/change/index, so change sat at [4] - but a
 * counterwallet-legacy wallet derives m/0'/change/index, where [4] does not
 * exist at all. Testing position 4 there matched NOTHING, so every form that
 * picks a funding address this way reported that a fully funded legacy wallet
 * had "no address on this chain". The allocating side
 * (flows/receiveAddress.js) already reads change/index end-relative; this is
 * the selecting side agreeing with it.
 *
 * @param {string | undefined} derivationPath
 * @returns {number | null}
 */
export function externalIndexOf(derivationPath) {
    const parts = String(derivationPath || '').split('/');
    // Need at least m / change / index for the tail to mean anything.
    if (parts.length < 3) return null;
    if (parts[parts.length - 2] !== '0') return null;
    const index = Number(parts[parts.length - 1]);
    return Number.isFinite(index) ? index : null;
}

/**
 * Newest HD external address (change-depth 0), highest derivation index.
 * This is the long-standing default these forms used before the active-address
 * model; it remains the fallback when no active address is resolvable.
 *
 * @param {Array<{ id: string, source?: string, derivationPath?: string }>} addresses
 * @returns {string | null} the chosen address id, or null when none qualifies
 */
export function newestHdExternalId(addresses) {
    const hd = (addresses || [])
        .map((a) => ({ a, index: externalIndexOf(a.derivationPath) }))
        .filter(({ a, index }) => a.source === 'hd' && index !== null);
    if (hd.length === 0) return null;
    const sorted = [...hd].sort((x, y) => y.index - x.index);
    return sorted[0].a.id;
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
