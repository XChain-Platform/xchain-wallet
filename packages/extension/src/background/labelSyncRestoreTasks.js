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

let nextTaskId = 1;
const tasks = new Map();

/**
 * @param {{ walletId: string, run: () => Promise<any> }} opts
 * @returns {string}
 */
export function startLabelSyncRestoreTask({ walletId, run }) {
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('startLabelSyncRestoreTask: walletId is required');
    }
    if (typeof run !== 'function') {
        throw new Error('startLabelSyncRestoreTask: run is required');
    }
    for (const [token, task] of tasks) {
        if (task.settled) tasks.delete(token);
    }
    const token = `${walletId}:${nextTaskId++}`;
    const task = { settled: false, promise: null };
    const promise = Promise.resolve()
        .then(run)
        .catch((err) => {
            console.error('[xchain-wallet] label-sync restore skipped:', err);
            return null;
        })
        .finally(() => { task.settled = true; });
    task.promise = promise;
    tasks.set(token, task);
    return token;
}

/**
 * @param {string} token
 * @returns {Promise<any>}
 */
export async function waitForLabelSyncRestoreTask(token) {
    if (typeof token !== 'string' || token.length === 0) {
        throw new Error('wallet.labelSyncRestoreResult: token is required');
    }
    const task = tasks.get(token);
    if (!task) return null;
    try {
        return await task.promise;
    } finally {
        tasks.delete(token);
    }
}
