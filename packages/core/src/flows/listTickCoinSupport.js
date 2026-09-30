// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { listActions } from './sdkIntrospection.js';

function tickCoinProbeRegistry(sdkRegistry) {
    return {
        get(chainId) {
            const sdk = sdkRegistry.get(chainId);
            return {
                getActions: () => (typeof sdk?.isListTickCoinActive === 'function'
                    ? sdk.isListTickCoinActive()
                    : false),
            };
        },
    };
}

/**
 * Whether the chain's SDK reports the list tick-coin activation. SDK builds
 * that predate the probe have no such method and answer false.
 *
 * @param {{ sdkRegistry: any, chainId: string }} params
 * @returns {Promise<boolean>}
 */
export async function listTickCoinSupport({ sdkRegistry, chainId }) {
    try {
        const active = await listActions({
            sdkRegistry: tickCoinProbeRegistry(sdkRegistry),
            chainId,
        });
        return active === true;
    } catch {
        return false;
    }
}
