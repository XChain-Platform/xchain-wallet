// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { watchAppIconContents, watchIconPlan } from './make-watch-icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG = resolve(ROOT, 'packages/mobile/ios/App/WatchApp/Assets.xcassets');

function readPngSize(filename) {
    const png = readFileSync(resolve(ROOT, filename));
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test('generated watch icons have every planned size', () => {
    for (const { dest, px } of watchIconPlan()) {
        assert.deepEqual(readPngSize(dest), [px, px], dest);
    }
});

test('generated watchOS catalogs match their plans', () => {
    const iconContents = JSON.parse(readFileSync(
        resolve(CATALOG, 'AppIcon.appiconset/Contents.json'),
        'utf8',
    ));
    const assetContents = JSON.parse(readFileSync(resolve(CATALOG, 'Contents.json'), 'utf8'));

    assert.deepEqual(iconContents, watchAppIconContents());
    assert.deepEqual(assetContents, { info: { author: 'xcode', version: 1 } });
});
