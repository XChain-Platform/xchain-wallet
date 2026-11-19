// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    GATED_MULTIPART_MAX_BYTES,
    MULTIPART_FILE_MAX_BYTES,
    MULTIPART_FILE_MAX_PARTS,
    multipartPartCapacity,
} from './fileSizeLimits.js';

const CARRIER_BY_METHOD = Object.freeze({
    taproot: 'envelope',
    standard: 'standard',
});
const METHODS = Object.keys(CARRIER_BY_METHOD);
const SIZE_REASONS = new Set([
    'ORIGINAL_BYTES_TOO_LARGE',
    'STORED_BYTES_TOO_LARGE',
]);

function invalid(subject) {
    const error = new TypeError(`multipart field reasons: ${subject} is invalid`);
    error.code = 'MULTIPART_FIELD_REASONS_INVALID';
    return error;
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mapMethod(method, quote, reason) {
    if (quote != null && reason != null) throw invalid(method);
    if (quote != null || reason == null) return { reason: null, cap: null, single: false };
    if (reason === 'SINGLE_PART') return { reason: null, cap: null, single: true };
    if (reason === 'GATED_BYTES_TOO_LARGE') {
        return { reason: 'tooLarge', cap: GATED_MULTIPART_MAX_BYTES, single: false };
    }
    if (SIZE_REASONS.has(reason)) {
        return { reason: 'tooLarge', cap: MULTIPART_FILE_MAX_BYTES, single: false };
    }
    if (reason === 'TOO_MANY_PARTS') {
        const carrier = CARRIER_BY_METHOD[method];
        const indexDigits = String(MULTIPART_FILE_MAX_PARTS - 1).length;
        const cap = Math.min(
            MULTIPART_FILE_MAX_PARTS * multipartPartCapacity(carrier, indexDigits),
            MULTIPART_FILE_MAX_BYTES,
        );
        return { reason: 'tooLarge', cap, single: false };
    }
    throw invalid(method);
}

export function multipartFieldReasons(preview) {
    if (!isRecord(preview)) throw invalid('preview');
    if (!isRecord(preview.quotes)) throw invalid('quotes');
    if (!isRecord(preview.reasons)) throw invalid('reasons');
    const result = {
        reasons: { taproot: null, standard: null },
        caps: { taproot: null, standard: null },
        single: { taproot: false, standard: false },
    };
    for (const method of METHODS) {
        const mapped = mapMethod(method, preview.quotes[method], preview.reasons[method]);
        result.reasons[method] = mapped.reason;
        result.caps[method] = mapped.cap;
        result.single[method] = mapped.single;
    }
    return result;
}
