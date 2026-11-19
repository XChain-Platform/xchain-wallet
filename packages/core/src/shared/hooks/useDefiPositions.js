// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isOpenDispenserSelling, isOpenOffer } from '../utils/dispenserPricing.js';
import { compareMergedEntries } from '../utils/pendingHistory.js';
import { formatDecimalAmount } from '../utils/amountFormat.js';

const POSITION_READS = Object.freeze([
    ['dispenser', 'getDispensersForSource'],
    ['stake', 'getStakesForAddress'],
    ['contract', 'getContractStakesForAddress'],
    ['deposit', 'getDepositsForAddress'],
    ['order', 'getOrdersForAddress'],
    ['swap', 'getSwapsForAddress'],
]);

function responseRows(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.rows)) return response.rows;
    if (Array.isArray(response?.orders)) return response.orders;
    if (Array.isArray(response?.swaps)) return response.swaps;
    if (Array.isArray(response?.dispensers)) return response.dispensers;
    return [];
}

function text(value, fallback = '') {
    if (value == null) return fallback;
    const out = String(value).trim();
    return out || fallback;
}

function nativeTicker(chainId) {
    return String(chainId || '').split('-')[0].toUpperCase()
        .replace('BITCOIN', 'BTC')
        .replace('LITECOIN', 'LTC')
        .replace('DOGECOIN', 'DOGE');
}

// A row the explorer sent without a time shows no time, never the load time.
function rowTime(row) {
    const value = Number(row?.timestamp ?? row?.block_time ?? row?.created_at ?? 0);
    return Number.isFinite(value) && value > 0 ? value : null;
}

// Explorer amounts are whole-unit decimal strings; group them for display.
function amountText(value) {
    const raw = text(value);
    return raw ? formatDecimalAmount(raw) : '?';
}

function rowBlock(row) {
    const value = Number(row?.block_index ?? row?.blockIndex ?? 0);
    return Number.isFinite(value) && value > 0 ? value : null;
}

function rowStatus(row) {
    const validity = text(row?.status).toLowerCase();
    if (['invalid', 'failed', 'rejected'].includes(validity)) return 'failed';
    return rowBlock(row) ? 'confirmed' : 'pending';
}

function positive(value) {
    if (value == null || value === '') return true;
    const normalized = text(value).replace(/^\+/, '');
    return /^\d+(?:\.\d+)?$/.test(normalized) && /[1-9]/.test(normalized);
}

function offerStillOpen(row, nowSec) {
    if (!isOpenOffer(row)) return false;
    const expiration = Number(row?.state?.expiration ?? row?.expiration);
    return !(Number.isFinite(expiration) && expiration > 0 && expiration <= nowSec);
}

function positionIdentity(kind, row, address, index) {
    return text(
        row?.stake_id
        ?? row?.action_index
        ?? row?.actionIndex
        ?? row?.contract_action_index
        ?? row?.tx_hash,
        `${address}:${index}`,
    );
}

function positionBase({ kind, row, chainId, address, index }) {
    const identity = positionIdentity(kind, row, address, index);
    return {
        id: `${chainId}:${kind}:${identity}`,
        kind,
        chainId,
        address,
        actionIndex: text(row?.action_index ?? row?.actionIndex, identity),
        status: rowStatus(row),
        blockIndex: rowBlock(row),
        timestamp: rowTime(row),
        txHash: text(row?.tx_hash ?? row?.txHash),
        raw: row,
    };
}

/**
 * Convert one per-address position response into the row shape used by Home.
 * The filters intentionally keep only positions that are still active or open.
 */
