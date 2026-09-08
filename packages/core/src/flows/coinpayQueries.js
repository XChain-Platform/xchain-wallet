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
import {
    BATCH_FEATURE_COINPAY,
    isBatchUnsupported,
    isBatchUnsupportedError,
    rememberBatchUnsupported,
    _resetBatchSupportMemo,
} from './balances.js';

/**
 * @typedef {{ sdkRegistry: import('../sdk/SDKRegistry.js').SDKRegistry, chainId: string }} SdkCtx
 */

/**
 * How long a coalescing window stays open.
 *
 * The badge scan fires one call per (chain, address) pair from a single
 * `Promise.all`, so every call of a scan is already on the same tick; a window
 * only has to outlast that tick, not wait for a later one. 25 ms is short
 * enough that a lone caller (the sign-time re-read below) pays a delay nobody
 * can perceive, and long enough that no scan is ever split across two windows.
 */
export const COINPAY_BATCH_WINDOW_MS = 25;

/** Most addresses one batch request may carry; the explorer's own ceiling. */
export const COINPAY_BATCH_MAX_ADDRESSES = 20;

/**
 * Windows currently open, one per (SDK instance, chainId).
 *
 * A plain Set scanned linearly rather than a keyed map, because the key is a
 * PAIR whose first half is an object identity: at most a handful of chains can
 * have a window open inside 25 ms, so the scan is cheaper than the composite
 * key it would replace, and clearing the set is all a test reset has to do.
 *
 * @type {Set<{ sdk: object, chainId: string, addresses: string[], resolvers: {resolve: Function, reject: Function}[], opts: object | undefined, timer: * }>}
 */
const openWindows = new Set();

/**
 * Test hook: drop every open window and forget which SDK instances answered
 * 404. Without it a pending timer, or a memo a 404 test earned, would decide
 * the next test's path. Callers still waiting on a dropped window are left
 * unsettled by design; a test resets between cases, not mid-flight.
 */
export function _resetCoinpayBatching() {
    for (const w of openWindows) if (w.timer) clearTimeout(w.timer);
    openWindows.clear();
    _resetBatchSupportMemo();
}

/** The per-address read: what every fallback path serves. */
function readOneAddress(sdk, address, opts) {
    return sdk.getCoinpayObligations(address, 'address', opts);
}

// One address's slot in a batch response. A slot with no body is that
// caller's failure and nobody else's, so only that caller is rejected.
function bodyOrThrow(slot, address) {
    if (slot && slot.coinpay_obligations != null) return slot.coinpay_obligations;
    const err = slot && slot.error ? slot.error : null;
    const e = new Error(String((err && err.error) || `no coinpay batch result for ${address}`));
    if (err && typeof err.code === 'string') e.code = err.code;
    if (err && err.status != null) e.status = err.status;
    throw e;
}

// One POST for up to COINPAY_BATCH_MAX_ADDRESSES addresses of one chain.
async function runCoinpayChunk({ sdk, addresses, resolvers, opts }) {
    let resp;
    try {
        // Deduplicated for the request only: the response is keyed by address,
        // so two callers asking for the same address still each find their
        // slot, and the duplicate does not eat one of the twenty.
        resp = await sdk.getCoinpayObligationsBatch([...new Set(addresses)], opts);
    } catch (e) {
        if (e && isBatchUnsupportedError(e)) {
            // An explorer that predates the batch route. Remember the instance
            // so no later window even arms, and serve these callers the old way
            // once so the scan they belong to still answers.
            rememberBatchUnsupported(sdk, BATCH_FEATURE_COINPAY);
            await Promise.all(resolvers.map((r, i) => readOneAddress(sdk, addresses[i], opts)
                .then(r.resolve, r.reject)));
            return;
        }
        // Any other failure is the whole request's. Re-issuing per address
        // would fire the reads the batch replaced, which on a 429 is the burst
        // that earns the next one; the badge hook already catches per address.
        for (const r of resolvers) r.reject(e);
        return;
    }
    resolvers.forEach((r, i) => {
        try {
            r.resolve(bodyOrThrow(resp ? resp[addresses[i]] : null, addresses[i]));
        } catch (e) {
            r.reject(e);
        }
    });
}

// Close a window: take its callers, split them into requests of at most
// COINPAY_BATCH_MAX_ADDRESSES, and answer each caller from its own slot.
function flushWindow(w) {
    openWindows.delete(w);
    const { sdk, addresses, resolvers, opts } = w;
    for (let i = 0; i < addresses.length; i += COINPAY_BATCH_MAX_ADDRESSES) {
        runCoinpayChunk({
            sdk,
            addresses: addresses.slice(i, i + COINPAY_BATCH_MAX_ADDRESSES),
            resolvers: resolvers.slice(i, i + COINPAY_BATCH_MAX_ADDRESSES),
            opts,
        });
    }
}

/**
 * Obligations touching `address` on `chainId`. The explorer joins
 * `coinpay_obligations` with the current `coinpay_statuses` row, so
 * each item includes the `coinpay_status` column
 * (`pending_coinpay`, `fulfilled`, `expired`, `invalid`). The caller
 * filters to `pending_coinpay` and `payer_address === address` to
 * build the user's outstanding-payment queue.
 *
 * The signature and the answer are unchanged; what changed is how many
 * requests N callers cost. Calls landing within COINPAY_BATCH_WINDOW_MS on the
 * same (SDK instance, chain) are answered by ONE request, so the badge scan of
 * a five-address wallet is one read per chain instead of five. Callers of a
 * chain whose SDK or explorer has no batch route go straight to the
 * per-address read with no window at all, so that path gains no latency.
 *
 * `opts` is taken from the FIRST caller in a window and applies to the whole
 * request, which is honest only because every wallet caller passes none (the
 * badge hook, the CoinpayForm scan, the autopay watcher and the sign-time
 * re-read below). A caller that needs its own paging should read the SDK
 * directly rather than expect a window to keep two sets of query options.
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
    const canBatch = sdk && typeof sdk.getCoinpayObligationsBatch === 'function'
        && !isBatchUnsupported(sdk, BATCH_FEATURE_COINPAY);
    if (!canBatch) return readOneAddress(sdk, address, opts);
    return new Promise((resolve, reject) => {
        let w = null;
        for (const open of openWindows) {
            if (open.sdk === sdk && open.chainId === chainId) { w = open; break; }
        }
        if (!w) {
            w = { sdk, chainId, addresses: [], resolvers: [], opts, timer: null };
            openWindows.add(w);
            w.timer = setTimeout(() => flushWindow(w), COINPAY_BATCH_WINDOW_MS);
        }
        w.addresses.push(address);
        w.resolvers.push({ resolve, reject });
    });
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
 * Why this exists (F4): a COINPAY carries a native-coin output paying a
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
 * SPV/light-client path.
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
    // units, where Number() rounds BOTH sides and two different
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
