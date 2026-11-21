// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { watchAppIconContents, watchIconPlan } from './make-watch-icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = 'packages/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';
const WATCH_ROOTS = [
    'packages/mobile/ios/App/WatchApp/',
    'packages/mobile/android/wear/',
];

test('watchIconPlan maps the phone source to every watch icon output', () => {
    assert.deepEqual(watchIconPlan(), [
        {
            source: SOURCE,
            dest: 'packages/mobile/ios/App/WatchApp/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png',
            px: 1024,
        },
        {
            source: SOURCE,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-mdpi/ic_launcher.png',
            px: 48,
        },
        {
            source: SOURCE,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-hdpi/ic_launcher.png',
            px: 72,
        },
        {
            source: SOURCE,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-xhdpi/ic_launcher.png',
            px: 96,
        },
        {
            source: SOURCE,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-xxhdpi/ic_launcher.png',
            px: 144,
        },
        {
            source: SOURCE,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
            px: 192,
        },
    ]);
});

test('watchIconPlan reads an existing source and writes only below watch trees', () => {
    for (const { source, dest } of watchIconPlan()) {
        assert.equal(existsSync(resolve(ROOT, source)), true, `missing source: ${source}`);
        assert.equal(WATCH_ROOTS.some((root) => dest.startsWith(root)), true, `dest outside watch trees: ${dest}`);
    }
});

test('watchAppIconContents describes the watchOS single-size app icon', () => {
    assert.deepEqual(watchAppIconContents(), {
        images: [
            {
                filename: 'AppIcon-1024.png',
                idiom: 'universal',
                platform: 'watchos',
                size: '1024x1024',
            },
        ],
        info: { author: 'xcode', version: 1 },
    });
});

test('planners return independent values', () => {
    const plan = watchIconPlan();
    const contents = watchAppIconContents();
    plan[0].px = 1;
    contents.images[0].filename = 'changed.png';

    assert.equal(watchIconPlan()[0].px, 1024);
    assert.equal(watchAppIconContents().images[0].filename, 'AppIcon-1024.png');
});
