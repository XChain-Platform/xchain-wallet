// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// sleepQueries (PC-05): read the current pause state of a TICK or an
// ADDRESS. SLEEP actions are events (one row per SLEEP), so the current
// state is the MOST RECENT valid SLEEP row evaluated against the chain
// tip: RESUME_BLOCK -1 = paused indefinitely, 0 = resumed, a future
// block = paused until then, a past block = resumed. Backs the pause
// badge and the pause/resume form's current-state display.

/**
 * @typedef {Object} SleepState
 * @property {number | null} resumeBlock   RESUME_BLOCK of the latest SLEEP row (-1, 0, or a height), null when never slept
 * @property {string | null} memo
 * @property {number | null} blockIndex    block the latest SLEEP was mined in
 * @property {number | null} actionIndex
 */

function rowsOf(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    return [];
}

/**
 * Fetch the latest valid SLEEP row for a query (tick name or address)
 * and return its RESUME_BLOCK. Returns `{ resumeBlock: null }` when the
 * target was never slept.
 *
 * @param {{
 *   sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry,
 *   chainId: string,
 *   query: string,
 *   type: 'token' | 'address',
 * }} params
 * @returns {Promise<SleepState>}
 */
export async function sleepStateFor({ sdkRegistry, chainId, query, type }) {
    if (!sdkRegistry) throw new Error('sleepStateFor: sdkRegistry is required');
    if (!chainId) throw new Error('sleepStateFor: chainId is required');
    if (!query) throw new Error('sleepStateFor: query is required');
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getSleeps !== 'function') return { resumeBlock: null, memo: null, blockIndex: null, actionIndex: null };
    const resp = await sdk.getSleeps(String(query), type === 'token' ? 'token' : 'address');
    const rows = rowsOf(resp).filter((r) => String(r.status || 'valid') === 'valid');
    if (rows.length === 0) return { resumeBlock: null, memo: null, blockIndex: null, actionIndex: null };
    // Latest by action_index (monotonic), falling back to block_index.
    rows.sort((a, b) => {
        const ai = Number(a.action_index ?? 0);
        const bi = Number(b.action_index ?? 0);
        if (ai !== bi) return bi - ai;
        return Number(b.block_index ?? 0) - Number(a.block_index ?? 0);
    });
    const latest = rows[0];
    const rb = latest.resume_block ?? latest.resumeBlock;
    return {
        resumeBlock: rb == null || String(rb) === '' ? null : Number(rb),
        memo: latest.memo ?? null,
        blockIndex: latest.block_index != null ? Number(latest.block_index) : null,
        actionIndex: latest.action_index != null ? Number(latest.action_index) : null,
    };
}

/**
 * Interpret a RESUME_BLOCK (from sleepStateFor) against the current
 * chain height into a display state. Pure; the caller supplies height.
 *
 * @param {number | null} resumeBlock
 * @param {number | null} currentHeight
 * @returns {{ paused: boolean, indefinite: boolean, resumeBlock: number | null }}
 */
export function interpretSleep(resumeBlock, currentHeight) {
    if (resumeBlock == null) return { paused: false, indefinite: false, resumeBlock: null };
    if (resumeBlock === -1) return { paused: true, indefinite: true, resumeBlock: -1 };
    if (resumeBlock === 0) return { paused: false, indefinite: false, resumeBlock: 0 };
    // A future block = still paused. With height unknown we can't tell a
    // future block from a passed one, so fail toward "paused" (the honest,
    // safer display for a pause indicator) and let the block number speak.
    if (currentHeight == null) return { paused: true, indefinite: false, resumeBlock };
    return { paused: resumeBlock > currentHeight, indefinite: false, resumeBlock };
}
