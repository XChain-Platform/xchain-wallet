// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defaultRegistry } from '../../registry/index.js';
import { tickerForCoin } from '../../registry/coinTicker.js';
import { explorerPageUrl } from './explorerLinks.js';

const NOT_AVAILABLE = 'Not available';

function firstValue(source, keys) {
    for (const key of keys) {
        const value = source?.[key];
        if (value != null && String(value).trim() !== '') return String(value).trim();
    }
    return null;
}

function titled(value) {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function amountWithUnit(value, unit) {
    if (!value) return NOT_AVAILABLE;
    return unit ? `${value} ${unit}` : value;
}

function receiptDate(timestamp) {
    const numeric = Number(timestamp);
    if (!Number.isFinite(numeric) || numeric <= 0) return NOT_AVAILABLE;
    const milliseconds = numeric < 1e12 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? NOT_AVAILABLE : date.toISOString();
}

/**
 * Builds the intentionally narrow text shared from transaction details.
 * Addresses, memos, contacts, wallet identifiers, and raw action data stay out
 * of the receipt even when the history entry contains them.
 */
export function transactionReceiptText(entry, {
    settings = null,
    balancesHidden = false,
    chainRegistry = defaultRegistry(),
} = {}) {
    const raw = entry?.raw || {};
    const descriptor = chainRegistry?.get?.(entry?.chainId);
    const nativeTicker = descriptor ? tickerForCoin(descriptor.coin) : null;
    const assetTicker = firstValue(raw, ['tick', 'TICK', 'token', 'TOKEN']) || nativeTicker;
    const amount = firstValue(raw, ['amount', 'AMOUNT', 'quantity', 'QUANTITY']);
    const fee = firstValue(entry, ['fee', 'networkFee', 'network_fee'])
        || firstValue(raw, ['network_fee', 'networkFee', 'miner_fee', 'minerFee', 'tx_fee', 'txFee', 'fee', 'FEE']);
    const txid = firstValue(entry, ['txHash', 'txid']);
    const explorerUrl = txid ? explorerPageUrl({
        chainId: entry?.chainId,
        kind: 'transaction',
        value: txid,
        settings,
        chainRegistry,
    }) : null;
    const chain = descriptor
        ? `${descriptor.displayName || titled(descriptor.coin)} ${titled(descriptor.networkKind)}`.trim()
        : firstValue(entry, ['chainId']) || NOT_AVAILABLE;
    const amountText = balancesHidden ? 'Hidden' : amountWithUnit(amount, assetTicker);
    const feeText = balancesHidden ? 'Hidden' : amountWithUnit(fee, nativeTicker);

    return [
        `Date: ${receiptDate(entry?.timestamp)}`,
        `Chain: ${chain}`,
        `Amount: ${amountText}`,
        `Fee: ${feeText}`,
        `Transaction ID: ${txid || NOT_AVAILABLE}`,
        `Explorer: ${explorerUrl || NOT_AVAILABLE}`,
    ].join('\n');
}
