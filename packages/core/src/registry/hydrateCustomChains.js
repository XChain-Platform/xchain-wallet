// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Per-realm hydration of user-added (custom) chains from the Settings
// record (§9.7 Developer Mode). The background host seeds the registry
// instance IT holds; the MV3 popup, the approval window and the desktop
// renderer each run in a separate JS realm with their own
// `defaultRegistry()` singleton, so a registry-derived surface in those
// realms (endpoint editor, regtest blocks, chain pickers) never learns a
// persisted custom chain unless the UI realm installs it too. The web
// shell shares one realm between host and UI, so every descriptor is
// already present there and this is a no-op under the `has()` guard.

import { customChainReservedIdError, validateChainDescriptor } from './validate.js';

/**
 * Install every descriptor in `settings.customChains` that `registry`
 * does not know yet. Never throws: a corrupt or invalid persisted row is
 * skipped so a settings read can never break the surface that made it.
 *
 * @param {{ has: (id: string) => boolean, addCustom: (d: object) => void } | null | undefined} registry
 * @param {{ customChains?: unknown } | null | undefined} settings
 * @returns {{ added: string[] }}
 */
export function hydrateCustomChainsFromSettings(registry, settings) {
    /** @type {string[]} */
    const added = [];
    if (!registry || typeof registry.has !== 'function' || typeof registry.addCustom !== 'function') {
        return { added };
    }
    const list = Array.isArray(settings?.customChains) ? settings.customChains : [];
    for (const descriptor of list) {
        try {
            if (!descriptor || typeof descriptor !== 'object') continue;
            if (typeof descriptor.id !== 'string') continue;
            if (registry.has(descriptor.id)) continue;
            registry.addCustom(descriptor);
            added.push(descriptor.id);
        } catch {
            // Skip the row: the validator rejects it against this build, or
            // a concurrent install already claimed the id.
        }
    }
    return { added };
}

/**
 * Stable text for a descriptor, ignoring key order and the registry's own
 * `isUserAdded` flag, so a stored row and an installed entry compare equal
 * when they describe the same chain.
 *
 * @param {unknown} value
 * @returns {string}
 */
function canonicalDescriptor(value) {
    const walk = (node) => {
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') {
            return Object.fromEntries(Object.keys(node).sort().map((key) => [key, walk(node[key])]));
        }
        return node;
    };
    const { isUserAdded: _flag, ...rest } = /** @type {Record<string, unknown>} */ (value);
    return JSON.stringify(walk(rest));
}

/**
 * Make `registry`'s user-added chains match `settings.customChains`: the
 * first stored row per id that this build installs at boot is the wanted
 * chain. Missing ones are installed, user-added ones the record no longer
 * lists are removed, and one whose descriptor changed is swapped. Bundled
 * entries are never touched.
 *
 * A record without a `customChains` array changes nothing: a settings read
 * that fell back to defaults carries no list, which is not an empty list.
 * Never throws.
 *
 * @param {{ has: Function, get: Function, supportedChains: Function, addCustom: Function, removeCustom: Function } | null | undefined} registry
 * @param {{ customChains?: unknown } | null | undefined} settings
 * @returns {{ added: string[], removed: string[], replaced: string[] }}
 */
export function reconcileCustomChainsFromSettings(registry, settings) {
    /** @type {{ added: string[], removed: string[], replaced: string[] }} */
    const out = { added: [], removed: [], replaced: [] };
    const complete = ['has', 'get', 'supportedChains', 'addCustom', 'removeCustom']
        .every((name) => typeof registry?.[name] === 'function');
    if (!complete || !Array.isArray(settings?.customChains)) return out;
    const wanted = new Map();
    for (const row of settings.customChains) {
        if (!row || typeof row !== 'object' || typeof row.id !== 'string' || wanted.has(row.id)) continue;
        if (!validateChainDescriptor(row).ok || customChainReservedIdError(row)) continue;
        wanted.set(row.id, row);
    }
    try {
        for (const entry of registry.supportedChains()) {
            if (!entry?.isUserAdded) continue;
            const row = wanted.get(entry.id);
            if (row && canonicalDescriptor(row) === canonicalDescriptor(entry)) continue;
            registry.removeCustom(entry.id);
            (row ? out.replaced : out.removed).push(entry.id);
        }
    } catch {
        // A registry that refuses a removal keeps what it has.
    }
    for (const [id, row] of wanted) {
        try {
            if (registry.has(id)) continue;
            registry.addCustom(row);
            if (!out.replaced.includes(id)) out.added.push(id);
        } catch {
            // The validator rejects it against this build, or a concurrent install claimed the id.
        }
    }
    return out;
}

/**
 * Remove every user-added chain while preserving bundled descriptors.
 * Never throws, including for an incomplete registry.
 *
 * @param {Parameters<typeof reconcileCustomChainsFromSettings>[0]} registry
 * @returns {{ removed: string[] }}
 */
export function clearUserAddedChains(registry) {
    const { removed } = reconcileCustomChainsFromSettings(registry, { customChains: [] });
    return { removed };
}

/**
 * A UI realm's answer to a custom-chain change made elsewhere: re-read the
 * saved settings, reconcile this realm's registry, and hand the record on.
 * The latest call wins, so a slow read started before a newer one never
 * overwrites its result; a failed read (a locked wallet) changes nothing.
 *
 * @param {{
 *   registry: Parameters<typeof reconcileCustomChainsFromSettings>[0],
 *   getSettings: () => Promise<unknown>,
 *   onSettings?: (settings: Record<string, unknown>) => void,
 *   onChainsDropped?: (result: { removed: string[], replaced: string[] }) => void,
 * }} deps
 * @returns {() => Promise<{ added: string[], removed: string[], replaced: string[] } | null>}
 */
export function createCustomChainSync({ registry, getSettings, onSettings, onChainsDropped }) {
    let latest = 0;
    return async function syncCustomChains() {
        latest += 1;
        const mine = latest;
        let settings;
        try {
            settings = await getSettings();
        } catch {
            return null;
        }
        if (mine !== latest || !settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
        const result = reconcileCustomChainsFromSettings(registry, /** @type {any} */ (settings));
        try { onSettings?.(/** @type {Record<string, unknown>} */ (settings)); } catch { /* a listener never breaks the sync */ }
        if (result.removed.length || result.replaced.length) {
            try { onChainsDropped?.(result); } catch { /* as above */ }
        }
        return result;
    };
}
