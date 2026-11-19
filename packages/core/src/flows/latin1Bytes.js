// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

function invalidRawData() {
    const error = new Error('rawData must be a non-empty Latin-1 string of file bytes');
    error.code = 'FILE_RAW_DATA_INVALID';
    return error;
}

export function bytesFromLatin1(rawData) {
    if (typeof rawData !== 'string' || rawData.length === 0) throw invalidRawData();
    const bytes = new Uint8Array(rawData.length);
    for (let index = 0; index < rawData.length; index += 1) {
        const value = rawData.charCodeAt(index);
        if (value > 255) throw invalidRawData();
        bytes[index] = value;
    }
    return bytes;
}
