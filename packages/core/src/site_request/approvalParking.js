// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function createApprovalParking({
    newId,
    timeoutMs = 300000,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
} = {}) {
    if (typeof newId !== 'function') throw new TypeError('newId must be a function');

    const parked = new Map();
    const listeners = new Set();

    const notify = () => {
        for (const listener of [...listeners]) listener();
    };

    const settle = (id, result) => {
        const entry = parked.get(id);
        if (!entry) return false;

        parked.delete(id);
        clearTimer(entry.timer);
        entry.settlePromise(result);
        notify();
        return true;
    };

    return {
        park(kind, payload) {
            const id = newId();
            let settlePromise;
            const promise = new Promise((resolve) => {
                settlePromise = resolve;
            });
            const entry = { id, kind, payload, settlePromise, timer: undefined };
            parked.set(id, entry);
            entry.timer = setTimer(() => settle(id, { approved: false }), timeoutMs);
            notify();
            return promise;
        },

        fetch(id) {
            const entry = parked.get(id);
            return entry ? { id: entry.id, kind: entry.kind, payload: entry.payload } : null;
        },

        list() {
            return [...parked.values()].map(({ id, kind, payload }) => ({ id, kind, payload }));
        },

        resolve(id, result) {
            return settle(id, result);
        },

        cancelAll() {
            let count = 0;
            for (const id of [...parked.keys()]) {
                if (settle(id, { approved: false })) count += 1;
            }
            return count;
        },

        cancelOriginsMatching(matches) {
            if (typeof matches !== 'function') throw new TypeError('matches must be a function');

            let count = 0;
            for (const entry of [...parked.values()]) {
                if (matches(entry.payload?.origin) && settle(entry.id, { approved: false })) count += 1;
            }
            return count;
        },

        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
