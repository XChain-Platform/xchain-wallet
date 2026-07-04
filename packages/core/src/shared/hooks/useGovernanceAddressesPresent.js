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
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging } from '../useMessaging.js';

const chainRegistry = registryLib.defaultRegistry();

// Chains whose protocol accepts VOTE (token-weighted governance), resolved once
// from the registry's supportedActions. Unlike multisig/staking (BTC-only), VOTE
// is a common governance primitive: a poll is decided by holders of ANY token
// (the DEPOSIT / GAS_ESCROW that need the GAS tick are optional), so governance
// is gated by capability, not a hardcoded coin. Adding VOTE to a chain's
// supportedActions surfaces the nav entry automatically.
const GOVERNANCE_CHAIN_IDS = chainRegistry
    .supportedChains()
    .filter((d) => Array.isArray(d.supportedActions) && d.supportedActions.includes('VOTE'))
    .map((d) => d.id);

/**
 * Returns true once the wallet has at least one address on any chain that
 * supports VOTE governance. Returns `null` while loading so callers can hide
 * the surface until the answer is known (matches useBtcAddressesPresent).
 *
 * @param {string | null} walletId
 * @returns {boolean | null}
 */
export function useGovernanceAddressesPresent(walletId) {
    const { messaging } = useMessaging();
    const [present, setPresent] = useState(/** @type {boolean | null} */ (null));

    useEffect(() => {
        if (!walletId) { setPresent(null); return; }
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                const has = GOVERNANCE_CHAIN_IDS.some((cid) => {
                    const rows = byChain && byChain[cid];
                    return Array.isArray(rows) && rows.length > 0;
                });
                setPresent(has);
            })
            .catch(() => { if (!cancelled) setPresent(false); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    return present;
}

// The set of governance-capable chain IDs, exported for callers that need to
// pick a default chain for the governance surfaces.
export { GOVERNANCE_CHAIN_IDS };
