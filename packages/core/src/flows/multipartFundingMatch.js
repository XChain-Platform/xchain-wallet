// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const FUNDING_INPUT_INVALID = 'FUNDING_INPUT_INVALID';
const FUNDING_OUTPUT_MISSING = 'FUNDING_OUTPUT_MISSING';

function fundingError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function hasValidValue(output) {
    return Number.isSafeInteger(output?.value) && output.value >= 0;
}

function exactValue(value) {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
    }
    if (typeof value === 'bigint') return value >= 0n ? value : null;
    if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
    return null;
}

function validateOutputs(expectedOutputs, fundingTxOutputs) {
    if (!Array.isArray(expectedOutputs) || !Array.isArray(fundingTxOutputs)) {
        throw fundingError(FUNDING_INPUT_INVALID, 'Funding outputs must be arrays');
    }
    if (!expectedOutputs.every(hasValidValue)
        || !fundingTxOutputs.every((output) => exactValue(output?.value) !== null)) {
        throw fundingError(FUNDING_INPUT_INVALID, 'Funding output values must be exact non-negative integers');
    }
}

function matchedOutputIndexes(expectedOutputs, fundingTxOutputs) {
    const consumed = new Set();
    return expectedOutputs.map((expected, pieceIndex) => {
        const outputIndex = fundingTxOutputs.findIndex((output, index) => (
            !consumed.has(index)
            && output.address === expected.address
            && exactValue(output.value) === BigInt(expected.value)
        ));
        if (outputIndex < 0) {
            throw fundingError(FUNDING_OUTPUT_MISSING, `Funding output missing for piece ${pieceIndex}`);
        }
        consumed.add(outputIndex);
        return outputIndex;
    });
}

export function matchFundingOutputs(expectedOutputs, fundingTxOutputs, fundingTxid) {
    validateOutputs(expectedOutputs, fundingTxOutputs);
    if (typeof fundingTxid !== 'string' || fundingTxid.trim().length === 0) {
        throw fundingError(FUNDING_INPUT_INVALID, 'Funding transaction id must not be empty');
    }
    return matchedOutputIndexes(expectedOutputs, fundingTxOutputs).map((outputIndex, pieceIndex) => {
        const output = fundingTxOutputs[outputIndex];
        return {
            txid: fundingTxid,
            vout: output.vout,
            value: expectedOutputs[pieceIndex].value,
            scriptPubKey: output.scriptPubKey,
        };
    });
}

export function fundingMatchesQuote(expectedOutputs, fundingTxOutputs) {
    try {
        validateOutputs(expectedOutputs, fundingTxOutputs);
        matchedOutputIndexes(expectedOutputs, fundingTxOutputs);
        return true;
    } catch {
        return false;
    }
}
