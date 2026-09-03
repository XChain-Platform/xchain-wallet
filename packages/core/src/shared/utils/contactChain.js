// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Which coin family a contact entry belongs to. Shared by the Contacts
// route and the Send screen's address book so the two cannot disagree on
// an entry: the same entry showing a Dogecoin badge in one place and
// missing under the Dogecoin filter in the other is exactly the report
// that produced this file.

import { detectAddressCoin } from './addressValidation.js';

const FAMILIES = new Set(['bitcoin', 'litecoin', 'dogecoin']);

/**
 * The coin family an address belongs to, or the user's own answer when the
 * address cannot say. Detection decodes the address (see
 * `detectAddressCoin`), so a Dogecoin testnet address resolves as Dogecoin
 * rather than by its shared leading 'n', which is what filed every such
 * contact under a question mark. Only the genuinely shared version bytes
 * (0x6f, 0xc4: Bitcoin/Litecoin testnet and regtest, Dogecoin regtest) are
 * left to `fallback`, and to 'unknown' when there is none.
 *
 * @param {string} address
 * @param {string | null} [fallback]   a coin family the user picked, if any
 * @returns {string}
 */
export function coinFamilyFor(address, fallback = null) {
    const detected = detectAddressCoin(address);
    if (detected) return detected;
    if (fallback && FAMILIES.has(fallback)) return fallback;
    return 'unknown';
}

/**
 * The chain to draw and filter a STORED contact entry by. Entries saved as
 * 'unknown' by the old first-character heuristic heal here at read time,
 * with no migration: the address bytes still say what they always said.
 *
 * @param {{ chain?: string, address?: string } | null | undefined} entry
 * @returns {string}
 */
export function contactEntryChain(entry) {
    if (entry?.chain && entry.chain !== 'unknown') return entry.chain;
    return coinFamilyFor(entry?.address);
}
