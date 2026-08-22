// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Live chain list for React surfaces (§9.7 hot-swap contract).
//
// The registry's descriptors change at runtime: the boot sync hot-swaps a
// hub-verified batch (applyRemoteDescriptors), usually AFTER the UI has
// mounted, and Developer Mode adds / removes custom chains. A module-scope
// `chainRegistry.supportedChains().filter(...)` freezes the answer at import,
// so a chain that gains DEPLOY / VOTE / BET / STAKE in a synced descriptor
// stays hidden until restart. These hooks subscribe to the registry's version
// counter instead (same useSyncExternalStore shape as useFiatRate over
// subscribeFiatRates), so a mutation re-renders every gated surface.
//
// The snapshot handed to useSyncExternalStore is the VERSION NUMBER, which is
// referentially stable between mutations; the arrays are memoised on it. A
// fresh array per getSnapshot call would loop React forever.

import { useMemo, useSyncExternalStore } from 'react';
import { defaultRegistry } from '../../registry/index.js';

/** @param {import('../../registry/index.js').ChainRegistry} [registry] */
function useRegistryVersion(registry) {
    const reg = registry ?? defaultRegistry();
    return useSyncExternalStore(
        (fn) => reg.subscribe(fn),
        () => reg.getVersion(),
        () => reg.getVersion(),
    );
}

/**
 * Every descriptor the registry currently knows, re-read on each mutation.
 *
 * @param {import('../../registry/index.js').ChainRegistry} [registry]  defaults to the shared singleton
 * @returns {import('../../registry/validate.js').ChainDescriptor[]}
 */
export function useSupportedChains(registry) {
    const reg = registry ?? defaultRegistry();
    const version = useRegistryVersion(reg);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version IS the registry's change signal
    return useMemo(() => reg.supportedChains(), [reg, version]);
}

/**
 * Chain ids whose descriptor advertises `action` in supportedActions, re-read
 * on each mutation. The per-coin gating primitive for nav / forms / browse.
 *
 * @param {string} action   e.g. 'DEPLOY'
 * @param {import('../../registry/index.js').ChainRegistry} [registry]
 * @returns {string[]}
 */
export function useChainIdsWithAction(action, registry) {
    const chains = useSupportedChains(registry);
    return useMemo(
        () => chains
            .filter((d) => Array.isArray(d.supportedActions) && d.supportedActions.includes(action))
            .map((d) => d.id),
        [chains, action],
    );
}

/**
 * Non-hook twin of useChainIdsWithAction for callers outside React (or
 * inside an effect that wants the answer at call time, not at import time).
 *
 * @param {string} action
 * @param {import('../../registry/index.js').ChainRegistry} [registry]
 * @returns {string[]}
 */
export function chainIdsWithAction(action, registry) {
    return (registry ?? defaultRegistry()).supportedChains()
        .filter((d) => Array.isArray(d.supportedActions) && d.supportedActions.includes(action))
        .map((d) => d.id);
}
