// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Chain visibility helpers — the wallet hides regtest descriptors
// from user-facing pickers unless Developer Mode is on. Per spec §2.2
// (chain-explicit by default; no global "current network" toggle) and
// §48.3 (regtest exposed only via Developer Mode).
//
// Single source of truth so every picker / filter / list applies the
// same rule. UI surfaces import `filterChainsForUser` and call it
// against the chain registry's `supportedChains()` output and the
// user's settings.

/**
 * Filter chain descriptors to those the user should see.
 *
 * @param {Array<{ networkKind: string }>} descriptors
 * @param {{ developerMode?: boolean } | null | undefined} settings
 * @returns {typeof descriptors}
 */
export function filterChainsForUser(descriptors, settings) {
    const developerMode = Boolean(settings?.developerMode);
    if (developerMode) return [...descriptors];
    return descriptors.filter((d) => d.networkKind !== 'regtest');
}

/**
 * Same predicate, applied to a single descriptor — useful where the
 * caller already has a descriptor in hand.
 *
 * @param {{ networkKind: string }} descriptor
 * @param {{ developerMode?: boolean } | null | undefined} settings
 */
export function isChainVisibleToUser(descriptor, settings) {
    if (Boolean(settings?.developerMode)) return true;
    return descriptor?.networkKind !== 'regtest';
}
