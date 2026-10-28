// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { explorerReadFresh, explorerReadOnce } from '../sdk/explorerRateLimit.js';

const KIND_STATUS_FIELD = Object.freeze({
    order: 'order_status',
    swap: 'swap_status',
    dispenser: 'dispenser_status',
});

/**
 * Name of the error this module raises about the referenced offer. Its message
 * is written for the user, and the name is what survives the messaging boundary
 * (MessageHost.serializeError keeps only name, message and code), so a submit
 * surface can show the sentence as written instead of a generic line.
 */
export const OFFER_LIFECYCLE_REFUSAL = 'OfferLifecycleRefusal';

function offerRefusal(message) {
    const err = new Error(message);
    err.name = OFFER_LIFECYCLE_REFUSAL;
    return err;
}

function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function coinValue(map, coin) {
    if (!coin || !map || typeof map !== 'object') return null;
    return finiteNumber(map[coin]);
}

/**
 * Read the chain clock that the indexer uses for market expiry decisions.
 * The timestamp is usable only when its indexed height is the current chain
 * height. This prevents an old block timestamp from keeping an expired offer
 * open while the explorer is catching up.
 *
 * A caller that refuses a signature on the answer passes `fresh`, so the
 * status read goes to the indexer past the explorer wrapper's read reuse and
 * the HTTP cache.
 *
 * @param {any} sdk
 * @param {{ fresh?: boolean }} [options]
 * @returns {Promise<{ blockTime: number|null, indexedHeight: number|null, chainHeight: number|null, stale: boolean }>}
 */
export async function readMarketExpiryClock(sdk, { fresh = false } = {}) {
    if (!sdk || typeof sdk.getStatus !== 'function') {
        return { blockTime: null, indexedHeight: null, chainHeight: null, stale: false };
    }
    let status;
    try {
        status = fresh && typeof sdk.explorer?.get === 'function'
            ? await sdk.explorer.get('/status', { noRetry: true, fresh: true })
            : await explorerReadOnce(sdk, '/status', () => sdk.getStatus({ noRetry: true }));
    } catch {
        return { blockTime: null, indexedHeight: null, chainHeight: null, stale: false };
    }
    const coin = typeof sdk.explorer?.coin === 'string' ? sdk.explorer.coin : null;
    const indexedHeight = coinValue(status?.last_block, coin);
    const chainHeight = coinValue(status?.chain_tip, coin);
    const reportedBlockTime = coinValue(status?.last_block_time, coin);
    const stale = indexedHeight != null && chainHeight != null && indexedHeight !== chainHeight;
    const blockTime = !stale && indexedHeight != null && chainHeight != null
        ? reportedBlockTime
        : null;
    return { blockTime, indexedHeight, chainHeight, stale };
}

function detailOf(row) {
    if (row?.data && !Array.isArray(row.data) && typeof row.data === 'object') return row.data;
    return row;
}

/** Read the mutable lifecycle state for a listed offer when available. */
export async function hydrateMarketOffer(sdk, row) {
    if (!row || typeof row !== 'object' || row.state || typeof sdk?.getAction !== 'function') return row;
    const actionIndex = row.action_index ?? row.actionIndex;
    if (actionIndex == null || String(actionIndex).trim() === '') return row;
    try {
        const detail = detailOf(await sdk.getAction(String(actionIndex)));
        if (!detail || typeof detail !== 'object') return row;
        return {
            ...row,
            ...(detail.state && typeof detail.state === 'object' ? { state: detail.state } : {}),
        };
    } catch {
        return row;
    }
}

export function marketExpirationOf(row) {
    const detail = detailOf(row);
    return finiteNumber(detail?.state?.expiration ?? detail?.expiration);
}

export function marketLifecycleStatusOf(row, kind) {
    const detail = detailOf(row);
    const field = KIND_STATUS_FIELD[kind];
    return String(detail?.state?.status
        ?? detail?.current_status
        ?? (field ? detail?.[field] : null)
        ?? '').trim().toLowerCase();
}

/**
 * @param {any} row
 * @param {'order'|'swap'|'dispenser'} kind
 * @param {{ blockTime: number|null }} clock
 */
export function marketOfferIsExpired(row, kind, clock) {
    if (marketLifecycleStatusOf(row, kind) === 'expired') return true;
    const expiration = marketExpirationOf(row);
    return expiration != null && expiration > 0
        && Number.isFinite(clock?.blockTime) && expiration <= clock.blockTime;
}

