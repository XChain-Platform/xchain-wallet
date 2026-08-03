// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SSC-7: the pre-unlock guards live in native storage on the native shells.
//
// Three records are read on the Locked screen, before the vault password
// exists: the failed-attempt ladder, the duress passphrase hash, and the
// panic-mode freeze. They cannot go in the vault (it is not open yet), which
// is why they were in localStorage.  §3 is the reason they cannot STAY
// there on a native shell: WebView storage is evictable, and each of these
// fails silently when it disappears.
//
//   lockout  an evicted ladder resets to zero, so a stolen device gets
//            unlimited password guesses at full speed
//   duress   an evicted record disarms a passphrase the user believes is
//            armed, and they find out by typing it in front of the person
//            they armed it for
//   panic    an evicted freeze un-freezes signing
//
// All three ride in ONE native slot rather than three, so the whole set is
// one plugin round-trip at boot and one read-modify-write per change; three
// slots would have cost nine plugin methods for no separation that matters.
//
// The three flows keep their own contracts. This module owns the blob, hands
// each flow a `{ load, save, clear }` view over its own sub-key, and
// serialises every write so two views cannot lose each other's update.

import { flows } from '@xchain-wallet/core';
import { CapacitorGuardBackend } from './CapacitorStorageBackend.js';
import { usingNativeVault } from './backends.js';

const SLOTS = /** @type {const} */ (['lockout', 'duress', 'panic']);

/** The localStorage keys this store supersedes, in slot order. */
const LEGACY_KEYS = {
    lockout: flows.LOCKOUT_STORAGE_KEY,
    duress: flows.DURESS_STORAGE_KEY,
    panic: flows.PANIC_STORAGE_KEY,
};

/** @type {Record<string, unknown> | null} */
let cache = null;
/** @type {CapacitorGuardBackend | null} */
let backend = null;
// Every write chains onto this, so a lockout save and a duress save issued in
// the same tick serialise instead of racing one read-modify-write against
// another and dropping whichever landed first.
let writeChain = Promise.resolve();

function legacyStorage() {
    try {
        if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
            return globalThis.localStorage;
        }
    } catch (_err) { /* SecurityError; treat as absent */ }
    return null;
}

/**
 * Adopt any records the WebView store already holds.
 *
 * Without this the fix would cause the exact failure it exists to prevent:
 * an existing install's duress passphrase lives in localStorage, the native
 * slot starts empty, and the first boot after the upgrade would read the
 * empty slot and report "no duress passphrase configured" while the real one
 * sat untouched a few bytes away. Adopt first, write natively, and only then
 * remove the legacy copy - in that order, so an interrupted migration leaves
 * the record readable by the OLD code path rather than by neither.
 *
 * @param {Record<string, unknown>} into
 * @returns {string[]} the slots adopted
 */
function adoptLegacyRecords(into) {
    const store = legacyStorage();
    if (!store) return [];
    const adopted = [];
    for (const slot of SLOTS) {
        if (into[slot] != null) continue;        // native already wins
        let raw = null;
        try { raw = store.getItem(LEGACY_KEYS[slot]); } catch (_err) { continue; }
        if (!raw) continue;
        try {
            into[slot] = JSON.parse(raw);
            adopted.push(slot);
        } catch (_err) { /* unparseable legacy record: nothing to adopt */ }
    }
    return adopted;
}

/** @param {string[]} slots */
function dropLegacyRecords(slots) {
    const store = legacyStorage();
    if (!store) return;
    for (const slot of slots) {
        try { store.removeItem(LEGACY_KEYS[slot]); } catch (_err) { /* ignore */ }
    }
}

/**
 * A `{ load, save, clear }` view over one sub-key of the shared blob.
 * @param {'lockout'|'duress'|'panic'} slot
 */
function viewFor(slot) {
    const mutate = (value) => {
        writeChain = writeChain.then(async () => {
            if (!cache || !backend) return;
            if (value === undefined) delete cache[slot];
            else cache[slot] = value;
            await backend.save(cache);
        }).catch(() => { /* best-effort; the flow's own cache is authoritative */ });
        return writeChain;
    };
    return {
        load: async () => (cache ? cache[slot] ?? null : null),
        save: (value) => mutate(value),
        clear: () => mutate(undefined),
    };
}

/**
 * Install native persistence for all three guards and hydrate their caches.
 *
 * AWAIT this before React mounts. All three flows read synchronously, so an
 * unhydrated cache does not degrade gracefully: it answers "no lockout, no
 * duress, no freeze", which is the permissive answer to all three questions.
 *
 * No-op in a browser, the extension, and the desktop renderer, which keep
 * localStorage: their storage is not evictable in the way iOS's is, and the
 * extension already routes panic mode through chrome.storage.local for its
 * own reason (cross-context visibility, not durability).
 *
 * @returns {Promise<boolean>} whether native persistence was installed
 */
export async function installNativeGuardPersistence() {
    if (!usingNativeVault()) return false;
    backend = new CapacitorGuardBackend();

    let loaded = null;
    try {
        loaded = await backend.load();
    } catch (_err) {
        // The slot is unreadable. Fall back to leaving the flows on
        // localStorage rather than switching them to a store that cannot
        // answer: an inert duress passphrase is worse than an evictable one.
        backend = null;
        return false;
    }

    cache = (loaded && typeof loaded === 'object') ? { ...loaded } : {};
    const adopted = adoptLegacyRecords(cache);
    if (adopted.length > 0) {
        try {
            await backend.save(cache);
            dropLegacyRecords(adopted);
        } catch (_err) {
            // Migration write failed: leave the legacy copies in place. The
            // flows below still hydrate from `cache`, so the records work
            // this session, and the next boot retries the adoption.
        }
    }

    await flows.configureLockoutPersistence(viewFor('lockout'));
    await flows.configureDuressPersistence(viewFor('duress'));
    await flows.configurePanicModePersistence(viewFor('panic'));
    return true;
}

/** Test seam: forget the installed store. */
export function __resetNativeGuardsForTests() {
    cache = null;
    backend = null;
    writeChain = Promise.resolve();
}
