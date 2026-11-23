// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MULTIPART_FILE_MAX_PARTS } from './fileSizeLimits.js';
import { multipartTransactionCount } from './multipartWaves.js';

function invalidQuote(method) {
    const error = new Error(`Invalid multipart quote for ${method}`);
    error.code = 'MULTIPART_QUOTE_INVALID';
    return error;
}

export function multipartReviewFee(quote) {
    return quote?.fundingTotal;
}

function methodSummary(method, quote) {
    if (quote === null) return { summary: null, fee: null };

    const { parts, transactions } = quote;
    const fee = multipartReviewFee(quote);
    const partsValid = Number.isInteger(parts)
        && parts >= 2
        && parts <= MULTIPART_FILE_MAX_PARTS;
    const transactionsValid = Number.isInteger(transactions)
        && transactions === multipartTransactionCount(parts);
    const feeValid = Number.isFinite(fee) && fee >= 0;

    if (!partsValid || !transactionsValid || !feeValid) {
        throw invalidQuote(method);
    }

    return {
        summary: `${parts} parts, ${transactions} transactions`,
        fee,
    };
}

export function multipartMethodSummaries({ taproot, standard }) {
    return {
        taproot: methodSummary('taproot', taproot),
        standard: methodSummary('standard', standard),
    };
}
