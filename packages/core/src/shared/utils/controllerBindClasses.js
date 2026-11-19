// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Toggle one controller action class while preserving the catch-all rule.
 *
 * Selecting `all` replaces every class-specific choice because it covers
 * current and future classes. Selecting a specific class replaces `all`
 * because a specific binding takes precedence for that class.
 *
 * @param {string[]} selected
 * @param {string} actionClass
 * @returns {string[]}
 */
/**
 * Wait until the source address's UTXO view lists an output of `txid`.
 *
 * Binds in one sequence spend from the same address, and the tracker learns
 * about a broadcast asynchronously. Composing the next bind before the change
 * of the previous one is visible would pick the same inputs again and the
 * node would refuse it as a conflict. The wait is bounded: on timeout the
 * caller composes anyway, and a refused broadcast stays retryable.
 *
 * @param {object} opts
 * @param {() => Promise<any>} opts.getUtxos      resolves to an array or `{ utxos: [...] }`
 * @param {string} opts.txid
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.intervalMs]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @returns {Promise<boolean>} true once an output of `txid` is listed
 */
export async function waitForTxOutputsVisible({
    getUtxos,
    txid,
    timeoutMs = 60000,
    intervalMs = 2000,
    sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
}) {
    const wanted = String(txid || '').trim().toLowerCase();
    if (!wanted || typeof getUtxos !== 'function') return false;
    for (let waited = 0; ; waited += intervalMs) {
        try {
            const res = await getUtxos();
            const rows = Array.isArray(res) ? res : (Array.isArray(res?.utxos) ? res.utxos : []);
            if (rows.some((row) => String(row?.txid || row?.tx_hash || '').toLowerCase() === wanted)) return true;
        } catch {
            // A failed read is treated like "not visible yet" until the time runs out.
        }
        if (waited + intervalMs > timeoutMs) return false;
        await sleep(intervalMs);
    }
}

export function toggleActionClass(selected, actionClass) {
    const current = Array.isArray(selected) ? selected : [];
    const value = String(actionClass || '').trim().toLowerCase();
    if (!value) return current;
    if (current.includes(value)) return current.filter((item) => item !== value);
    if (value === 'all') return ['all'];
    return [...current.filter((item) => item !== 'all'), value];
}
