// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MV3 confirm-modal persistence ( §5.4).
//
// Chrome may kill the MV3 service worker after ~30s perceived idle - shorter
// than reading warnings + typing a password + waking a hardware device. The
// keep-alive port cannot outlast Chrome's hard MV3 ceiling, so the primary
// mechanism is `chrome.storage.session` persistence of the in-flight confirm
// request PLUS the §4.7 reservation ledger, with modal rehydration on SW
// restart. `chrome.storage.session` (unlike `.local`) clears on browser
// close, which is exactly right for approve-not-yet-broadcast state.
//
// The stored payload is SELF-CONTAINED (`{ request, composed, report }` with
// the composed PSBT hex, not a reference) so a killed-and-restarted SW can
// rehydrate the modal to its last state WITHOUT re-composing - re-composing
// would break the byte-identity guarantee (a new UTXO selection).
//
// Falls back to null when chrome.storage.session is unreachable (Node tests,
// non-extension shells), so the host uses in-memory only.

const REQUEST_KEY = 'xchain.confirmAction';
const RESERVATION_KEY = 'xchain.reservationLedger';

/**
 * @typedef {{ id: string, request: object, composed: object, report: object|null }} ConfirmSession
 */

/**
 * @typedef {Object} ConfirmActionSessionStorage
 * @property {() => Promise<Record<string, ConfirmSession>>} loadSessions
 * @property {(id: string, session: ConfirmSession) => Promise<void>} putSession
 * @property {(id: string) => Promise<void>} removeSession
 * @property {() => Promise<Array<object>>} loadReservations
 * @property {(entries: Array<object>) => Promise<void>} saveReservations
 */

/**
 * @returns {ConfirmActionSessionStorage | null}
 */
export function createConfirmActionSessionStorage() {
    if (typeof chrome === 'undefined' || !chrome?.storage?.session) return null;
    const area = chrome.storage.session;

    const get = (key) => new Promise((resolve) => {
        try { area.get(key, (items) => resolve(items?.[key])); } catch { resolve(undefined); }
    });
    const set = (key, value) => new Promise((resolve) => {
        try { area.set({ [key]: value }, () => resolve()); } catch { resolve(); }
    });

    return {
        async loadSessions() {
            const v = await get(REQUEST_KEY);
            return (v && typeof v === 'object') ? v : {};
        },
        async putSession(id, session) {
            const all = await this.loadSessions();
            all[id] = session;
            await set(REQUEST_KEY, all);
        },
        async removeSession(id) {
            const all = await this.loadSessions();
            if (all[id]) { delete all[id]; await set(REQUEST_KEY, all); }
        },
        async loadReservations() {
            const v = await get(RESERVATION_KEY);
            return Array.isArray(v) ? v : [];
        },
        async saveReservations(entries) {
            await set(RESERVATION_KEY, Array.isArray(entries) ? entries : []);
        },
    };
}

/**
 * A ReservationStore (the { load, save } contract createReservationLedger
 * accepts) backed by this session storage. The extension host passes this to
 * createReservationLedger so reservations survive the SW kill.
 *
 * @param {ConfirmActionSessionStorage} storage
 * @returns {{ load: () => Promise<Array<object>>, save: (e: Array<object>) => Promise<void> }}
 */
export function reservationStoreFrom(storage) {
    return {
        load: () => storage.loadReservations(),
        save: (entries) => storage.saveReservations(entries),
    };
}

export { REQUEST_KEY, RESERVATION_KEY };
