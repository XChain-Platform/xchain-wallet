// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { watchAppIconContents, watchIconPlan } from './make-watch-icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = resolve(ROOT, 'tools/watch/make-watch-icons.mjs');
const DARWIN_SKIP = 'watch icon rendering requires macOS sips';

function readPngHeader(path) {
    const png = readFileSync(path);
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
    return {
        width: png.readUInt32BE(16),
        height: png.readUInt32BE(20),
        colorType: png.readUInt8(25),
    };
}

test('CLI renders every planned watch icon and catalog manifest', {
    skip: process.platform === 'darwin' ? false : DARWIN_SKIP,
}, () => {
    execFileSync(process.execPath, [CLI], { cwd: ROOT, stdio: 'pipe' });

    for (const { dest, px } of watchIconPlan()) {
        assert.deepEqual(readPngHeader(resolve(ROOT, dest)), {
            width: px,
            height: px,
            colorType: 2,
        });
    }

    const catalog = resolve(ROOT, 'packages/mobile/ios/App/WatchApp/Assets.xcassets');
    assert.deepEqual(
        JSON.parse(readFileSync(resolve(catalog, 'AppIcon.appiconset/Contents.json'), 'utf8')),
        watchAppIconContents(),
    );
    assert.deepEqual(JSON.parse(readFileSync(resolve(catalog, 'Contents.json'), 'utf8')), {
        info: { author: 'xcode', version: 1 },
    });
});

test('CLI exits 1 and names sips when PATH is empty', {
    skip: process.platform === 'darwin' ? false : DARWIN_SKIP,
}, () => {
    assert.throws(
        () => execFileSync(process.execPath, [CLI], {
            cwd: ROOT,
            encoding: 'utf8',
            env: { ...process.env, PATH: '' },
        }),
        (error) => {
            assert.equal(error.status, 1);
            assert.match(`${error.stdout}${error.stderr}`, /sips/i);
            return true;
        },
    );
});
