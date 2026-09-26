// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Ask the browser to keep this origin's storage.
//
// Without this call the web wallet's IndexedDB is "best-effort" storage:
// the browser may evict it without asking when disk runs low, and Safari
// purges every script-writable store for a site after seven days without
// interaction. Either one presents to the user as a wallet that reset
// itself and asked for the recovery phrase again. `navigator.storage
// .persist()` moves the origin to the "persistent" bucket where eviction
// needs an explicit user action. Browsers grant it by their own
// heuristics (Chrome: bookmarked, installed, notifications allowed or high
// engagement; Firefox: a prompt) and refuse silently otherwise, so the
// answer is recorded rather than acted on: it is a fact for the diagnostic
// dump, not a gate.
//
// One request per page load. Re-asking on every status refresh would
// re-prompt Firefox users who already said no.

import { logConsole } from '@xchain-wallet/core/shared/utils/logConsole.js';

/** @type {Promise<boolean | null> | null} */
let requested = null;

/**
 * @returns {Promise<boolean | null>} true = persistent, false = refused,
 *   null = the API is not there (or threw), so the origin stays best-effort
 */
export function requestPersistentStorage() {
    if (requested) return requested;
    requested = (async () => {
        const storage = /** @type {any} */ (globalThis.navigator)?.storage;
        if (!storage || typeof storage.persist !== 'function') return null;
        try {
            const already = typeof storage.persisted === 'function'
                ? await storage.persisted()
                : false;
            const granted = already === true ? true : Boolean(await storage.persist());
            logConsole.record({
                source: 'storage',
                level: granted ? 'info' : 'warn',
                message: granted
                    ? 'origin storage is persistent'
                    : 'origin storage is best-effort (persist() refused); the browser may evict the vault',
            });
            return granted;
        } catch (err) {
            logConsole.record({
                source: 'storage',
                level: 'warn',
                message: `persist() failed: ${err?.message || err}`,
            });
            return null;
        }
    })();
    return requested;
}

/** Test seam: forget the once-per-load answer. */
export function __resetPersistenceForTests() {
    requested = null;
}
