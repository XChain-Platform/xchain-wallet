// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    multipartTransactionCount,
    multipartWaveRanges,
} from './multipartWaves.js';

function invalidQuote() {
    const error = new TypeError('multipartWaveQuote: outputs must be positive safe integers');
    error.code = 'MULTIPART_WAVE_QUOTE_INVALID';
    return error;
}

export function multipartWaveQuote(quote) {
    const outputs = quote?.outputs;
    if (!Array.isArray(outputs)
        || outputs.length === 0
        || !outputs.every((value) => Number.isSafeInteger(value) && value > 0)) {
        throw invalidQuote();
    }

    const totalParts = outputs.length - 1;
    const waves = multipartWaveRanges(totalParts).map(({ index, from, to }) => {
        const waveOutputs = outputs.slice(from, to + 1);
        return {
            index,
            from,
            to,
            outputs: waveOutputs,
            fundingTotal: waveOutputs.reduce((sum, value) => sum + value, 0),
        };
    });

    return {
        waves,
        waveCount: waves.length,
        transactions: multipartTransactionCount(totalParts),
    };
}
