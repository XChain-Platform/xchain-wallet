// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One used-address scan at a time, run in the background after a restore or
// from Settings. The import or restore that starts it has already written the
// vault and returned, so the scan never holds up unlock or the first screen.
// Screens read its progress by polling the snapshot below.

/**
 * @typedef {Object} AddressDiscoverySnapshot
 * @property {number} id
 * @property {string[]} walletIds
 * @property {'running' | 'done'} status
 * @property {number} chainsTotal
 * @property {number} chainsDone
 * @property {number} found
 * @property {string[]} failedChains       display names of the chains that did not finish
 * @property {boolean} dismissed
 */

export function createAddressDiscoveryTask() {
    /** @type {AddressDiscoverySnapshot | null} */
    let job = null;
    let nextId = 1;

    const snapshot = () => (job ? { ...job, walletIds: job.walletIds.slice(), failedChains: job.failedChains.slice() } : null);

    /**
     * Start a scan unless one is running, which is returned instead.
     *
     * @param {{ walletIds: string[], run: (walletId: string, onProgress: (event: any) => void) => Promise<unknown>, countChains: (walletId: string) => Promise<number>, chainName?: (chainId: string) => string }} opts
     */
    async function start({ walletIds, run, countChains, chainName = (chainId) => chainId }) {
        if (job && job.status === 'running') return snapshot();
        const current = {
            id: nextId++,
            walletIds: walletIds.slice(),
            status: /** @type {'running' | 'done'} */ ('running'),
            chainsTotal: 0,
            chainsDone: 0,
            found: 0,
            failedChains: /** @type {string[]} */ ([]),
            dismissed: false,
        };
        job = current;
        for (const walletId of walletIds) {
            try {
                current.chainsTotal += await countChains(walletId);
            } catch { /* the count only feeds the progress line */ }
        }
        void (async () => {
            for (const walletId of walletIds) {
                try {
                    await run(walletId, (event) => {
                        if (event?.phase === 'chain-complete' || event?.phase === 'chain-failed') {
                            current.chainsDone += 1;
                            current.found += Number(event.found) || 0;
                            if (event.phase === 'chain-failed') {
                                const name = chainName(event.chainId);
                                if (!current.failedChains.includes(name)) current.failedChains.push(name);
                            }
                        }
                    });
                } catch {
                    // A wallet whose scan could not start reads as one that did not finish.
                    const name = 'this wallet';
                    if (!current.failedChains.includes(name)) current.failedChains.push(name);
                }
            }
            current.chainsDone = Math.max(current.chainsDone, current.chainsTotal);
            current.status = 'done';
        })();
        return snapshot();
    }

    function status() {
        return snapshot();
    }

    function dismiss(id) {
        if (job && job.id === id && job.status === 'done') job.dismissed = true;
        return snapshot();
    }

    return { start, status, dismiss };
}