function classifyExpiry(row, kind, clock) {
    if (marketLifecycleStatusOf(row, kind) === 'expired') return 'expired';
    const expiration = marketExpirationOf(row);
    if (expiration == null || expiration <= 0) return 'none';
    if (!Number.isFinite(clock?.blockTime)) return 'unknown';
    return expiration <= clock.blockTime ? 'expired' : 'open';
}

function rowWithExpiryStatus(row, kind, expiryStatus) {
    if (!row || typeof row !== 'object') return row;
    const field = KIND_STATUS_FIELD[kind];
    const expired = expiryStatus === 'expired';
    return {
        ...row,
        ...(expired ? { current_status: 'expired' } : {}),
        ...(expired && field ? { [field]: 'expired' } : {}),
        state: {
            ...(row.state && typeof row.state === 'object' ? row.state : {}),
            ...(expired ? { status: 'expired' } : {}),
            expiry_status: expiryStatus,
        },
    };
}

// Hydration reads one detail per row, so a list of hundreds of offers runs a
// few reads at a time instead of all at once into the explorer's rate limit.
const ROW_MAP_CONCURRENCY = 6;

async function mapRowsBounded(rows, mapRow) {
    const out = new Array(rows.length);
    let next = 0;
    const worker = async () => {
        while (next < rows.length) {
            const index = next;
            next += 1;
            out[index] = await mapRow(rows[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(ROW_MAP_CONCURRENCY, rows.length) }, worker));
    return out;
}

async function mapResponseRows(response, mapRow) {
    if (Array.isArray(response)) return mapRowsBounded(response, mapRow);
    if (!response || typeof response !== 'object') return response;
    for (const key of ['data', 'rows', 'orders', 'swaps', 'dispensers']) {
        if (Array.isArray(response[key])) {
            return { ...response, [key]: await mapRowsBounded(response[key], mapRow) };
        }
    }
    if (response.data && typeof response.data === 'object') {
        return { ...response, data: await mapRow(response.data) };
    }
    return await mapRow(response);
}

/**
 * Overlay a computed expired lifecycle onto an explorer response without
 * changing the action-validity `status` field.
 *
 * @param {any} sdk
 * @param {any} response
 * @param {'order'|'swap'|'dispenser'} kind
 * @param {{ hydrate?: boolean }} [options]
 */
export async function withMarketExpiry(sdk, response, kind, { hydrate = false, fresh = false } = {}) {
    const clock = await readMarketExpiryClock(sdk, { fresh });
    return mapResponseRows(response, async (row) => {
        const current = hydrate && Number.isFinite(clock.blockTime)
            ? await hydrateMarketOffer(sdk, row)
            : row;
        return rowWithExpiryStatus(current, kind, classifyExpiry(current, kind, clock));
    });
}

const ORDER_CLOSED_STATUSES = new Set(['filled', 'complete', 'cancelled']);
// The indexer writes 'complete' on a match; 'filled' and 'settled' are the
// other spellings My swaps reads as settled.
const SWAP_CLOSED_STATUSES = new Set(['complete', 'filled', 'settled', 'cancelled']);

const ACTION_REFERENCE = Object.freeze({
    ORDER: { kind: 'order', field: 'ORDER_ACTION_INDEX' },
    SWAP: { kind: 'swap', field: 'SWAP_ACTION_INDEX' },
    DISPENSER: { kind: 'dispenser', field: 'DISPENSER_ACTION_INDEX' },
});

/**
 * Refuse a cancel, edit, or close when its referenced offer is expired. A
 * timestamped offer also requires a current indexed height before signing.
 * Both reads guard the signature, so both read fresh: an offer that filled or
 * was cancelled a moment ago must not hide behind a reused or cached answer.
 *
 * @param {{ sdkRegistry: any, chainId: string, actionData: any }} params
 */
export async function assertReferencedOfferActionable({ sdkRegistry, chainId, actionData }) {
    const ref = ACTION_REFERENCE[actionData?.action];
    const actionIndex = ref ? actionData?.params?.[ref.field] : null;
    if (actionIndex == null || String(actionIndex).trim() === '') return;

    let sdk;
    try { sdk = sdkRegistry?.get?.(chainId); } catch { sdk = null; }
    if (!sdk || typeof sdk.getAction !== 'function' || typeof sdk.getStatus !== 'function') return;

    let detail;
    try {
        // getAction(index) takes no options, so the fresh read names the same path.
        detail = await explorerReadFresh(sdk, `/action/${encodeURIComponent(String(actionIndex))}`,
            () => sdk.getAction(String(actionIndex)));
    } catch {
        throw offerRefusal(`Could not verify whether this ${ref.kind} has expired. Try again.`);
    }
    const lifecycle = marketLifecycleStatusOf(detail, ref.kind);
    if (lifecycle === 'expired') {
        throw offerRefusal(`This ${ref.kind} has expired.`);
    }
    // The indexer records a cancel or edit of a filled or cancelled order as
    // invalid and keeps the fee, so a fill or cancel that landed after the list
    // loaded is refused here, before anything is signed.
    if (ref.kind === 'order' && ORDER_CLOSED_STATUSES.has(lifecycle)) {
        throw offerRefusal(lifecycle === 'cancelled'
            ? 'This order has already been cancelled.'
            : 'This order has already been filled.');
    }
    // A SWAP cancel or edit is invalid unless the swap is open, and the fee
    // is kept the same way.
    if (ref.kind === 'swap' && SWAP_CLOSED_STATUSES.has(lifecycle)) {
        throw offerRefusal(lifecycle === 'cancelled'
            ? 'This swap has already been cancelled.'
            : 'This swap has already been completed.');
    }

    const expiration = marketExpirationOf(detail);
    if (expiration == null || expiration <= 0) return;
    const clock = await readMarketExpiryClock(sdk, { fresh: true });
    if (!Number.isFinite(clock.blockTime)) {
        const reason = clock.stale ? 'the chain height is still syncing' : 'the current chain height is unavailable';
        throw offerRefusal(`Could not verify whether this ${ref.kind} has expired because ${reason}. Try again.`);
    }
    if (expiration <= clock.blockTime) throw offerRefusal(`This ${ref.kind} has expired.`);
}

// PendingTx statuses of a cancel that may still confirm. A failed or dropped
// one cannot, and an indexed one shows in the cancels feed the lists re-read.
const CANCEL_IN_FLIGHT_STATUSES = new Set(['signed', 'queued', 'broadcasting', 'broadcast']);

function pendingTxCancels(tx, ref, actionIndex) {
    if (!tx || tx.action !== ref.action) return false;
    if (tx.params && tx.params[ref.field] != null && String(tx.params.VERSION) === '1') {
        return String(tx.params[ref.field]) === actionIndex;
    }
    const summary = typeof tx.actionSummary === 'string' ? tx.actionSummary : '';
    // Digit boundary after the index: "#900" must not match inside "#9001".
    return new RegExp(`^Cancel ${ref.kind} #${actionIndex}(?!\\d)`).test(summary);
}

/**
 * Refuse a cancel or edit of an order or swap whose cancel this wallet already
 * signed and has not seen fail. The explorer lists the offer as open until that
 * cancel confirms and indexes, so another window, or the same list opened
 * again, still offers Cancel; the second cancel or an edit indexes invalid and
 * keeps its fee. A list that cannot be read is unknown and does not refuse.
 *
 * @param {{ vault: any, chainRegistry: any, chainId: string, actionData: any }} params
 */
export async function assertNoOfferCancelInFlight({ vault, chainRegistry, chainId, actionData }) {
    const ref = actionData?.action === 'ORDER' || actionData?.action === 'SWAP'
        ? { ...ACTION_REFERENCE[actionData.action], action: actionData.action }
        : null;
    const actionIndex = ref ? String(actionData?.params?.[ref.field] ?? '').trim() : '';
    if (!/^\d+$/.test(actionIndex)) return;
    if (typeof vault?.pendingTxs?.list !== 'function') return;
    const descriptor = chainRegistry?.get?.(chainId);
    if (!descriptor) return;
    let rows;
    try {
        rows = await vault.pendingTxs.list();
    } catch {
        return;
    }
    const inFlight = (Array.isArray(rows) ? rows : []).some((tx) => tx
        && CANCEL_IN_FLIGHT_STATUSES.has(tx.status)
        && tx.chain === descriptor.coin
        && tx.network === descriptor.networkKind
        && pendingTxCancels(tx, ref, actionIndex));
    if (!inFlight) return;
    const isCancel = String(actionData.params.VERSION ?? '') === '1';
    throw offerRefusal(isCancel
        ? `A cancel for this ${ref.kind} is already on its way. Nothing was signed. Check History for the earlier cancel.`
        : `This ${ref.kind} has a cancel on its way. Nothing was signed. Check History for the earlier cancel.`);
}
