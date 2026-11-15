// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { filterChainIdsByActiveNetwork } from '../../../flows/effectiveNetwork.js';
import { isChainVisibleToUser } from '../../../registry/visibility.js';

export function adsChainIdsForUser(settings, chainRegistry) {
    return Object.keys(settings?.ads?.perChain ?? {}).filter((chainId) => {
        const descriptor = chainRegistry?.get?.(chainId);
        if (!descriptor) return true;
        return isChainVisibleToUser(descriptor, settings)
            && filterChainIdsByActiveNetwork([chainId], settings, chainRegistry).length > 0;
    }).sort();
}
