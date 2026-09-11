// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Custom chain registry: §9.7 / Cluster Q FOLLOWUP 2.
//
// Developer Mode lets a user plug in a non-bundled chain at runtime by
// supplying a full ChainDescriptor JSON blob. The wallet validates the
// descriptor against the bundled validator, persists it under
// `settings.customChains`, and registers it with the running
// ChainRegistry. On the next SW / renderer boot, createBackgroundHost
// re-seeds the registry from the persisted list.
//
// Flow surface (used by createBackgroundHost handlers):
//   - listCustomChains({ vault })
//       Returns the persisted descriptor list (a copy; mutating the
//       returned array is safe).
//   - addCustomChain({ vault, chainRegistry, descriptor, sdkRegistry })
//       Validates → checks for collisions against bundled + already-
//       persisted ids → persists → registers. Returns the descriptor.
//       Throws on validation failure / duplicate id.
//   - removeCustomChain({ vault, chainRegistry, chainId, sdkRegistry })
//       Removes from settings + ChainRegistry. Bundled chains can't be
//       removed (the registry's removeCustom enforces this). Returns
//       `{ removed: boolean }`.
//
// Both mutators drop the chain's cached SDK client. SDKRegistry caches one
// instance per chainId and `get()` returns it before it re-reads the
// descriptor, so removing a chain and re-adding the same id with different
// endpoints kept dialling the ORIGINAL node, signed submissions included,
// with no self-heal short of a restart: a settings save carrying no
// endpoint override reports `changed: []` and tears nothing down.
// `sdkRegistry` is optional so callers that hold none still work; the host
// routes pass it.
//
// Per-descriptor validation re-runs at write time so a user can paste a
// JSON descriptor without trusting that the source verified the shape.
// The settings-schema validator only enforces "array of plain objects"
// because a future ChainDescriptor schema bump should not retroactively
// invalidate already-persisted records; the registry's own validator
// is the single source of truth for "is this descriptor usable?".

import { validateChainDescriptor } from '../registry/validate.js';

async function readSettings(vault) {
    try { return await vault.settings.get(); } catch { return null; }
}

async function writeSettings(vault, next) {
    await vault.settings.put(next);
}

function asList(settings) {
    const list = settings?.customChains;
    return Array.isArray(list) ? list.slice() : [];
}

/**
 * Persisted custom-chain descriptors, in insertion order.
 *
 * @param {{ vault: any }} args
 * @returns {Promise<object[]>}
 */
export async function listCustomChains({ vault }) {
    const settings = await readSettings(vault);
    return asList(settings);
}

/**
 * Validate, persist, and register a user-supplied ChainDescriptor.
 *
 * @param {{ vault: any, chainRegistry: any, descriptor: object, sdkRegistry?: any }} args
 * @returns {Promise<{ descriptor: object }>}
 */
export async function addCustomChain({ vault, chainRegistry, descriptor, sdkRegistry }) {
    if (!descriptor || typeof descriptor !== 'object') {
        throw new Error('addCustomChain: descriptor must be an object');
    }
    const res = validateChainDescriptor(descriptor);
    if (!res.ok) {
        throw new Error(`addCustomChain: invalid descriptor: ${res.errors.join('; ')}`);
    }
    if (chainRegistry?.has?.(descriptor.id)) {
        throw new Error(`addCustomChain: chain "${descriptor.id}" is already registered`);
    }
    const settings = await readSettings(vault);
    if (!settings) {
        throw new Error('addCustomChain: settings store unavailable');
    }
    const list = asList(settings);
    if (list.some((d) => d?.id === descriptor.id)) {
        // Persisted but not yet seeded; re-seed and bail. This branch
        // covers the edge case where a previous boot persisted but the
        // registry seed step failed or was skipped.
        try { chainRegistry?.addCustom?.(descriptor); } catch { /* idempotent */ }
        dropCachedSdk(sdkRegistry, descriptor.id);
        return { descriptor };
    }
    // Persist first; if the addCustom call throws (race against another
    // handler that just registered the same id), the persisted record
    // is rolled back below.
    const next = { ...settings, customChains: [...list, descriptor] };
    await writeSettings(vault, next);
    try {
        chainRegistry.addCustom(descriptor);
    } catch (err) {
        // Roll back the persisted record so the next boot doesn't try
        // to seed an already-rejected descriptor.
        const rolled = { ...next, customChains: list };
        await writeSettings(vault, rolled);
        throw err;
    }
    // Only after the registration stands: the rollback path above leaves
    // the descriptor unregistered, so there is nothing to rebuild from.
    dropCachedSdk(sdkRegistry, descriptor.id);
    return { descriptor };
}

/**
 * Drop a chain's cached SDK client so the next `get()` rebuilds it from
 * the current descriptor. Tolerates a caller that passes no registry, and
 * a registry that predates `invalidate`; a chain with no live instance is
 * already a no-op inside `invalidate` itself.
 *
 * @param {any} sdkRegistry
 * @param {string} chainId
 */
function dropCachedSdk(sdkRegistry, chainId) {
    if (typeof sdkRegistry?.invalidate !== 'function') return;
    try { sdkRegistry.invalidate(chainId); } catch { /* never fail the mutation on a cache drop */ }
}

/**
 * @param {{ vault: any, chainRegistry: any, chainId: string, sdkRegistry?: any }} args
 * @returns {Promise<{ removed: boolean }>}
 */
export async function removeCustomChain({ vault, chainRegistry, chainId, sdkRegistry }) {
    if (typeof chainId !== 'string' || !chainId) {
        throw new Error('removeCustomChain: chainId is required');
    }
    const settings = await readSettings(vault);
    if (!settings) {
        throw new Error('removeCustomChain: settings store unavailable');
    }
    const list = asList(settings);
    const next = list.filter((d) => d?.id !== chainId);
    const persistedRemoved = next.length !== list.length;
    if (persistedRemoved) {
        await writeSettings(vault, { ...settings, customChains: next });
    }
    let registryRemoved = false;
    try {
        registryRemoved = Boolean(chainRegistry?.removeCustom?.(chainId));
    } catch (_err) {
        // Bundled chains throw; surface a friendlier error if the
        // user tried to remove one. Otherwise rethrow.
        if (chainRegistry?.has?.(chainId)) {
            throw new Error(
                `removeCustomChain: "${chainId}" is a bundled chain and cannot be removed`,
            );
        }
        throw _err;
    }
    if (persistedRemoved || registryRemoved) dropCachedSdk(sdkRegistry, chainId);
    return { removed: persistedRemoved || registryRemoved };
}
