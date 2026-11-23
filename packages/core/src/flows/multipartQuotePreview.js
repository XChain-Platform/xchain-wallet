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
    planMultipartFile,
    planMultipartFileBySize,
    quoteMultipartFile,
} from './multipartFilePlan.js';

const CARRIER_BY_METHOD = Object.freeze({
    taproot: 'envelope',
    standard: 'standard',
});

function invalid(field) {
    const error = new TypeError(`multipart quote preview: ${field} is invalid`);
    error.code = 'MULTIPART_PREVIEW_INVALID';
    return error;
}

function validateInput({ bytes, size, rate, methods, lanes }) {
    const sized = bytes == null && Number.isSafeInteger(size) && size > 0;
    if (!sized && (!(bytes instanceof Uint8Array) || bytes.length === 0)) throw invalid('bytes');
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        throw invalid('rate');
    }
    if (!Array.isArray(methods)) throw invalid('methods');
    const seen = new Set();
    for (const method of methods) {
        if (!Object.hasOwn(CARRIER_BY_METHOD, method) || seen.has(method)) {
            throw invalid('methods');
        }
        seen.add(method);
    }
    for (const method of methods) {
        const carrier = CARRIER_BY_METHOD[method];
        if (lanes?.[carrier] === undefined || lanes[carrier] === null) {
            throw invalid(`lanes.${carrier}`);
        }
    }
}

function emptyResult() {
    return {
        quotes: { taproot: null, standard: null },
        reasons: { taproot: null, standard: null },
    };
}

async function planOption({ method, bytes, size, meta, gate, planner }) {
    const carrier = CARRIER_BY_METHOD[method];
    try {
        // A file held by reference is quoted from its size (see planMultipartFileBySize).
        if (bytes == null) return planMultipartFileBySize(size, meta, { carrier, gate });
        return await planner(bytes, meta, { carrier, gate });
    } catch (error) {
        if (error instanceof RangeError && typeof error.code === 'string') return error;
        throw error;
    }
}

export async function previewMultipartQuotes({
    bytes,
    size,
    meta,
    gate,
    rate,
    methods,
    lanes,
    sizes,
    planner = planMultipartFile,
    quoter = quoteMultipartFile,
}) {
    validateInput({ bytes, size, rate, methods, lanes });
    const result = emptyResult();
    for (const method of methods) {
        const carrier = CARRIER_BY_METHOD[method];
        const plan = await planOption({ method, bytes, size, meta, gate, planner });
        if (plan instanceof RangeError) {
            result.reasons[method] = plan.code;
        } else if (plan.parts.length < 2) {
            result.reasons[method] = 'SINGLE_PART';
        } else {
            const quote = await quoter(plan, rate, lanes[carrier], sizes);
            result.quotes[method] = {
                parts: quote.parts,
                transactions: quote.transactions,
                fee: quote.fee,
                fundingTotal: quote.fundingTotal,
            };
        }
    }
    return result;
}
