// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { dustThresholdForCoin } from '../sdk/nativeFeePreflight.js';

function invalidFloor() {
    const error = new TypeError('multipartOutputFloor: outputFloor must be a positive safe integer');
    error.code = 'MULTIPART_LANES_INVALID';
    return error;
}

function unknownFloor(coin) {
    const label = coin ? ` for "${coin}"` : '';
    const error = new Error(`multipartOutputFloor: no output floor${label}`);
    error.code = 'MULTIPART_OUTPUT_FLOOR_UNKNOWN';
    return error;
}

export function multipartOutputFloor({ descriptor, outputFloor } = {}) {
    if (outputFloor !== undefined) {
        if (!Number.isSafeInteger(outputFloor) || outputFloor <= 0) throw invalidFloor();
        return outputFloor;
    }
    const coin = descriptor?.coin;
    if (!coin) throw unknownFloor(coin);
    if (String(coin).toLowerCase() === 'dogecoin') return 1_000_000;
    const floor = dustThresholdForCoin(coin);
    if (!Number.isSafeInteger(floor) || floor <= 0) throw unknownFloor(coin);
    return floor;
}

export function multipartQuoteLanes({ descriptor, outputFloor } = {}) {
    const floor = multipartOutputFloor({ descriptor, outputFloor });
    return {
        envelope: {
            type: 'envelope',
            outputFloor: floor,
            revealPad: descriptor?.coin === 'litecoin',
        },
        standard: { type: 'standard', outputFloor: floor },
    };
}
