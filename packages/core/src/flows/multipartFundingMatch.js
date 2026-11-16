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

function validateOutputs(expectedOutputs, fundingTxOutputs) {
    if (!Array.isArray(expectedOutputs) || !Array.isArray(fundingTxOutputs)) {
        throw fundingError(FUNDING_INPUT_INVALID, 'Funding outputs must be arrays');
    }
    if (!expectedOutputs.every(hasValidValue) || !fundingTxOutputs.every(hasValidValue)) {
        throw fundingError(FUNDING_INPUT_INVALID, 'Funding output values must be non-negative safe integers');
    }
}

function matchedOutputIndexes(expectedOutputs, fundingTxOutputs) {
    const consumed = new Set();
    return expectedOutputs.map((expected, pieceIndex) => {
        const outputIndex = fundingTxOutputs.findIndex((output, index) => (
            !consumed.has(index)
            && output.address === expected.address
            && output.value === expected.value
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
    return matchedOutputIndexes(expectedOutputs, fundingTxOutputs).map((outputIndex) => {
        const output = fundingTxOutputs[outputIndex];
        return {
            txid: fundingTxid,
            vout: output.vout,
            value: output.value,
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
