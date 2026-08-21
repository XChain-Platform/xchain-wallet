// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { useMessaging } from '../useMessaging.js';
import { useChainIdsWithAction } from './useSupportedChains.js';

// Chains that can carry contracts, asked of the LIVE registry (every chain
// whose descriptor advertises DEPLOY), so a synced or user-added descriptor
// reaches the nav gate without a restart.
//
// This exists as a SEPARATE hook from useBtcAddressesPresent, which the nav
// shares between Contracts and Staking, because the two lanes no longer
// agree: contracts opened to LTC/DOGE when the native-fee lane closed, and
// VALIDATOR staking (and multisig, and co-signer accounts) is still Bitcoin-
// exclusive. Widening the shared hook would have opened all of them.
//
// Asked of the descriptors rather than pinned to a coin, so it moves with
// registry/actions.js the way ContractsList and DeployContractForm do.

/**
 * Returns true once the wallet has at least one address on a chain that
 * supports contracts (any network of it). Returns `null` while loading so
 * callers can hide the surface until the answer is known, rather than flashing
 * an empty state before the load completes.
 *
 * @param {string | null} walletId
 * @returns {boolean | null}
 */
export function useVmAddressesPresent(walletId) {
    const { messaging } = useMessaging();
    const vmChainIds = useChainIdsWithAction('DEPLOY');
    const [present, setPresent] = useState(/** @type {boolean | null} */ (null));

    useEffect(() => {
        if (!walletId) {
            setPresent(null);
            return;
        }
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const has = vmChainIds.some((cid) => {
                    const rows = byChain && byChain[cid];
                    return Array.isArray(rows) && rows.length > 0;
                });
                setPresent(has);
            })
            .catch(() => {
                if (!cancelled) setPresent(false);
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, vmChainIds]);

    return present;
}
