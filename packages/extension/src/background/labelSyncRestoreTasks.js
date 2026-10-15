// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Import responses carry only an opaque token. The follow-up result request
// keeps the transport alive while explorer reads finish and lets onboarding
// continue without putting those reads on the import's critical path.

import { sessionRandomUUID } from './uuid.js';

export const LABEL_SYNC_RESULTS_SESSION_KEY = 'xchain.labelSyncRestoreResults';
const MAX_STORED_RESULTS = 16;

function sessionResultStore(area) {
    let writes = Promise.resolve();

    function read() {
        if (!area?.get) return Promise.resolve({});
        return new Promise((resolve) => {
            let settled = false;
            const finish = (items) => {
                if (settled) return;
                settled = true;
                const stored = items?.[LABEL_SYNC_RESULTS_SESSION_KEY];
                resolve(stored && typeof stored === 'object' ? stored : {});
            };
            try {
                const pending = area.get(LABEL_SYNC_RESULTS_SESSION_KEY, finish);
                if (pending && typeof pending.then === 'function') {
                    pending.then(finish, () => finish({}));
                }
            } catch {
                finish({});
            }
        });
    }

    function write(results) {
        if (!area?.set) return Promise.resolve();
        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            try {
                const pending = area.set({ [LABEL_SYNC_RESULTS_SESSION_KEY]: results }, finish);
                if (pending && typeof pending.then === 'function') {
                    pending.then(finish, finish);
                }
            } catch {
                finish();
            }
        });
    }

    function update(mutator) {
        writes = writes.then(async () => {
            const results = await read();
            await write(mutator({ ...results }));
        }, async () => {
            const results = await read();
            await write(mutator({ ...results }));
        });
        return writes;
    }

    return {
        async put(token, result) {
            await update((results) => {
                results[token] = result;
                const tokens = Object.keys(results);
                while (tokens.length > MAX_STORED_RESULTS) delete results[tokens.shift()];
                return results;
            });
        },
        async take(token) {
            let found = false;
            let value = null;
            await update((results) => {
                if (Object.prototype.hasOwnProperty.call(results, token)) {
                    found = true;
                    value = results[token];
                    delete results[token];
                }
                return results;
            });
            return { found, value };
        },
    };
}

/**
 * Build one worker-local registry backed by session storage for settled results.
 *
 * @param {{ sessionArea?: { get: Function, set: Function }, newId?: () => string }} [deps]
 */
export function createLabelSyncRestoreTaskRegistry(deps = {}) {
    const tasks = new Map();
    const results = sessionResultStore(
        deps.sessionArea ?? globalThis.chrome?.storage?.session ?? null,
    );
    const newId = deps.newId ?? sessionRandomUUID;

    function start({ walletId, run }) {
        if (typeof walletId !== 'string' || walletId.length === 0) {
            throw new Error('startLabelSyncRestoreTask: walletId is required');
        }
        if (typeof run !== 'function') {
            throw new Error('startLabelSyncRestoreTask: run is required');
        }
        for (const [token, task] of tasks) {
            if (task.settled) tasks.delete(token);
        }
        const token = `${walletId}:${newId()}`;
        const task = { settled: false, promise: null };
        const promise = Promise.resolve()
            .then(run)
            .catch((err) => {
                console.error('[xchain-wallet] label-sync restore skipped:', err);
                return null;
            })
            .then(async (result) => {
                await results.put(token, result === undefined ? null : result);
                return result;
            })
            .finally(() => { task.settled = true; });
        task.promise = promise;
        tasks.set(token, task);
        return token;
    }

    async function wait(token) {
        if (typeof token !== 'string' || token.length === 0) {
            throw new Error('wallet.labelSyncRestoreResult: token is required');
        }
        const task = tasks.get(token);
        if (task) {
            try {
                return await task.promise;
            } finally {
                tasks.delete(token);
                await results.take(token);
            }
        }
        const stored = await results.take(token);
        return stored.found ? stored.value : null;
    }

    return { start, wait };
}

const defaultRegistry = createLabelSyncRestoreTaskRegistry();

/**
 * @param {{ walletId: string, run: () => Promise<any> }} opts
 * @returns {string}
 */
export function startLabelSyncRestoreTask(opts) {
    return defaultRegistry.start(opts);
}

/**
 * @param {string} token
 * @returns {Promise<any>}
 */
export function waitForLabelSyncRestoreTask(token) {
    return defaultRegistry.wait(token);
}
