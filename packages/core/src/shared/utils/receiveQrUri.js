// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { encodeBip21Uri, URI_PARAMETER_LIMITS } from '../../uri/bip21.js';

export const RECEIVE_QR_ERROR_CORRECTION = 'M';

// The label a request carries is bounded by the limit the parser applies to a
// scanned link, so a long label never becomes a code this wallet's own Send
// screen refuses.
const REQUEST_LABEL_MAX = URI_PARAMETER_LIMITS.label;

/**
 * The address label as it travels in a payment request: control characters
 * replaced and the text cut, on a whole character, to the URI label limit.
 */
export function requestLabelFor(label) {
    const clean = String(label || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
    let out = '';
    for (const character of clean) {
        if (out.length + character.length > REQUEST_LABEL_MAX) break;
        out += character;
    }
    return out.trim();
}

export function receiveQrUri({ descriptor, chainId, address, label, amount = '', tick = '' }) {
    if (!descriptor?.uriScheme || !chainId || !address) return null;
    const requestAmount = String(amount ?? '').trim();
    const requestTick = String(tick ?? '').trim().toUpperCase();
    return encodeBip21Uri({
        scheme: descriptor.uriScheme,
        address,
        amount: requestAmount,
        label: requestLabelFor(label) || undefined,
        params: {
            chain: chainId,
            ...(requestTick ? { tick: requestTick } : {}),
        },
    });
}
