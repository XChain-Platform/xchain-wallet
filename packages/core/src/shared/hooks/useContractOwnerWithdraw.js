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
import { extractSingle, contractOwnerWithdraw } from '../routes/contractResponseShape.js';

/**
 * A contract's owner-withdraw answer (OWNER_WITHDRAW_OPT_IN) for a form that
 * does not otherwise load the contract row: true, false, or null while the
 * row is loading, when the lookup fails, when the shell has no
 * `getContractByActionIndex`, or when the explorer does not serve the field.
 * Null always means "keep today's behaviour", so a hiccup never blocks a
 * WITHDRAW and never invents a warning.
 *
 * @param {object} args
 * @param {any} args.messaging
 * @param {string | null | undefined} args.chainId
 * @param {string | null | undefined} args.contractActionIndex
 * @returns {boolean | null}
 */
export function useContractOwnerWithdraw({ messaging, chainId, contractActionIndex }) {
    const [ownerWithdraw, setOwnerWithdraw] = useState(/** @type {boolean | null} */ (null));
    useEffect(() => {
        setOwnerWithdraw(null);
        if (!chainId || !contractActionIndex) return undefined;
        if (typeof messaging?.getContractByActionIndex !== 'function') return undefined;
        let cancelled = false;
        messaging.getContractByActionIndex({ chainId, contractActionIndex })
            .then((resp) => { if (!cancelled) setOwnerWithdraw(contractOwnerWithdraw(extractSingle(resp))); })
            .catch(() => { /* unknown: the chain stays the judge */ });
        return () => { cancelled = true; };
    }, [messaging, chainId, contractActionIndex]);
    return ownerWithdraw;
}
