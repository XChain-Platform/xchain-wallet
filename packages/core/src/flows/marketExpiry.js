// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

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
 * @param {any} sdk
 * @returns {Promise<{ blockTime: number|null, indexedHeight: number|null, chainHeight: number|null, stale: boolean }>}
 */
export async function readMarketExpiryClock(sdk) {
    if (!sdk || typeof sdk.getStatus !== 'function') {
        return { blockTime: null, indexedHeight: null, chainHeight: null, stale: false };
    }
    let status;
    try {
        status = await sdk.getStatus({ noRetry: true });
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

async function mapResponseRows(response, mapRow) {
    if (Array.isArray(response)) return Promise.all(response.map(mapRow));
    if (!response || typeof response !== 'object') return response;
    for (const key of ['data', 'rows', 'orders', 'swaps', 'dispensers']) {
        if (Array.isArray(response[key])) {
            return { ...response, [key]: await Promise.all(response[key].map(mapRow)) };
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
export async function withMarketExpiry(sdk, response, kind, { hydrate = false } = {}) {
    const clock = await readMarketExpiryClock(sdk);
    return mapResponseRows(response, async (row) => {
        const current = hydrate && Number.isFinite(clock.blockTime)
            ? await hydrateMarketOffer(sdk, row)
            : row;
        return rowWithExpiryStatus(current, kind, classifyExpiry(current, kind, clock));
    });
}

const ORDER_CLOSED_STATUSES = new Set(['filled', 'complete', 'cancelled']);

const ACTION_REFERENCE = Object.freeze({
    ORDER: { kind: 'order', field: 'ORDER_ACTION_INDEX' },
    SWAP: { kind: 'swap', field: 'SWAP_ACTION_INDEX' },
    DISPENSER: { kind: 'dispenser', field: 'DISPENSER_ACTION_INDEX' },
});

/**
 * Refuse a cancel, edit, or close when its referenced offer is expired. A
 * timestamped offer also requires a current indexed height before signing.
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
        detail = await sdk.getAction(String(actionIndex));
    } catch {
        throw offerRefusal(`Could not verify whether this ${ref.kind} has expired. Try again.`);
    }
    const lifecycle = marketLifecycleStatusOf(detail, ref.kind);
    if (lifecycle === 'expired') {
        throw offerRefusal(`This ${ref.kind} has expired.`);
    }
    // The indexer records a cancel or edit of an order that is no longer open as
    // invalid and keeps the fee, so a fill or cancel that landed after the list
    // loaded is refused here, before anything is signed.
    if (ref.kind === 'order' && ORDER_CLOSED_STATUSES.has(lifecycle)) {
        throw offerRefusal(lifecycle === 'cancelled'
            ? 'This order has already been cancelled.'
            : 'This order has already been filled.');
    }

    const expiration = marketExpirationOf(detail);
    if (expiration == null || expiration <= 0) return;
    const clock = await readMarketExpiryClock(sdk);
    if (!Number.isFinite(clock.blockTime)) {
        const reason = clock.stale ? 'the chain height is still syncing' : 'the current chain height is unavailable';
        throw offerRefusal(`Could not verify whether this ${ref.kind} has expired because ${reason}. Try again.`);
    }
    if (expiration <= clock.blockTime) throw offerRefusal(`This ${ref.kind} has expired.`);
}
