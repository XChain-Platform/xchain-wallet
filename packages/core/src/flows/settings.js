// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// settings: read + patch the Settings record. Sits above the
// raw `vault.settings.get/put` primitives so callers don't need to
// reason about the default-vs-persisted state, the schema validator,
// or the deep-merge semantics every time.
//
// Patch model: deep merge.
//   - Top-level scalars (theme, autolockMinutes, language, etc.) are
//     replaced when the patch carries them.
//   - Nested plain objects (privacy, notifications, grace, ads) merge
//     one level deep; caller can flip a single sub-flag without
//     restating the rest.
//   - Chain-keyed records (sdkEndpoints, fees, ads.perChain) merge by
//     chainId; caller updating one chain's endpoint keeps the other
//     chains untouched.
//   - Arrays / primitives / null in the patch always replace.
//
// Validation runs on the merged record before persistence; an invalid
// patch throws and the on-disk record stays untouched.

import {
    createDefaultSettings,
    resolveAdsChainConfig,
    resolveFeeConfig,
    validateSettings,
} from '../schemas/settings.js';
import { defaultRegistry } from '../registry/index.js';

/**
 * Return the persisted Settings record, falling back to the default
 * when no record exists yet (fresh install pre-`ensureSettings`).
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @returns {Promise<import('../schemas/settings.js').Settings>}
 */
export async function getSettings(vault) {
    if (!vault) throw new Error('getSettings: vault is required');
    const current = await vault.settings.get();
    return current ?? createDefaultSettings();
}

/**
 * Apply a deep-merge patch to the current Settings record, validate
 * the result, persist, and return the merged record.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {Record<string, unknown>} patch
 * @returns {Promise<import('../schemas/settings.js').Settings>}
 */
export async function updateSettings(vault, patch) {
    if (!vault) throw new Error('updateSettings: vault is required');
    if (patch === null || typeof patch !== 'object') {
        throw new Error('updateSettings: patch must be an object');
    }
    const current = await getSettings(vault);
    const merged = normalizeChainScopedDefaults(deepMerge(current, patch));
    const validation = validateSettings(merged);
    if (!validation.ok) {
        const detail = (validation.errors ?? [])
            .map((e) => (e?.path ? `${e.path}: ${e.message}` : String(e?.message ?? e)))
            .join('; ');
        throw new Error(`updateSettings: invalid settings: ${detail}`);
    }
    await vault.settings.put(merged);
    return merged;
}

function isPlainObject(v) {
    if (v === null || typeof v !== 'object') return false;
    if (Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}

function deepMerge(base, patch) {
    if (!isPlainObject(patch)) return patch;
    if (!isPlainObject(base)) return { ...patch };
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (isPlainObject(v) && isPlainObject(base[k])) {
            out[k] = deepMerge(base[k], v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

// §35.10 / §36.6 (the FreeWallet rule): a per-chain preference written
// with a value EQUAL to the chain descriptor's current default is
// stored as null ("follow the release default") instead. Users who
// pick the default value keep following it when a later release
// retunes it; only a value that differs from the default is a real
// override. Chains the registry doesn't know (tests, stale entries)
// pass through untouched. Top-level fields need no equivalent here:
// the vault's deflate pass drops those against createDefaultSettings.
function normalizeChainScopedDefaults(settings) {
    const registry = defaultRegistry();
    let fees = settings.fees;
    for (const [chainId, entry] of Object.entries(settings.fees ?? {})) {
        const descriptor = registry.get(chainId);
        if (!descriptor || !entry) continue;
        const d = resolveFeeConfig(null, descriptor);
        const next = { ...entry };
        if (next.strategy != null && next.strategy === d.strategy) next.strategy = null;
        if (next.rbfByDefault != null && next.rbfByDefault === d.rbfByDefault) next.rbfByDefault = null;
        if (next.strategy !== entry.strategy || next.rbfByDefault !== entry.rbfByDefault) {
            if (fees === settings.fees) fees = { ...settings.fees };
            fees[chainId] = next;
        }
    }
    let perChain = settings.ads?.perChain;
    for (const [chainId, state] of Object.entries(settings.ads?.perChain ?? {})) {
        const descriptor = registry.get(chainId);
        if (!descriptor || !state) continue;
        const d = resolveAdsChainConfig(null, descriptor);
        const next = { ...state };
        if (next.perTxAmountSats != null && next.perTxAmountSats === d.perTxAmountSats) next.perTxAmountSats = null;
        if (next.triggerAmountSats != null && next.triggerAmountSats === d.triggerAmountSats) next.triggerAmountSats = null;
        if (next.perTxAmountSats !== state.perTxAmountSats || next.triggerAmountSats !== state.triggerAmountSats) {
            if (perChain === settings.ads.perChain) perChain = { ...settings.ads.perChain };
            perChain[chainId] = next;
        }
    }
    if (fees === settings.fees && perChain === settings.ads?.perChain) return settings;
    return {
        ...settings,
        fees,
        ads: settings.ads ? { ...settings.ads, perChain } : settings.ads,
    };
}
