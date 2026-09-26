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

/**
 * Owner gate shared by ManageToken (issuer surface) and TokenDetail
 * (holder surface, which needs it to decide whether to offer a "Manage
 * token" hop into ManageToken). Ownership is never scoped to the active
 * address alone, by long-standing wallet rule:
 * a wallet can hold the issuing key on an address that isn't the one
 * currently selected, so this checks every address the wallet has on
 * the token's chain, not just the active one.
 *
 * @param {object} args
 * @param {any} args.messaging
 * @param {string} args.walletId
 * @param {string} args.chainId
 * @param {string | null | undefined} args.issuerAddress   on-chain creator (assetInfo.creator); null/undefined while unresolved
 * @returns {boolean | null}   null = unknown (still loading, or no creator resolved yet)
 */
export function useIsTokenIssuer({ messaging, walletId, chainId, issuerAddress }) {
    const [isOwner, setIsOwner] = useState(/** @type {boolean | null} */ (null));
    useEffect(() => {
        if (!issuerAddress) { setIsOwner(null); return undefined; }
        if (typeof messaging?.getAddressesByChain !== 'function') { setIsOwner(null); return undefined; }
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const addrs = (byChain?.[chainId] || [])
                    .map((a) => a?.address)
                    .filter((a) => typeof a === 'string');
                setIsOwner(addrs.includes(issuerAddress));
            })
            .catch(() => { if (!cancelled) setIsOwner(null); });
        return () => { cancelled = true; };
    }, [messaging, walletId, chainId, issuerAddress]);
    return isOwner;
}
