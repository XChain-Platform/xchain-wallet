// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-16 auto-pay consent records. Written at order placement (see
// orderAction's `autopay` option), read by the auto-pay engine
// (CoinpayAutopayWatcher) and the order-row toggles. The record stores
// the TERMS the engine's caps verify against - GIVE-side native total
// and GET-side token total - snapshotted from the exact params that
// were signed, never re-read from an API later.
//
// Consent is per-order and revocable at any time with no transaction:
// `setAutopayEnabled(id, false)` flips the record to notify-only.

import {
    autopayOrderId,
    createAutopayOrder,
} from '../schemas/autopayOrder.js';
import { remainingGiveBase } from '../market/autopayPolicy.js';

/**
 * Is this ORDER params object a native-coin GIVE (the only shape
 * auto-pay arms on)? Native side = empty TICK on the wire (order.js
 * isNull check); coin-for-coin is protocol-invalid, so a non-empty
 * GET_TICK is required too.
 *
 * @param {object} params  ORDER v0 params
 * @returns {boolean}
 */
export function isNativeGiveOrder(params) {
    if (!params || typeof params !== 'object') return false;
    const giveTick = params.GIVE_TICK;
    const getTick = params.GET_TICK;
    return (giveTick == null || String(giveTick).length === 0) &&
        typeof getTick === 'string' && getTick.length > 0 &&
        typeof params.GIVE_AMOUNT === 'string' && params.GIVE_AMOUNT.length > 0 &&
        typeof params.GET_AMOUNT === 'string' && params.GET_AMOUNT.length > 0;
}

/**
 * Persist the consent + terms record for a just-broadcast coin-GIVE
 * order. Idempotent per (chainId, txid).
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} opts.walletId
 * @param {string} opts.chainId
 * @param {string} opts.sourceAddress
 * @param {string} opts.txid
 * @param {object} opts.params      the ORDER params that were signed
 * @param {boolean} [opts.enabled]  default true
 * @returns {Promise<import('../schemas/autopayOrder.js').AutopayOrder>}
 */
export async function recordAutopayConsent(opts) {
    const { vault, walletId, chainId, sourceAddress, txid, params } = opts;
    if (!vault) throw new Error('recordAutopayConsent: vault is required');
    if (!walletId) throw new Error('recordAutopayConsent: walletId is required');
    if (!chainId) throw new Error('recordAutopayConsent: chainId is required');
    if (!sourceAddress) throw new Error('recordAutopayConsent: sourceAddress is required');
    if (typeof txid !== 'string' || txid.length === 0) {
        throw new Error('recordAutopayConsent: txid is required');
    }
    if (!isNativeGiveOrder(params)) {
        throw new Error('recordAutopayConsent: order is not a native-coin GIVE');
    }
    const record = createAutopayOrder({
        walletId,
        chainId,
        sourceAddress,
        txid,
        giveCoinAmount: params.GIVE_AMOUNT,
        getTick: params.GET_TICK,
        getAmount: params.GET_AMOUNT,
        autopay: opts.enabled !== false,
    });
    await vault.autopayOrders.put(record);
    return record;
}

/**
 * List consent records, optionally scoped.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} [opts.walletId]
 * @param {string} [opts.chainId]
 * @returns {Promise<import('../schemas/autopayOrder.js').AutopayOrder[]>}
 */
export async function listAutopayOrders({ vault, walletId, chainId }) {
    if (!vault) throw new Error('listAutopayOrders: vault is required');
    const all = await vault.autopayOrders.list();
    return all.filter((r) =>
        (walletId == null || r.walletId === walletId) &&
        (chainId == null || r.chainId === chainId));
}

/**
 * Flip a record's consent flag (local toggle, no transaction).
 * Accepts the record id or a { chainId, txid } pair.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} [opts.id]
 * @param {string} [opts.chainId]
 * @param {string} [opts.txid]
 * @param {boolean} opts.enabled
 * @returns {Promise<import('../schemas/autopayOrder.js').AutopayOrder>}
 */
export async function setAutopayEnabled(opts) {
    const { vault, enabled } = opts;
    if (!vault) throw new Error('setAutopayEnabled: vault is required');
    if (typeof enabled !== 'boolean') throw new Error('setAutopayEnabled: enabled must be a boolean');
    const id = opts.id ?? (opts.chainId && opts.txid
        ? autopayOrderId({ chainId: opts.chainId, txid: opts.txid })
        : null);
    if (!id) throw new Error('setAutopayEnabled: id or chainId+txid is required');
    const record = await vault.autopayOrders.get(id);
    if (!record) throw new Error(`setAutopayEnabled: no consent record ${id}`);
    const next = { ...record, autopay: enabled };
    await vault.autopayOrders.put(next);
    return next;
}

/**
 * PC-34 force-close interplay: a SWEEP with ORDERS=1 cancels every open
 * ORDER from the swept address on that chain, so its auto-pay consents
 * must stop arming payments. Flips `autopay` to false on every enabled
 * record matching (walletId, chainId, sourceAddress); the records stay
 * (they are the terms/history anchor and the per-row toggle surface).
 *
 * Deliberately NOT a delete: a match that formed before the sweep can
 * still carry a pending obligation the user may choose to pay manually
 * from Payments due, and the caps history stays auditable.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} opts.walletId
 * @param {string} opts.chainId
 * @param {string} opts.sourceAddress
 * @returns {Promise<import('../schemas/autopayOrder.js').AutopayOrder[]>} the records disabled
 */
