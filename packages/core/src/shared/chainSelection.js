// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shared CHAIN selection for the action forms (the companion of
// addressSelection.js, which picks the address within a chain).
//
// `addresses.byChain` lists chains in address-creation order, so a form
// that opens on its first key opens on the wallet's oldest chain forever,
// whatever the user was just working on. The wallet keeps a last-used
// chain per network in Settings (`lastUsedChain`), written by the
// activity that names a chain (making an address active, submitting an
// action) and read here as the default when the caller passes no chain.

import { defaultRegistry } from '../registry/index.js';
import { getActiveNetwork } from '../flows/effectiveNetwork.js';

/**
 * The chain the user last worked on, for the network the wallet is on.
 * A chain recorded on another network never bleeds through: the slots
 * are keyed by network, and only the active network's slot is read.
 *
 * @param {object | null | undefined} settings
 * @returns {string | null}
 */
export function lastUsedChainIdFor(settings) {
    const v = settings?.lastUsedChain?.[getActiveNetwork(settings)];
    return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Pick the chain an action form opens on. An explicit chain (a prefill,
 * a deep link, a token context) wins outright; otherwise the last-used
 * chain, provided the wallet still has addresses on it; otherwise the
 * first chain with addresses, which is the historic default.
 *
 * @param {Record<string, unknown[]> | null | undefined} byChain  chainId -> addresses
 * @param {{ explicitChainId?: string | null, settings?: object | null }} [opts]
 * @returns {string | null}  null when the wallet has no addresses on any chain
 */
export function pickDefaultChainId(byChain, { explicitChainId = null, settings = null } = {}) {
    if (explicitChainId) return explicitChainId;
    const lastUsed = lastUsedChainIdFor(settings);
    if (lastUsed && Array.isArray(byChain?.[lastUsed]) && byChain[lastUsed].length > 0) {
        return lastUsed;
    }
    return Object.keys(byChain || {})[0] || null;
}

/**
 * The Settings patch that records `chainId` as the last-used chain of
 * its own network, or null when the registry does not know the chain.
 *
 * @param {string | null | undefined} chainId
 * @param {{ get(id: string): { networkKind?: string } | undefined }} [registry]
 * @returns {{ lastUsedChain: Record<string, string> } | null}
 */
export function lastUsedChainPatch(chainId, registry = defaultRegistry()) {
    if (typeof chainId !== 'string' || chainId.length === 0) return null;
    const network = registry?.get(chainId)?.networkKind;
    if (!network) return null;
    return { lastUsedChain: { [network]: chainId } };
}

/**
 * Best-effort write of the last-used chain. Never rejects: the action
 * that triggered it has already succeeded, and a preference write must
 * not turn a done screen into an error.
 *
 * @param {{ updateSettings?: (patch: object) => Promise<unknown> } | null | undefined} messaging
 * @param {string | null | undefined} chainId
 * @returns {Promise<void>}
 */
export async function recordLastUsedChain(messaging, chainId) {
    if (typeof messaging?.updateSettings !== 'function') return;
    const patch = lastUsedChainPatch(chainId);
    if (!patch) return;
    try {
        await messaging.updateSettings(patch);
    } catch {
        // A lost preference write costs one wrong default later, nothing more.
    }
}
