// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// COINPAY query flows (§41.4). Passthroughs to the SDK's explorer
// client methods covering the `coinpay_obligations`,
// `coinpays`, and `coinpay_expires` tables.
//
// The primary entry point for the wallet is
// `getCoinpayObligationsForAddress`, used by the Home resume card
// to detect "does this wallet address owe a COINPAY?" Returns every
// obligation touching the address (as payer *or* payee) joined with
// its current status; callers filter to `pending_coinpay` on the
// payer side to build the queue.

import { obligationBaseUnits } from '../market/obligationStatus.js';

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

// The explorer has returned obligations under several envelope shapes over
// time; accept them all rather than silently reading zero rows (which, in the
// verifier below, would fail closed on a legitimate payment). Exported for
// the PC-16 auto-pay engine, which reads the same endpoints.
export function extractCoinpayRows(resp) {
    return extractRows(resp);
}

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    for (const key of ['data', 'rows', 'obligations', 'coinpay_obligations']) {
        if (Array.isArray(resp[key])) return resp[key];
    }
    return [];
}

/**
 * Re-derive a COINPAY obligation from the chain at sign time and confirm it says
 * what the caller thinks it says. Returns the authoritative obligation row;
 * throws rather than let a mismatch reach the signer.
 *
 * Why this exists ( / F4): a COINPAY carries a native-coin output paying a
 * payee an amount, and both fields arrive from an indexer query, get hydrated
 * into form state, and are then passed back down to be signed. Nothing in that
 * round trip re-checked them, so any tampering after the fetch - a compromised
 * renderer, a stale or edited draft, a bug in the messaging layer, a caller
 * passing its own values - produced a signed, broadcast payment of real coin to
 * an attacker's address, and the user would have approved a screen that agreed
 * with itself. The signed output is now pinned to an obligation the flow layer
 * re-read for itself, immediately before signing.
 *
 * Scope, stated honestly: this re-read hits the same indexer, so it does NOT
 * defend against an indexer that lies consistently. It closes the gap between
 * fetch and sign. Verifying the obligation against the chain itself needs the
 * SPV/light-client path .
 *
 * @param {SdkCtx & {
 *   payerAddress: string,
 *   orderMatchActionIndex: string,
 *   payeeAddress: string,
 *   coinAmount: number,
 * }} params
 * @returns {Promise<object>} the authoritative obligation row
 */
export async function verifyCoinpayObligation({
    sdkRegistry,
    chainId,
    payerAddress,
    orderMatchActionIndex,
    payeeAddress,
    coinAmount,
}) {
    const resp = await getCoinpayObligationsForAddress({
        sdkRegistry,
        chainId,
        address: payerAddress,
    });
    const rows = extractRows(resp);
    const want = String(orderMatchActionIndex);
    const row = rows.find((r) => String(r.action_index ?? r.actionIndex) === want);
    if (!row) {
        throw new Error(
            `verifyCoinpayObligation: no COINPAY obligation for ORDER_MATCH #${want} on ${payerAddress}`,
        );
    }

    // Paying an obligation that is already fulfilled or expired burns the coin
    // for nothing: the protocol won't settle it twice.
    const status = String(row.coinpay_status ?? row.status ?? '');
    if (status && status !== 'pending_coinpay') {
        throw new Error(
            `verifyCoinpayObligation: ORDER_MATCH #${want} is "${status}", not pending; refusing to pay it`,
        );
    }

    const payer = row.payer_address ?? row.payerAddress;
    if (payer && String(payer) !== String(payerAddress)) {
        throw new Error(
            `verifyCoinpayObligation: ORDER_MATCH #${want} is owed by ${payer}, not by ${payerAddress}`,
        );
    }

    const truePayee = String(row.payee_address ?? row.payeeAddress ?? '');
    if (!truePayee) {
        throw new Error(`verifyCoinpayObligation: ORDER_MATCH #${want} has no payee address`);
    }
    if (truePayee !== String(payeeAddress)) {
        throw new Error(
            `verifyCoinpayObligation: payee mismatch for ORDER_MATCH #${want} `
            + `(obligation pays ${truePayee}, asked to sign ${payeeAddress})`,
        );
    }

    // Compare in BigInt, not Number: a DOGE obligation can exceed 2^53-1 base
    // units , where Number() rounds BOTH sides and two different
    // amounts can collide after rounding. BigInt('...') throws on a
    // non-integer shape, which is exactly the unusable-amount case.
    // The explorer serves this column as the match's DECIMAL coin figure on
    // current venues and as base units on older ones; obligationBaseUnits
    // accepts exactly those two shapes and nothing looser, because the
    // equality below is what stops the wallet signing a wrong amount.
    const trueAmount = obligationBaseUnits(row.coin_amount ?? row.coinAmount);
    if (trueAmount === null || trueAmount <= 0n) {
        throw new Error(
            `verifyCoinpayObligation: ORDER_MATCH #${want} has an unusable coin_amount (${row.coin_amount ?? row.coinAmount})`,
        );
    }
    if (trueAmount !== BigInt(String(coinAmount).trim())) {
        throw new Error(
            `verifyCoinpayObligation: amount mismatch for ORDER_MATCH #${want} `
            + `(obligation owes ${trueAmount} base units, asked to sign ${coinAmount})`,
        );
    }

    return row;
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
