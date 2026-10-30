// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Whether network reads can run at all: the device reports no network, or
// the shared reachability probe has confirmed every service is unreachable.
// A screen that is offline skips reads that cannot finish (the request layer
// retries each one for up to a minute) and shows its offline state at once;
// the verdict flips back when the connection returns, so a screen that keys
// its reads on it loads again by itself.

import { isDemoWallet } from '../../flows/demoMode.js';
import { useOnlineStatus } from './useOnlineStatus.js';
import { useReachability } from './useReachability.js';

const NO_CHAINS = [];

/**
 * @param {{ walletId?: string | null }} [opts]
 *   A demo wallet reads fixtures, never the network, so it is never offline.
 * @returns {{ offline: boolean, recheck: () => void }}
 */
export function useNetworkOffline({ walletId = null } = {}) {
    const demo = isDemoWallet(walletId);
    const browserOnline = useOnlineStatus();
    const { overall, refresh } = useReachability(demo ? { chainIds: NO_CHAINS } : {});
    return {
        offline: !demo && (!browserOnline || overall === 'offline'),
        recheck: refresh,
    };
}
