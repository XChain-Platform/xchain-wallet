// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import assert from 'node:assert/strict';
import test from 'node:test';

import { pngHeader } from './verify-listing-assets.mjs';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data = Buffer.alloc(0)) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

function png(colorType, chunks = []) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(422, 0);
    ihdr.writeUInt32BE(514, 4);
    ihdr.writeUInt8(8, 8);
    ihdr.writeUInt8(colorType, 9);
    return Buffer.concat([signature, chunk('IHDR', ihdr), ...chunks, chunk('IDAT')]);
}

const header = (colorType, hasAlpha) => ({
    width: 422,
    height: 514,
    bitDepth: 8,
    colorType,
    hasAlpha,
});

test('reads an opaque truecolour PNG header', () => {
    assert.deepEqual(pngHeader(png(2)), header(2, false));
});

test('finds transparency before the first IDAT', () => {
    assert.deepEqual(pngHeader(png(2, [chunk('tRNS', Buffer.alloc(6))])), header(2, true));
});

test('ignores transparency after the first IDAT', () => {
    const buf = Buffer.concat([png(2), chunk('tRNS', Buffer.alloc(6))]);
    assert.deepEqual(pngHeader(buf), header(2, false));
});

test('recognizes truecolour with alpha', () => {
    assert.deepEqual(pngHeader(png(6)), header(6, true));
});

test('recognizes greyscale with alpha', () => {
    assert.deepEqual(pngHeader(png(4)), header(4, true));
});

test('rejects a bad PNG signature', () => {
    const buf = png(2);
    buf[0] = 0;
    assert.equal(pngHeader(buf), null);
});

test('rejects a missing leading IHDR', () => {
    assert.equal(pngHeader(Buffer.concat([signature, chunk('IDAT')])), null);
});

test('rejects a chunk that runs past the buffer', () => {
    const truncated = Buffer.alloc(12);
    truncated.writeUInt32BE(20);
    truncated.write('tRNS', 4, 'ascii');
    const buf = png(2, [truncated]);
    assert.equal(pngHeader(buf), null);
});
