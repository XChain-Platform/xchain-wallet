// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Outcomes of sends that settle after a lock closed the vault.
//
// A lock never waits for a send: it closes the vault while the send is still
// signing or broadcasting, the send carries on, and its last write to its
// pending record fails. Without this store the record stays at 'broadcasting'
// and the surface that sent it shows Unlock with no word of the outcome.
//
// Each entry is a small non-secret note (record id, wallet id, chain, txid,
// amount and the kind of outcome), never keys, signed bytes or a PSBT. The
// next host to open the vault finishes the record from it, and the unlocked
// surface reads it back to say what happened.
//
// Kept outside every host: a lock tears its host down, and the next unlock
// builds another. chrome.storage.session holds it in the extension, so a
// worker Chrome stops while the wallet is locked still has it at unlock, and it
// clears when the browser closes. Shells without it (desktop main, the web
// page) keep it in this module, which every host the process builds shares.

const SESSION_KEY = 'xchain.lockedSendOutcomes';

/** The one in-process copy for shells without chrome.storage.session. */
const memoryArea = (() => {
    const items = {};
    return {
        get: (key, cb) => cb({ [key]: items[key] }),
        set: (patch, cb) => { Object.assign(items, JSON.parse(JSON.stringify(patch))); cb(); },
    };
})();

// Every store over one area shares one write chain, so a torn-down host
// recording an outcome and the next host finishing one never interleave a
// read and a write.
const chains = new WeakMap();

/**
 * @typedef {'sent' | 'queued' | 'failed' | 'unsent'} LockedSendOutcomeKind
 *   sent: the network took it. queued: the network could not be reached and the
 *   signed send waits in the send queue. failed: the network refused it.
 *   unsent: it stopped before it was sent.
 *
 * @typedef {Object} LockedSendOutcome
 * @property {string} id
 * @property {string} pendingTxId
 * @property {string} walletId
 * @property {string|null} chainId
 * @property {string|null} txid
 * @property {string|null} amount
 * @property {string|null} tick
 * @property {LockedSendOutcomeKind} kind
 * @property {number} at              epoch ms the send settled
 * @property {boolean} finished       the pending record has been finished from it
 * @property {string|null} [summary]  the record's plain-English summary, read once the vault is open
 */

/**
 * @param {{ area?: { get: Function, set: Function } | null }} [opts]
 *   a chrome.storage-style area; defaults to chrome.storage.session, else this module's memory
 */
export function createLockedSendOutcomeStore(opts = {}) {
    const area = opts.area
        ?? (typeof chrome !== 'undefined' && chrome?.storage?.session ? chrome.storage.session : memoryArea);

    const load = () => new Promise((resolve) => {
        try {
            area.get(SESSION_KEY, (items) => {
                const value = items?.[SESSION_KEY];
                resolve(Array.isArray(value) ? value.filter((e) => e && typeof e.id === 'string') : []);
            });
        } catch { resolve([]); }
    });
    const save = (entries) => new Promise((resolve) => {
        try { area.set({ [SESSION_KEY]: entries }, () => resolve()); } catch { resolve(); }
    });
    /** @param {(entries: LockedSendOutcome[]) => LockedSendOutcome[] | Promise<LockedSendOutcome[]>} change */
    const mutate = (change) => {
        const tail = chains.get(area) ?? Promise.resolve();
        const run = tail.then(async () => {
            const next = await change(await load());
            await save(next);
            return next;
        });
        chains.set(area, run.catch(() => {}));
        return run;
    };

    return {
        /** @returns {Promise<LockedSendOutcome[]>} */
        list: load,
        /** @param {LockedSendOutcome} entry */
        record: (entry) => mutate((entries) => [
            ...entries.filter((e) => e.pendingTxId !== entry.pendingTxId),
            entry,
        ]),
        update: mutate,
        /** @param {string[]} ids */
        remove: (ids) => mutate((entries) => entries.filter((e) => !ids.includes(e.id))),
    };
}

const PRE_BROADCAST = new Set(['composing', 'awaiting-signature', 'signed']);

/**
 * The fields that finish a pending record from an outcome, or null when the
 * record already reads as far as the outcome goes (a watcher saw it confirm, or
 * a later write landed).
 *
 * @param {LockedSendOutcome} entry
 * @param {{ status?: string, txid?: string|null }} record
 * @returns {object|null}
 */
export function finishPatchFor(entry, record) {
    const status = record?.status;
    if (entry.kind === 'sent') {
        if (status === 'indexed' || status === 'broadcast') return null;
        return {
            status: 'broadcast',
            txid: entry.txid ?? record.txid ?? null,
            broadcastAt: new Date(entry.at).toISOString(),
        };
    }
    if (entry.kind === 'queued') {
        if (!PRE_BROADCAST.has(status) && status !== 'broadcasting') return null;
        return { status: 'queued', txid: entry.txid ?? record.txid ?? null };
    }
    if (entry.kind === 'failed') {
        if (!PRE_BROADCAST.has(status) && status !== 'broadcasting') return null;
        return { status: 'failed' };
    }
    // An unsent send stopped before its checkpoint; a record that reached
    // 'broadcasting' may have gone out, so only an earlier status is closed.
    if (!PRE_BROADCAST.has(status)) return null;
    return { status: 'failed' };
}
