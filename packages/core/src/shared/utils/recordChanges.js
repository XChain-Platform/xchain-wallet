// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Record changes: a write to a stored record tells every mounted reader of
// that record's list to read it again. A list stays mounted beside its
// detail in the wide two-panel layout, and under it when a detail pops back
// to the list, so its rows must follow a rename or Set active made there.
//
// Writes are named explicitly, not matched by a name rule: the messaging
// surface has reads without a get/list prefix, and a missed read refetching
// a list on every call is worse than a write that needs adding here.

import { markWalletDataStale } from './walletDataFreshness.js';

/** Each record write the shared screens make, and the record list it changes. */
export const RECORD_WRITES = Object.freeze({
    updateCoSignerAccount: 'cosigner-accounts',
    provisionCoSignerAccount: 'cosigner-accounts',
    setActiveAddress: 'addresses',
    setAddressLabel: 'addresses',
    setAddressHidden: 'addresses',
    deleteAddress: 'addresses',
    restoreAddress: 'addresses',
});

// Writes that change which addresses a balance read covers or heads; saved
// wallet reads go stale with them.
const ADDRESS_SET_WRITES = new Set(['setActiveAddress', 'setAddressHidden', 'deleteAddress', 'restoreAddress']);

/** A tile look saved on this device (walletTile.js), for lists that draw tiles. */
export const TILE_TOPIC = 'tiles';

const listeners = new Set();

/**
 * Tell subscribers a record list changed.
 *
 * @param {string} topic
 */
export function publishRecordChange(topic) {
    if (!topic) return;
    for (const listener of [...listeners]) {
        try {
            listener(topic);
        } catch { /* one subscriber's failure must not block the others */ }
    }
}

/**
 * @param {(topic: string) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeRecordChanges(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

// One wrapper per messaging module, so its identity is stable for every
// effect keyed on it, even across provider remounts.
const wrapped = new WeakMap();

/**
 * The messaging module with each record write publishing its topic once it
 * resolves. Every other member is the module's own, called on the module.
 *
 * The proxy stands on an empty object and forwards to the module, because a
 * production bundle freezes `import * as messaging`, and a proxy over a
 * frozen object may not hand back a different function for a member.
 *
 * @template {object} T
 * @param {T} messaging
 * @returns {T}
 */
export function withRecordChanges(messaging) {
    if (!messaging || typeof messaging !== 'object') return messaging;
    const known = wrapped.get(messaging);
    if (known) return known;
    const writers = new Map();
    const proxy = new Proxy(Object.create(null), {
        get(_standIn, prop) {
            const value = Reflect.get(messaging, prop, messaging);
            const topic = typeof prop === 'string' && Object.prototype.hasOwnProperty.call(RECORD_WRITES, prop) ? RECORD_WRITES[prop] : null;
            if (!topic || typeof value !== 'function') return value;
            // Rebuilt only when the module swaps the function (a test spy).
            const cached = writers.get(prop);
            if (cached && cached.fn === value) return cached.writer;
            const changed = () => {
                if (ADDRESS_SET_WRITES.has(prop)) markWalletDataStale();
                publishRecordChange(topic);
            };
            const writer = function recordWrite(...args) {
                const result = value.apply(messaging, args);
                if (result && typeof result.then === 'function') {
                    result.then(changed, () => {});
                } else {
                    changed();
                }
                return result;
            };
            writers.set(prop, { fn: value, writer });
            return writer;
        },
        set: (_standIn, prop, value) => Reflect.set(messaging, prop, value),
        has: (_standIn, prop) => Reflect.has(messaging, prop),
        ownKeys: () => Reflect.ownKeys(messaging),
        // Reported configurable, as the empty stand-in requires; values still come from get.
        getOwnPropertyDescriptor(_standIn, prop) {
            const descriptor = Reflect.getOwnPropertyDescriptor(messaging, prop);
            return descriptor ? { ...descriptor, configurable: true } : undefined;
        },
        getPrototypeOf: () => Reflect.getPrototypeOf(messaging),
    });
    wrapped.set(messaging, proxy);
    return proxy;
}
