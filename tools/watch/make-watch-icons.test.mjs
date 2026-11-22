// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { watchAppIconContents, watchIconPlan } from './make-watch-icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = resolve(ROOT, 'tools/watch/make-watch-icons.mjs');

function readPngSize(root, filename) {
    const png = readFileSync(resolve(root, filename));
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test('generator creates every planned watch icon and catalog', () => {
    const scratch = resolve(ROOT, 'tmp');
    mkdirSync(scratch, { recursive: true });
    const fixture = mkdtempSync(resolve(scratch, 'watch-icons-'));

    try {
        const [{ source }] = watchIconPlan();
        const fixtureSource = resolve(fixture, source);
        mkdirSync(dirname(fixtureSource), { recursive: true });
        copyFileSync(resolve(ROOT, source), fixtureSource);

        const generated = spawnSync(process.execPath, [SCRIPT], {
            cwd: fixture,
            encoding: 'utf8',
        });
        assert.equal(generated.status, 0, generated.stderr || generated.stdout);

        for (const { dest, px } of watchIconPlan()) {
            assert.deepEqual(readPngSize(fixture, dest), [px, px], dest);
        }

        const catalog = resolve(fixture, 'packages/mobile/ios/App/WatchApp/Assets.xcassets');
        const iconContents = JSON.parse(readFileSync(
            resolve(catalog, 'AppIcon.appiconset/Contents.json'),
            'utf8',
        ));
        const assetContents = JSON.parse(readFileSync(resolve(catalog, 'Contents.json'), 'utf8'));

        assert.deepEqual(iconContents, watchAppIconContents());
        assert.deepEqual(assetContents, { info: { author: 'xcode', version: 1 } });
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
});
