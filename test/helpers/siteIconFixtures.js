// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Site icon test data: a PNG data URL whose signature and IHDR say
// `width` x `height`, padded to `totalBytes`. The validator reads only the
// header and the size, so no real pixel data is needed.

export function pngBytes(width = 64, height = 64, totalBytes = 64) {
    const header = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'latin1');
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    header[24] = 8;
    header[25] = 6;
    const pad = Math.max(0, totalBytes - header.length);
    return Buffer.concat([header, Buffer.alloc(pad)]);
}

export function pngDataUrl(width = 64, height = 64, totalBytes = 64) {
    return `data:image/png;base64,${pngBytes(width, height, totalBytes).toString('base64')}`;
}