export async function disableAutopayForAddress({ vault, walletId, chainId, sourceAddress }) {
    if (!vault) throw new Error('disableAutopayForAddress: vault is required');
    if (!walletId) throw new Error('disableAutopayForAddress: walletId is required');
    if (!chainId) throw new Error('disableAutopayForAddress: chainId is required');
    if (!sourceAddress) throw new Error('disableAutopayForAddress: sourceAddress is required');
    const records = await listAutopayOrders({ vault, walletId, chainId });
    const disabled = [];
    for (const record of records) {
        if (record.sourceAddress !== sourceAddress || record.autopay !== true) continue;
        const next = { ...record, autopay: false };
        await vault.autopayOrders.put(next);
        disabled.push(next);
    }
    return disabled;
}

/**
 * Aggregate outstanding auto-pay exposure per chain, in base units:
 * the sum every armed order could still pay out under the caps (GIVE
 * total minus recorded payments). Shown on the order form whenever
 * the checkbox is checked, so the user sees the bound they accept.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} [opts.walletId]
 * @returns {Promise<Record<string, string>>} chainId -> base-unit total (decimal string)
 */
export async function autopayExposureBase({ vault, walletId }) {
    const records = await listAutopayOrders({ vault, walletId });
    /** @type {Record<string, bigint>} */
    const sums = {};
    for (const r of records) {
        if (r.autopay !== true) continue;
        const left = remainingGiveBase(r);
        if (left === null || left === 0n) continue;
        sums[r.chainId] = (sums[r.chainId] ?? 0n) + left;
    }
    return Object.fromEntries(
        Object.entries(sums).map(([chainId, v]) => [chainId, v.toString()]),
    );
}

/**
 * Backfill `orderActionIndex` for records whose ORDER has since been
 * indexed. The engine needs the index to link obligations to their
 * consented order (the obligation row carries only the ORDER_MATCH
 * index; the match row carries the two order indexes).
 *
 * Resolution is read-only trust-wise: the index is looked up by the
 * placement txid the wallet broadcast itself, and a wrong index can
 * only make the engine's cross-checks FAIL (the caps compare the
 * match row's order indexes against this value).
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} opts.sdkRegistry
 * @param {string} [opts.walletId]
 * @returns {Promise<number>} how many records were backfilled
 */
export async function resolveOrderActionIndexes({ vault, sdkRegistry, walletId }) {
    if (!sdkRegistry) throw new Error('resolveOrderActionIndexes: sdkRegistry is required');
    const records = await listAutopayOrders({ vault, walletId });
    let resolved = 0;
    for (const r of records) {
        if (r.orderActionIndex != null) continue;
        let tx;
        try {
            const sdk = sdkRegistry.get(r.chainId);
            tx = await sdk.getTransaction(r.txid, 'tx_hash');
        } catch {
            continue; // explorer unreachable / not indexed yet; retry next cycle
        }
        const rows = Array.isArray(tx?.actions) ? tx.actions : [];
        const orderRow = rows.find((a) =>
            String(a?.action).toUpperCase() === 'ORDER' &&
            a?.action_index != null &&
            (typeof a?.status !== 'string' || !/^invalid/i.test(a.status)));
        if (!orderRow) continue;
        await vault.autopayOrders.put({
            ...r,
            orderActionIndex: String(orderRow.action_index),
        });
        resolved += 1;
    }
    return resolved;
}

/**
 * Append a payment to the cumulative-cap ledger. Idempotent per
 * ORDER_MATCH: a second append for the same match is refused (the
 * engine must never pay one match twice, and a duplicate ledger row
 * would double-count against the GIVE budget).
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} opts.id                     consent record id
 * @param {string} opts.orderMatchActionIndex
 * @param {string} opts.coinAmountBase
 * @param {string} opts.txid                   COINPAY txid
 * @returns {Promise<import('../schemas/autopayOrder.js').AutopayOrder>}
 */
export async function recordAutopayPayment(opts) {
    const { vault, id, orderMatchActionIndex, coinAmountBase, txid } = opts;
    if (!vault) throw new Error('recordAutopayPayment: vault is required');
    const record = await vault.autopayOrders.get(id);
    if (!record) throw new Error(`recordAutopayPayment: no consent record ${id}`);
    if ((record.payments ?? []).some(
        (p) => String(p.orderMatchActionIndex) === String(orderMatchActionIndex))) {
        throw new Error(
            `recordAutopayPayment: match ${orderMatchActionIndex} already recorded`);
    }
    const next = {
        ...record,
        payments: [
            ...(record.payments ?? []),
            {
                orderMatchActionIndex: String(orderMatchActionIndex),
                coinAmountBase: String(coinAmountBase),
                txid: String(txid),
                at: new Date().toISOString(),
            },
        ],
    };
    await vault.autopayOrders.put(next);
    return next;
}
