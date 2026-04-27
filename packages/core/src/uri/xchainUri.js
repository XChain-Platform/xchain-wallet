// xchain: URI parser — §47.
//
// Two URI shapes:
//
//   1. BIP21-style:  xchain:<address>?amount=&tick=&memo=&label=&message=
//      Mirrors per-chain BIP21 (`bitcoin:bc1q…?amount=0.1`) but with the
//      cross-chain `xchain` scheme. The receiving wallet picks the chain
//      based on the address format. Most QR-generated payment requests
//      land here.
//
//   2. Path-style:   xchain://<chainId>/<asset>?amount=&to=&memo=&label=
//      Used when the URI needs to nail a specific chain explicitly (e.g.
//      a regtest endpoint) or when the asset isn't the native coin (e.g.
//      a Counterparty token transfer). The host part is the chainId
//      (`bitcoin-mainnet` / `litecoin-regtest` / etc.) and the path
//      segment is the asset (`XCP` / `BTC` / `^TICK_ID`).
//
// Output is a normalized navigation intent that Send / Receive routes
// consume directly. Returns `{ kind: 'unknown' }` for malformed input
// rather than throwing — the caller already had a string from a QR scan
// or paste, so we don't want to abort their flow over a typo.

import { parseBip21Uri, InvalidBip21Error } from './bip21.js';

const PATH_PREFIX = 'xchain://';
const BIP21_PREFIX = 'xchain:';

/**
 * @typedef {Object} XchainUriIntent
 * @property {'send' | 'receive' | 'unknown'} kind
 * @property {string} [chainId]                     for path-style URIs only
 * @property {string} [asset]                       'BTC' / 'XCP' / '^TICK_ID' / etc.
 * @property {string} [address]                     destination (send) or wallet address (receive)
 * @property {string} [amount]                      decimal string in display units
 * @property {string} [memo]
 * @property {string} [label]
 * @property {string} [message]
 * @property {Record<string, string>} [params]      remaining query params (includes the named ones for caller convenience)
 * @property {string[]} [required]                  names of `req-*` params; if non-empty the caller MUST decide whether to honor each or reject the URI per BIP21
 */

/**
 * @param {string} uri
 * @returns {XchainUriIntent}
 */
export function parseXchainUri(uri) {
    if (typeof uri !== 'string') return { kind: 'unknown' };
    const raw = uri.trim();
    if (raw.length === 0) return { kind: 'unknown' };
    const lower = raw.toLowerCase();

    if (lower.startsWith(PATH_PREFIX)) {
        return parsePathStyle(raw);
    }
    if (lower.startsWith(BIP21_PREFIX)) {
        return parseBip21Style(raw);
    }
    return { kind: 'unknown' };
}

function parsePathStyle(raw) {
    // raw === 'xchain://<chainId>/<asset>?...' (case-sensitive after the scheme)
    const after = raw.slice(PATH_PREFIX.length);
    const queryIdx = after.indexOf('?');
    const pathPart = queryIdx === -1 ? after : after.slice(0, queryIdx);
    const queryPart = queryIdx === -1 ? '' : after.slice(queryIdx + 1);

    const segments = pathPart.split('/').filter(Boolean);
    if (segments.length === 0) return { kind: 'unknown' };

    /** @type {XchainUriIntent} */
    const intent = {
        kind: 'send',
        chainId: segments[0],
        asset: segments.length > 1 ? segments[1] : undefined,
    };

    const { params, required, errors } = parseQuery(queryPart);
    if (errors.length > 0) return { kind: 'unknown' };

    if (params.amount) intent.amount = params.amount;
    if (params.memo) intent.memo = params.memo;
    if (params.label) intent.label = params.label;
    if (params.message) intent.message = params.message;
    if (params.to) intent.address = params.to;
    if (params.kind === 'receive') intent.kind = 'receive';
    intent.params = params;
    if (required.length > 0) intent.required = required;
    return intent;
}

function parseBip21Style(raw) {
    let parts;
    try {
        parts = parseBip21Uri(raw);
    } catch (err) {
        if (err instanceof InvalidBip21Error) return { kind: 'unknown' };
        throw err;
    }
    /** @type {XchainUriIntent} */
    const intent = {
        kind: 'send',
        address: parts.address,
        params: parts.params,
    };
    if (parts.amount) intent.amount = parts.amount;
    if (parts.label) intent.label = parts.label;
    if (parts.message) intent.message = parts.message;
    if (parts.params?.memo) intent.memo = parts.params.memo;
    if (parts.params?.tick) intent.asset = parts.params.tick;
    if (parts.params?.chain) intent.chainId = parts.params.chain;
    if (parts.required?.length > 0) intent.required = parts.required;
    return intent;
}

function parseQuery(queryPart) {
    /** @type {Record<string, string>} */
    const params = {};
    /** @type {string[]} */
    const required = [];
    /** @type {string[]} */
    const errors = [];
    if (!queryPart) return { params, required, errors };
    for (const pair of queryPart.split('&')) {
        if (!pair) continue;
        const eq = pair.indexOf('=');
        if (eq === -1) {
            errors.push(`malformed param "${pair}"`);
            continue;
        }
        let key = pair.slice(0, eq);
        let value;
        try {
            value = decodeURIComponent(pair.slice(eq + 1));
        } catch {
            errors.push(`unable to decode "${pair}"`);
            continue;
        }
        try { key = decodeURIComponent(key); } catch { /* keep raw */ }
        if (key.startsWith('req-')) {
            const name = key.slice(4);
            required.push(name);
            params[name] = value;
        } else {
            params[key] = value;
        }
    }
    return { params, required, errors };
}

/**
 * Build an `xchain://` URI from an intent. Inverse of `parseXchainUri`
 * for path-style URIs. Useful for share / receive surfaces that want to
 * generate URIs for the user to copy.
 *
 * @param {XchainUriIntent} intent
 * @returns {string}
 */
export function buildXchainUri(intent) {
    if (!intent || !intent.chainId) {
        throw new Error('buildXchainUri: chainId is required');
    }
    const path = intent.asset
        ? `${encodeURIComponent(intent.chainId)}/${encodeURIComponent(intent.asset)}`
        : encodeURIComponent(intent.chainId);
    const params = [];
    if (intent.amount) params.push(`amount=${encodeURIComponent(intent.amount)}`);
    if (intent.address) params.push(`to=${encodeURIComponent(intent.address)}`);
    if (intent.memo) params.push(`memo=${encodeURIComponent(intent.memo)}`);
    if (intent.label) params.push(`label=${encodeURIComponent(intent.label)}`);
    if (intent.message) params.push(`message=${encodeURIComponent(intent.message)}`);
    if (intent.kind === 'receive') params.push('kind=receive');
    return params.length > 0
        ? `xchain://${path}?${params.join('&')}`
        : `xchain://${path}`;
}
