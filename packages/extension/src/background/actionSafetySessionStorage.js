// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Persist approval reservations and claimed transaction inputs across an MV3
// worker restart. Both records are session-scoped so closing the browser drops
// stale work that no longer has an approval surface behind it.

const RESERVATION_KEY = 'xchain.reservationLedger';
const OWN_SPENDS_KEY = 'xchain.ownSpends';

/**
 * @typedef {Object} ActionSafetySessionStorage
 * @property {() => Promise<Array<object>>} loadReservations
 * @property {(entries: Array<object>) => Promise<void>} saveReservations
 * @property {() => Promise<Array<object>>} loadOwnSpends
 * @property {(entries: Array<object>) => Promise<void>} saveOwnSpends
 */

/**
 * Open the extension's session-scoped action safety store.
 *
 * @returns {ActionSafetySessionStorage | null}
 */
export function createActionSafetySessionStorage() {
    if (typeof chrome === 'undefined' || !chrome?.storage?.session) return null;
    const area = chrome.storage.session;

    const get = (key) => new Promise((resolve) => {
        try { area.get(key, (items) => resolve(items?.[key])); } catch { resolve(undefined); }
    });
    const set = (key, value) => new Promise((resolve) => {
        try { area.set({ [key]: value }, () => resolve()); } catch { resolve(); }
    });

    return {
        async loadReservations() {
            const value = await get(RESERVATION_KEY);
            return Array.isArray(value) ? value : [];
        },
        async saveReservations(entries) {
            await set(RESERVATION_KEY, Array.isArray(entries) ? entries : []);
        },
        async loadOwnSpends() {
            const value = await get(OWN_SPENDS_KEY);
            return Array.isArray(value) ? value : [];
        },
        async saveOwnSpends(entries) {
            await set(OWN_SPENDS_KEY, Array.isArray(entries) ? entries : []);
        },
    };
}

/**
 * Adapt session storage to the reservation ledger's load/save contract.
 *
 * @param {ActionSafetySessionStorage} storage
 * @returns {{ load: () => Promise<Array<object>>, save: (entries: Array<object>) => Promise<void> }}
 */
export function reservationStoreFrom(storage) {
    return {
        load: () => storage.loadReservations(),
        save: (entries) => storage.saveReservations(entries),
    };
}

/**
 * Adapt session storage to the own-spend ledger's load/save contract.
 *
 * @param {ActionSafetySessionStorage} storage
 * @returns {{ load: () => Promise<Array<object>>, save: (entries: Array<object>) => Promise<void> }}
 */
export function ownSpendStoreFrom(storage) {
    return {
        load: () => storage.loadOwnSpends(),
        save: (entries) => storage.saveOwnSpends(entries),
    };
}
