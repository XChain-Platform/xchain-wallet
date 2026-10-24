// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    variadicActionFit,
    variadicActionString,
    variadicSizeMessage,
} from '../../flows/variadicActionSize.js';

/**
 * Serialize the LIST create and edit formats authored by the list forms.
 * ITEM is non-empty at validation time, so the SDK's trailing-empty trimming
 * cannot change this string.
 *
 * @param {Record<string, string | string[]>} params
 * @returns {string}
 */
export function listActionString(params) {
    if (!['0', '1', '4'].includes(params?.VERSION)) {
        throw new Error(`Unsupported LIST size-check version: ${params?.VERSION || 'missing'}`);
    }
    return variadicActionString('LIST', params);
}

/**
 * Measure the exact compiled payload against the 8192-byte ceiling. A LIST ends
 * in a repeating ITEM field, which the wallet cannot verify once the encoder
 * moves it into a Taproot envelope, so the ceiling is 8192 on every chain and
 * signer. The returned values describe the bytes that the existing wire params
 * produce; this helper never normalizes or rewrites them.
 *
 * @param {Record<string, string | string[]>} params
 * @returns {{ actionString: string, compiledBytes: number, maxBytes: number, oversized: boolean, given: number, fit: number, words: { subject: string, singular: string, plural: string } }}
 */
export function listActionSize(params) {
    const actionString = listActionString(params);
    const fit = variadicActionFit('LIST', params);
    return {
        actionString,
        compiledBytes: fit.bytes,
        maxBytes: fit.maxBytes,
        oversized: !fit.fits,
        given: fit.given,
        fit: fit.fit,
        words: wordsFor(params),
    };
}

// What the list's entries are called. An edit does not carry the list's type,
// so it says "items".
function wordsFor(params) {
    if (params?.VERSION === '1') return { subject: 'This change', singular: 'item', plural: 'items' };
    return params?.TYPE === '1'
        ? { subject: 'This list', singular: 'token', plural: 'tokens' }
        : { subject: 'This list', singular: 'address', plural: 'addresses' };
}

/** @param {ReturnType<typeof listActionSize>} size */
export function listActionSizeError(size) {
    if (!size.oversized) return null;
    return variadicSizeMessage({
        fits: false,
        bytes: size.compiledBytes,
        maxBytes: size.maxBytes,
        given: size.given,
        fit: size.fit,
    }, size.words);
}
