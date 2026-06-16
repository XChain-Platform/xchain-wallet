// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// COINPAY query flows — §41.4. Passthroughs to the SDK's explorer
// client methods covering the `coinpay_obligations`,
// `coinpays`, and `coinpay_expires` tables.
//
// The primary entry point for the wallet is
// `getCoinpayObligationsForAddress` — used by the Home resume card
// to detect "does this wallet address owe a COINPAY?" Returns every
// obligation touching the address (as payer *or* payee) joined with
// its current status; callers filter to `pending_coinpay` on the
// payer side to build the queue.

/**
 * @typedef {{ sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry, chainId: string }} SdkCtx
 */

/**
 * Obligations touching `address` on `chainId`. The explorer joins
 * `coinpay_obligations` with the current `coinpay_statuses` row, so
 * each item includes the `coinpay_status` column
 * (`pending_coinpay`, `fulfilled`, `expired`, `invalid`). The caller
 * filters to `pending_coinpay` and `payer_address === address` to
 * build the user's outstanding-payment queue.
 *
 * @param {SdkCtx & { address: string, opts?: object }} params
 */
export async function getCoinpayObligationsForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('getCoinpayObligationsForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('getCoinpayObligationsForAddress: chainId is required');
    if (typeof address !== 'string' || address.length === 0) {
        throw new Error('getCoinpayObligationsForAddress: address is required');
    }
    const sdk = sdkRegistry.get(chainId);
    return sdk.getCoinpayObligations(address, 'address', opts);
}

/**
 * Recorded COINPAY actions touching `address` on `chainId`. Used by
 * history-style surfaces (not by the Step 9 resume card, which cares
 * about `pending_coinpay` obligations, not already-fulfilled ones).
 *
 * @param {SdkCtx & { address: string, opts?: object }} params
 */
export async function getCoinpaysForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('getCoinpaysForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('getCoinpaysForAddress: chainId is required');
    if (typeof address !== 'string' || address.length === 0) {
        throw new Error('getCoinpaysForAddress: address is required');
    }
    const sdk = sdkRegistry.get(chainId);
    return sdk.getCoinpays(address, 'address', opts);
}