export function mapDefiPosition({ kind, row, chainId, address, index = 0, nowSec }) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const base = positionBase({ kind, row, chainId, address, index });

    if (kind === 'dispenser') {
        if (!isOpenDispenserSelling(row)) return null;
        const tick = text(row.give_tick, nativeTicker(chainId));
        const amount = row.state?.give_remaining ?? row.escrow_remaining ?? row.give_remaining ?? row.give_amount;
        return { ...base, action: 'DISPENSER', tick, primary: `${amountText(amount)} ${tick} remaining` };
    }

    if (kind === 'stake') {
        const lifecycle = text(row.status).toLowerCase();
        if (lifecycle && !['active', 'valid', 'open', 'pending', 'unconfirmed'].includes(lifecycle)) return null;
        const tick = text(row.asset ?? row.tick, 'XCHAIN');
        return { ...base, action: 'STAKE', tick, primary: `${amountText(row.amount ?? row.quantity)} ${tick}` };
    }

    if (kind === 'contract') {
        const lifecycle = text(row.status).toLowerCase();
        if (['completed', 'closed', 'cancelled', 'invalid', 'failed'].includes(lifecycle)) return null;
        const tick = text(row.tick ?? row.asset, nativeTicker(chainId));
        return { ...base, action: 'STAKE', tick, primary: `${amountText(row.amount ?? row.quantity)} ${tick} locked` };
    }

    if (kind === 'deposit') {
        const lifecycle = text(row.status).toLowerCase();
        if (['withdrawn', 'closed', 'cancelled', 'invalid', 'failed'].includes(lifecycle)) return null;
        const amount = row.amount ?? row.quantity ?? row.deposit_amount ?? row.balance;
        if (!positive(amount)) return null;
        const tick = text(row.tick ?? row.asset ?? row.coin, nativeTicker(chainId));
        return { ...base, action: 'DEPOSIT', tick, primary: `${amountText(amount)} ${tick} locked` };
    }

    if (kind === 'order') {
        if (!offerStillOpen(row, nowSec)) return null;
        if (row.source != null && String(row.source) !== address) return null;
        const amount = row.state?.give_remaining ?? row.give_remaining ?? row.give_amount;
        if (!positive(amount)) return null;
        const tick = text(row.give_tick ?? row.give_coin, nativeTicker(chainId));
        return { ...base, action: 'ORDER', tick, primary: `${amountText(amount)} ${tick} offered` };
    }

    if (kind === 'swap') {
        if (!offerStillOpen(row, nowSec)) return null;
        if (row.source != null && String(row.source) !== address) return null;
        const amount = row.give_remaining ?? row.give_amount;
        if (!positive(amount)) return null;
        const tick = text(row.give_tick ?? row.give_coin, nativeTicker(chainId));
        return { ...base, action: 'SWAP', tick, primary: `${amountText(amount)} ${tick} offered` };
    }

    return null;
}

/**
 * Load Home DeFi positions with one fixed group of reads per wallet address.
 * Row count never changes the number of messaging calls.
 */
export async function loadDefiPositions({ messaging, walletId, accountId, now = Date.now() }) {
    if (!walletId || typeof messaging?.getAddressesByChain !== 'function') {
        return { positions: [], failed: true };
    }
    const byChain = await messaging.getAddressesByChain(walletId, accountId);
    const requests = [];
    for (const [chainId, addresses] of Object.entries(byChain || {})) {
        if (!Array.isArray(addresses)) continue;
        for (const owner of addresses) {
            if (!owner?.address) continue;
            for (const [kind, method] of POSITION_READS) {
                const read = messaging?.[method];
                const promise = typeof read === 'function'
                    ? Promise.resolve().then(() => read({ chainId, address: owner.address }))
                    : Promise.reject(new Error(`${method} is unavailable`));
                requests.push({ kind, chainId, address: owner.address, promise });
            }
        }
    }
    const settled = await Promise.allSettled(requests.map((request) => request.promise));
    const nowSec = Math.floor(now / 1000);
    const seen = new Set();
    const positions = [];
    settled.forEach((result, requestIndex) => {
        if (result.status !== 'fulfilled') return;
        const request = requests[requestIndex];
        responseRows(result.value).forEach((row, rowIndex) => {
            const position = mapDefiPosition({
                ...request,
                row,
                index: rowIndex,
                nowSec,
            });
            if (!position || seen.has(position.id)) return;
            seen.add(position.id);
            positions.push(position);
        });
    });
    positions.sort(compareMergedEntries);
    return {
        positions,
        failed: requests.length > 0 && settled.every((result) => result.status === 'rejected'),
    };
}

