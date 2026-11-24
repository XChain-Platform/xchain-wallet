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
import fs from 'node:fs';
import test from 'node:test';

import {
    pngHeader,
    wearListingProblems,
} from './verify-listing-assets.mjs';

const readme = fs.readFileSync(
    new URL('../../packages/mobile/store-assets/play/wear/README.md', import.meta.url),
    'utf8',
);
const phrases = [
    'Your balances and wallet alerts on your wrist. Your phone keeps your keys and signs everything.',
    'Tile',
    'complication',
    'QR',
    'Hide amounts',
    'XChain Wallet Android app',
];
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

function screenshot(name, width = 454, height = 454) {
    return { name, header: pngHeader(png(width, height)) };
}

const validScreenshots = [screenshot('w1.png'), screenshot('w2.png')];

test('accepts the landed README and two valid screenshots', () => {
    assert.deepEqual(wearListingProblems({ readme, screenshots: validScreenshots }), []);
});

test('reports a missing README first', () => {
    assert.deepEqual(
        wearListingProblems({ readme: null, screenshots: [] }),
        ['README.md missing', 'no screenshot'],
    );
});

for (const phrase of phrases) {
    test(`reports the missing README phrase: ${phrase}`, () => {
        assert.deepEqual(
            wearListingProblems({
                readme: readme.replace(phrase, ''),
                screenshots: validScreenshots,
            }),
            [`README.md lacks: ${phrase}`],
        );
    });
}

test('reports an em-dash in the README', () => {
    assert.deepEqual(
        wearListingProblems({
            readme: `${readme}${String.fromCodePoint(0x2014)}`,
            screenshots: validScreenshots,
        }),
        ['README.md holds an em-dash'],
    );
});

test('reports an empty screenshot set', () => {
    assert.deepEqual(
        wearListingProblems({ readme, screenshots: [] }),
        ['no screenshot'],
    );
});

test('prefixes each screenshot problem with its name', () => {
    assert.deepEqual(
        wearListingProblems({
            readme,
            screenshots: [screenshot('w1.png', 300, 400)],
        }),
        ['w1.png: not square', 'w1.png: under 384 x 384'],
    );
});
