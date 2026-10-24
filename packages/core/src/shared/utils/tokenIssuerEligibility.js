// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export const UNKNOWN_TOKEN_ISSUER_MESSAGE = "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.";

function sameAddress(left, right) {
    return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

/**
 * Classifies an issuer-only token action before it reaches review.
 * A null token record is still loading. A resolved record without a creator
 * is different: the explorer cannot prove who may authorize the action, so
 * the wallet must fail closed instead of spending a fee on a protocol refusal.
 *
 * @param {object} args
 * @param {any | null} args.tokenInfo
 * @param {Record<string, any[]> | null} args.addressesByChain
 * @param {string | null | undefined} args.chainId
 * @param {string | null | undefined} args.tick
 * @param {string | null | undefined} [args.sourceAddress]
 * @returns {{ pending: boolean, error: string | null, issuerAddress: string | null }}
 */
export function tokenIssuerEligibility({
    tokenInfo,
    addressesByChain,
    chainId,
    tick,
    sourceAddress = null,
}) {
    if (!tokenInfo) {
        return { pending: true, error: null, issuerAddress: null };
    }

    const issuerAddress = typeof tokenInfo.creator === 'string' && tokenInfo.creator.trim()
        ? tokenInfo.creator.trim()
        : null;
    if (!issuerAddress) {
        return { pending: false, error: UNKNOWN_TOKEN_ISSUER_MESSAGE, issuerAddress: null };
    }

    const chainAddresses = addressesByChain && chainId ? addressesByChain[chainId] : null;
    if (Array.isArray(chainAddresses)
        && !chainAddresses.some((record) => sameAddress(record?.address, issuerAddress))) {
        return {
            pending: false,
            error: `This wallet does not own ${tick}. Only the current owner can make this change.`,
            issuerAddress,
        };
    }

    if (sourceAddress && !sameAddress(sourceAddress, issuerAddress)) {
        return {
            pending: false,
            error: `The selected source address does not own ${tick}. Choose the current owner address.`,
            issuerAddress,
        };
    }

    return { pending: false, error: null, issuerAddress };
}
