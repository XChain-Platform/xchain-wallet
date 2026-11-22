// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { watchAppIconContents, watchIconPlan } from './make-watch-icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = resolve(ROOT, 'tools/watch/make-watch-icons.mjs');

// sips ships only with macOS, so Linux CI venues get a stand-in on PATH that answers
// `--version` and writes the source PNG with the requested IHDR size; a Mac keeps real sips.
const SIPS_STUB = `#!/usr/bin/env node
const fs = process.getBuiltinModule('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') process.exit(0);
const [flag, h, w, src, out, dest] = args;
if (flag !== '-z' || out !== '--out') process.exit(2);
const png = fs.readFileSync(src);
png.writeUInt32BE(Number(w), 16);
png.writeUInt32BE(Number(h), 20);
fs.writeFileSync(dest, png);
`;

function sipsEnv(fixture) {
    if (spawnSync('sips', ['--version'], { stdio: 'ignore' }).status === 0) return process.env;
    const bin = resolve(fixture, 'stub-bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(resolve(bin, 'sips'), SIPS_STUB, { mode: 0o755 });
    return { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
}

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
            env: sipsEnv(fixture),
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
