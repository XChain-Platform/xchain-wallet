// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging } from '../useMessaging.js';

const chainRegistry = registryLib.defaultRegistry();

// BTC chain IDs, resolved once from the registry. The VM (DEPLOY /
// EXECUTE / DEPOSIT / WITHDRAW) is BTC-only at launch, and so is
// staking (STAKE / UNSTAKE / …). Surfaces that are BTC-gated use this
// hook to decide whether to expose their nav entry.
const BTC_CHAIN_IDS = chainRegistry.byCoin('bitcoin').map((d) => d.id);

/**
 * Returns true once the wallet has at least one address on any BTC
 * chain (mainnet / testnet / regtest). Returns `null` while loading so
 * callers can hide the surface until the answer is known (preferred
 * over flashing "no BTC" before load completes).
 *
 * @param {string | null} walletId
 * @returns {boolean | null}
 */
export function useBtcAddressesPresent(walletId) {
    const { messaging } = useMessaging();
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
                const has = BTC_CHAIN_IDS.some((cid) => {
                    const rows = byChain && byChain[cid];
                    return Array.isArray(rows) && rows.length > 0;
                });
                setPresent(has);
            })
            .catch(() => {
                if (!cancelled) setPresent(false);
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    return present;
}
