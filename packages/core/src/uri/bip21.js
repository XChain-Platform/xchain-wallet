// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// BIP21 URI parse/encode — §29.10.
//
// Format:  scheme:address[?param1=value1&param2=value2]
//
// Standard params (all optional):
//   amount    — decimal chain-native units (e.g. BTC for bitcoin:)
//   label     — percent-encoded string
//   message   — percent-encoded string
//
// Extension params with `req-` prefix MUST be supported by the wallet
// or the URI MUST be rejected — per BIP21 spec. The parser surfaces
// them in `required[]` so callers can decide whether to honor or
// reject. XChain doesn't use req- params at launch, but correctness
// here avoids silently accepting bitcoin: URIs from other wallets that
// rely on them.
//
// Scheme is caller-verified — we don't hardcode the set. The wallet
// cross-checks against `ChainRegistry.supportedChains()[...].uriScheme`.

export class InvalidBip21Error extends Error {
    constructor(reason, uri) {
        super(`BIP21: ${reason}`);
        this.name = 'InvalidBip21Error';
        this.uri = uri;
    }
}

/**
 * @typedef {Object} Bip21Parts
 * @property {string} scheme                     e.g. 'bitcoin'
 * @property {string} address
 * @property {string} [amount]                   decimal string
 * @property {string} [label]
 * @property {string} [message]
 * @property {Record<string, string>} params     ALL non-required params (includes standard ones too for easy access)
 * @property {string[]} required                 names of `req-*` params (with req- prefix stripped)
 */

/**
 * Parse a BIP21 URI. Throws `InvalidBip21Error` on malformed input.
 *
 * @param {string} uri
 * @returns {Bip21Parts}
 */
export function parseBip21Uri(uri) {
    if (typeof uri !== 'string' || uri.length === 0) {
        throw new InvalidBip21Error('uri must be a non-empty string', uri);
    }

    const colonIdx = uri.indexOf(':');
    if (colonIdx <= 0) {
        throw new InvalidBip21Error('missing scheme (no ":")', uri);
    }
    const scheme = uri.slice(0, colonIdx).toLowerCase();
    if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
        throw new InvalidBip21Error(`invalid scheme "${scheme}"`, uri);
    }

    const body = uri.slice(colonIdx + 1);
    if (body.length === 0) {
        throw new InvalidBip21Error('missing address', uri);
    }

    const qIdx = body.indexOf('?');
    const address = qIdx < 0 ? body : body.slice(0, qIdx);
    if (address.length === 0) {
        throw new InvalidBip21Error('missing address', uri);
    }

    /** @type {Record<string, string>} */
    const params = {};
    const required = [];

    if (qIdx >= 0) {
        const query = body.slice(qIdx + 1);
        if (query.length > 0) {
            for (const pair of query.split('&')) {
                if (pair.length === 0) continue;
                const eq = pair.indexOf('=');
                const rawKey = eq < 0 ? pair : pair.slice(0, eq);
                const rawVal = eq < 0 ? '' : pair.slice(eq + 1);
                let decodedKey, decodedVal;
                try {
                    decodedKey = decodeURIComponent(rawKey);
                    decodedVal = decodeURIComponent(rawVal);
                } catch {
                    throw new InvalidBip21Error(
                        `invalid percent-encoding in "${pair}"`,
                        uri,
                    );
                }
                if (decodedKey.startsWith('req-')) {
                    const bare = decodedKey.slice(4);
                    required.push(bare);
                    params[decodedKey] = decodedVal;
                } else {
                    params[decodedKey] = decodedVal;
                }
            }
        }
    }

    /** @type {Bip21Parts} */
    const out = {
        scheme,
        address,
        params,
        required,
    };
    if (params.amount !== undefined) out.amount = params.amount;
    if (params.label !== undefined) out.label = params.label;
    if (params.message !== undefined) out.message = params.message;
    return out;
}

/**
 * @typedef {Object} EncodeBip21Opts
 * @property {string} scheme
 * @property {string} address
 * @property {string} [amount]
 * @property {string} [label]
 * @property {string} [message]
 * @property {Record<string, string>} [params]   additional params; req-* keys pass through literally
 */

/**
 * Build a BIP21 URI. Standard params (amount / label / message) can be
 * passed at the top level; additional params go in `params`.
 * Percent-encodes values per RFC 3986.
 *
 * @param {EncodeBip21Opts} opts
 * @returns {string}
 */
export function encodeBip21Uri({ scheme, address, amount, label, message, params = {} }) {
    if (typeof scheme !== 'string' || !/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
        throw new Error(`encodeBip21Uri: invalid scheme "${scheme}"`);
    }
    if (typeof address !== 'string' || address.length === 0) {
        throw new Error('encodeBip21Uri: address is required');
    }

    // Merge, with top-level shorthand overriding `params` for the three
    // standard keys.
    /** @type {Record<string, string>} */
    const merged = { ...params };
    if (amount !== undefined) merged.amount = String(amount);
    if (label !== undefined) merged.label = String(label);
    if (message !== undefined) merged.message = String(message);

    const entries = Object.entries(merged);
    if (entries.length === 0) return `${scheme}:${address}`;

    const query = entries
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    return `${scheme}:${address}?${query}`;
}
