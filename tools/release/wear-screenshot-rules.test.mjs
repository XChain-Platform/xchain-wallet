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

import {
    pngHeader,
    WEAR_SCREENSHOT_MIN,
    wearScreenshotProblems,
} from './verify-listing-assets.mjs';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data = Buffer.alloc(0)) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

function png(width, height) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.writeUInt8(8, 8);
    ihdr.writeUInt8(2, 9);
    return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT')]);
}

test('exports the Wear OS screenshot minimum', () => {
    assert.equal(WEAR_SCREENSHOT_MIN, 384);
});

for (const side of [384, 454]) {
    test(`accepts a ${side} x ${side} PNG`, () => {
        assert.deepEqual(wearScreenshotProblems(pngHeader(png(side, side))), []);
    });
}

test('rejects a screenshot that is not square', () => {
    assert.deepEqual(
        wearScreenshotProblems(pngHeader(png(384, 383))),
        ['not square', 'under 384 x 384'],
    );
});

test('rejects a square screenshot below the minimum', () => {
    assert.deepEqual(wearScreenshotProblems(pngHeader(png(383, 383))), ['under 384 x 384']);
});

test('reports every applicable problem in order', () => {
    assert.deepEqual(
        wearScreenshotProblems(pngHeader(png(300, 400))),
        ['not square', 'under 384 x 384'],
    );
});

test('rejects a missing PNG header', () => {
    assert.deepEqual(wearScreenshotProblems(null), ['not a PNG']);
});
