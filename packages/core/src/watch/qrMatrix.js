// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function packModules({ size, data }) {
    const moduleCount = size * size;
    const packed = new Uint8Array(Math.ceil(moduleCount / 8));

    for (let index = 0; index < moduleCount; index += 1) {
        if (data[index]) packed[index >> 3] |= 1 << (7 - (index & 7));
    }

    const binary = String.fromCharCode(...packed);
    return { size, bits: btoa(binary) };
}

export function unpackModules({ size, bits }) {
    const binary = atob(bits);
    const expectedLength = Math.ceil((size * size) / 8);
    if (binary.length !== expectedLength) {
        throw new Error(`Packed QR matrix must decode to ${expectedLength} bytes`);
    }

    const data = new Uint8Array(size * size);
    for (let index = 0; index < data.length; index += 1) {
        data[index] = (binary.charCodeAt(index >> 3) >> (7 - (index & 7))) & 1;
    }
    return data;
}
