// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §15.4 backup-pointer resolver, extracted from createBackgroundHost so
// the PRE-HOST fresh-install restore  can use the same one. A
// fresh install has no vault, so it never reaches the host, and a second
// copy of this function is exactly how the two lanes drift on which
// schemes they are willing to fetch.

/**
 * Turn a pointer's `location` into the raw encrypted §19.4 envelope
 * text. Only https locations are fetched: a wallet must not silently
 * reach out to an arbitrary http origin, and on-chain FILE references
 * need SDK wiring that is deliberately left as a follow-up rather than
 * half-implemented here. The envelope is still password-encrypted, so
 * fetching it does not by itself expose funds.
 *
 * @param {{ location?: string }} pointer
 * @returns {Promise<string>}
 */
export async function resolveBackupPointerContent(pointer) {
    const location = pointer?.location;
    if (typeof location !== 'string' || location.trim().length === 0) {
        throw new Error('backup pointer has no location to resolve');
    }
    const loc = location.trim();
    let url;
    try {
        url = new URL(loc);
    } catch {
        throw new Error(`backup pointer location is not a URL: "${loc}". On-chain pointers are not supported yet.`);
    }
    if (url.protocol !== 'https:') {
        throw new Error(`unsupported backup-pointer location scheme "${url.protocol}" (only https is fetched).`);
    }
    if (typeof fetch !== 'function') {
        throw new Error('this shell cannot fetch a backup pointer (no fetch available).');
    }
    const resp = await fetch(url.toString(), { redirect: 'follow' });
    if (!resp.ok) {
        throw new Error(`backup pointer fetch failed: HTTP ${resp.status}`);
    }
    return await resp.text();
}
