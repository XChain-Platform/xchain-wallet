// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// projectQueries: read-only wrapper over the explorer's project
// registry endpoint (`sdk.getProject` -> /api/project/{TICK}). Backs
// the ProjectRosterForm's current-roster prefill. A project with no
// published roster is a normal state; the explorer 400s it, which we
// map to null rather than an error.

/**
 * Fetch a project's current roster. Returns
 * `{ tick, roster_action_index, link_action_index, total, members: [{tick, ...}] }`
 * or null when the project has no valid roster yet.
 *
 * @param {{ sdkRegistry: any, chainId: string, tick: string }} params
 */
export async function getProjectForTick({ sdkRegistry, chainId, tick }) {
    if (!sdkRegistry) throw new Error('getProjectForTick: sdkRegistry is required');
    if (!chainId) throw new Error('getProjectForTick: chainId is required');
    if (typeof tick !== 'string' || tick.length === 0) {
        throw new Error('getProjectForTick: tick is required');
    }
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getProject !== 'function') return null;
    try {
        return await sdk.getProject(tick.toUpperCase());
    } catch (err) {
        // No-roster (or unknown tick) comes back as an explorer 400/404;
        // both mean "nothing published yet" to the form.
        const status = /** @type {any} */ (err)?.status
            ?? /** @type {any} */ (err)?.response?.status;
        if (status === 400 || status === 404) return null;
        if (/HTTP (400|404)|not found/i.test(/** @type {any} */ (err)?.message || '')) return null;
        throw err;
    }
}
