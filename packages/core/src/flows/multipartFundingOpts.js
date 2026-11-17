// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MULTIPART_WAVE_PIECES } from './multipartWaves.js';

function invalid(field) {
    const error = new Error(`multipartFundingEncoderOpts: invalid ${field}`);
    error.code = 'FILE_FUNDING_OPTS_INVALID';
    return error;
}

/**
 * Build the encoder request for a multi-part file's funding transaction.
 *
 * @param {object} opts
 * @param {{address: string, publicKey: string}} opts.source
 * @param {number[]} opts.pieceValues
 * @param {number} opts.rate
 * @returns {{pubkey: string, sourceAddress: string, change: string,
 *   customOutputs: Array<{address: string, value: number}>, feePerKb: number}}
 */
export function multipartFundingEncoderOpts({ source, pieceValues, rate } = {}) {
    if (typeof source?.publicKey !== 'string' || !/^(?:02|03)[0-9a-f]{64}$/i.test(source.publicKey)) {
        throw invalid('source.publicKey');
    }
    if (typeof source?.address !== 'string' || source.address.trim().length === 0) {
        throw invalid('source.address');
    }
    if (!Array.isArray(pieceValues)
        || pieceValues.length < 1
        || pieceValues.length > MULTIPART_WAVE_PIECES) {
        throw invalid('pieceValues');
    }
    const badValue = pieceValues.findIndex((value) => !Number.isSafeInteger(value) || value <= 0);
    if (badValue !== -1) throw invalid(`pieceValues[${badValue}]`);
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        throw invalid('rate');
    }

    return {
        // The encoder picks the funding UTXOs from `pubkey`; the address keeps a P2PKH
        // owner's source exact where a bare key would resolve to P2WPKH.
        pubkey: source.address,
        sourceAddress: source.address,
        change: source.address,
        customOutputs: pieceValues.map((value) => ({ address: source.address, value })),
        feePerKb: rate * 1000,
    };
}
