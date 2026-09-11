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
