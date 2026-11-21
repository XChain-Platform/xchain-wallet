// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { missingWatchEmbeds } from './watch-embed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const TOOL = join(HERE, 'watch-embed.mjs');
const APP_EMBED = 'Watch/WatchApp.app/Info.plist';
const WIDGET_EMBED = 'Watch/WatchApp.app/PlugIns/WatchWidgets.appex/Info.plist';
const scratchRoot = join(ROOT, 'tmp');
mkdirSync(scratchRoot, { recursive: true });
const work = mkdtempSync(join(scratchRoot, 'watch-embed-'));

after(() => rmSync(work, { recursive: true, force: true }));

function entries(root, included = [APP_EMBED, WIDGET_EMBED]) {
    return [
        `${root}/Watch/`,
        `${root}/Watch/WatchApp.app/`,
        `${root}/Watch/WatchApp.app/PlugIns/`,
        ...included.map((entry) => `${root}/${entry}`),
    ];
}

function invoke(input) {
    try {
        return {
            status: 0,
            stdout: execFileSync(process.execPath, [TOOL, input], { encoding: 'utf8' }),
            stderr: '',
        };
    } catch (error) {
        return {
            status: error.status,
            stdout: String(error.stdout || ''),
            stderr: String(error.stderr || ''),
        };
    }
}

function writeEmbed(root, relative) {
    const path = join(root, ...relative.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'plist\n');
}

test('missingWatchEmbeds accepts both embeds and ignores trailing directory slashes', () => {
    const root = 'Payload/App.app';
    const listed = entries(root).map((entry) => (entry.endsWith('Info.plist') ? `${entry}/` : entry));
    assert.deepEqual(missingWatchEmbeds(listed, `${root}/`), []);
});

test('missingWatchEmbeds reports the app embed when only it is missing', () => {
    const root = 'Payload/App.app';
    assert.deepEqual(missingWatchEmbeds(entries(root, [WIDGET_EMBED]), root), [APP_EMBED]);
});

test('missingWatchEmbeds reports the widget embed when only it is missing', () => {
    const root = 'Payload/App.app';
    assert.deepEqual(missingWatchEmbeds(entries(root, [APP_EMBED]), root), [WIDGET_EMBED]);
});

test('missingWatchEmbeds requires entries beneath the selected app root', () => {
    assert.deepEqual(missingWatchEmbeds(entries('Other/App.app'), 'Payload/App.app'), [
        APP_EMBED,
        WIDGET_EMBED,
    ]);
});

test('the xcarchive CLI reports a missing widget and accepts a complete archive', () => {
    const archive = join(work, 'Wallet.xcarchive');
    const appRoot = join(archive, 'Products', 'Applications', 'App.app');
    writeEmbed(appRoot, APP_EMBED);

    const missing = invoke(archive);
    assert.equal(missing.status, 1, missing.stderr);
    assert.equal(missing.stdout, `${WIDGET_EMBED}\n`);

    writeEmbed(appRoot, WIDGET_EMBED);
    const complete = invoke(archive);
    assert.equal(complete.status, 0, complete.stderr);
    assert.equal(complete.stdout, '');
});

const zipProbe = spawnSync('zip', ['-v'], { encoding: 'utf8' });
const unzipProbe = spawnSync('unzip', ['-v'], { encoding: 'utf8' });
const archiveToolSkip = zipProbe.error || unzipProbe.error
    ? 'zip and unzip are required to exercise the IPA CLI'
    : false;

test('the IPA CLI accepts a zipped app containing both embeds', { skip: archiveToolSkip }, () => {
    const source = join(work, 'ipa-source');
    const appRoot = join(source, 'Payload', 'App.app');
    const ipa = join(work, 'Wallet.ipa');
    writeEmbed(appRoot, APP_EMBED);
    writeEmbed(appRoot, WIDGET_EMBED);
    execFileSync('zip', ['-qr', ipa, 'Payload'], { cwd: source });

    const result = invoke(ipa);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
});

test('the CLI exits 2 for an unreadable path', () => {
    const result = invoke(join(work, 'missing.xcarchive'));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /watch-embed: cannot read/);
});
