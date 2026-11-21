// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodedBytes(bits) {
    if (!BASE64.test(bits)) return undefined;
    try {
        const binary = typeof atob === 'function'
            ? atob(bits)
            : Buffer.from(bits, 'base64').toString('binary');
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
        return undefined;
    }
}

export function checkQrBits({ size, bits } = {}) {
    if (!Number.isInteger(size) || size < 1 || typeof bits !== 'string') return false;
    const bytes = decodedBytes(bits);
    const bitCount = size * size;
    if (!bytes || bytes.length !== Math.ceil(bitCount / 8)) return false;
    const padding = bytes.length * 8 - bitCount;
    return padding === 0 || (bytes.at(-1) & ((1 << padding) - 1)) === 0;
}

export default checkQrBits;
