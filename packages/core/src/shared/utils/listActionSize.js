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
    ENVELOPE_MAX_PAYLOAD,
    MAX_COMPILED_ACTION_BYTES,
} from '../../flows/fileSizeLimits.js';
import {
    compiledPayloadByteLen,
    envelopeAvailableFor,
} from '../../flows/envelopeSelection.js';

/**
 * Serialize the LIST create and edit formats authored by the list forms.
 * ITEM is non-empty at validation time, so the SDK's trailing-empty trimming
 * cannot change this string.
 *
 * @param {Record<string, string | string[]>} params
 * @returns {string}
 */
export function listActionString(params) {
    const items = Array.isArray(params?.ITEM) ? params.ITEM : [];
    if (params?.VERSION === '0') {
        return ['LIST', '0', params.TYPE || '', params.MEMO || '', ...items].join('|');
    }
    if (params?.VERSION === '4') {
        return [
            'LIST', '4', params.TYPE || '', params.NAME || '', params.DESCRIPTION || '',
            params.MEMO || '', ...items,
        ].join('|');
    }
    if (params?.VERSION === '1') {
        return [
            'LIST', '1', params.EDIT || '', params.LIST_ACTION_INDEX || '',
            params.MEMO || '', ...items,
        ].join('|');
    }
    throw new Error(`Unsupported LIST size-check version: ${params?.VERSION || 'missing'}`);
}

/**
 * Measure the exact compiled payload and select the carrier ceiling available
 * to this chain and address. The returned values describe the bytes that the
 * existing wire params produce; this helper never normalizes or rewrites them.
 *
 * @param {Record<string, string | string[]>} params
 * @param {{ addressTypes?: string[] } | null} descriptor
 * @param {{ source?: string, publicKey?: string } | null} fromAddress
 * @returns {{ actionString: string, compiledBytes: number, maxBytes: number, oversized: boolean }}
 */
export function listActionSize(params, descriptor, fromAddress) {
    const actionString = listActionString(params);
    const compiledBytes = compiledPayloadByteLen(actionString);
    const hasEnvelopeKey = /^(02|03)[0-9a-fA-F]{64}$/.test(fromAddress?.publicKey || '');
    const maxBytes = hasEnvelopeKey && envelopeAvailableFor(descriptor, fromAddress)
        ? ENVELOPE_MAX_PAYLOAD
        : MAX_COMPILED_ACTION_BYTES;
    return { actionString, compiledBytes, maxBytes, oversized: compiledBytes > maxBytes };
}

/** @param {{ compiledBytes: number, maxBytes: number, oversized: boolean }} size */
export function listActionSizeError(size) {
    if (!size.oversized) return null;
    return `This list action is ${size.compiledBytes.toLocaleString('en-US')} bytes, over the ${size.maxBytes.toLocaleString('en-US')}-byte limit. Remove some items.`;
}
