// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawnSync } from 'node:child_process';
import { constants, accessSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { isInvokedDirectly } from '../release/is-invoked-directly.mjs';

export function watchIconPlan() {
    const source = 'packages/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';

    return [
        {
            source,
            dest: 'packages/mobile/ios/App/WatchApp/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png',
            px: 1024,
        },
        {
            source,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-mdpi/ic_launcher.png',
            px: 48,
        },
        {
            source,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-hdpi/ic_launcher.png',
            px: 72,
        },
        {
            source,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-xhdpi/ic_launcher.png',
            px: 96,
        },
        {
            source,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-xxhdpi/ic_launcher.png',
            px: 144,
        },
        {
            source,
            dest: 'packages/mobile/android/wear/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
            px: 192,
        },
    ];
}

export function watchAppIconContents() {
    return {
        images: [
            {
                filename: 'AppIcon-1024.png',
                idiom: 'universal',
                platform: 'watchos',
                size: '1024x1024',
            },
        ],
        info: { author: 'xcode', version: 1 },
    };
}

function json(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

export function run() {
    const plan = watchIconPlan();
    const sips = spawnSync('sips', ['--version'], { stdio: 'ignore' });

    if (sips.error?.code === 'ENOENT') {
        process.stderr.write('make-watch-icons: sips is not on PATH\n');
        return 1;
    }
    if (sips.error || sips.status !== 0) {
        process.stderr.write('make-watch-icons: unable to run sips\n');
        return 1;
    }

    for (const { source } of plan) {
        try {
            accessSync(source, constants.R_OK);
        } catch {
            process.stderr.write(`make-watch-icons: source file is absent: ${source}\n`);
            return 1;
        }
    }

    for (const { source, dest, px } of plan) {
        mkdirSync(dirname(dest), { recursive: true });
        const resized = spawnSync('sips', ['-z', String(px), String(px), source, '--out', dest], {
            stdio: 'inherit',
        });
        if (resized.error || resized.status !== 0) return 1;
    }

    const iconSet = 'packages/mobile/ios/App/WatchApp/Assets.xcassets/AppIcon.appiconset';
    const catalog = 'packages/mobile/ios/App/WatchApp/Assets.xcassets';
    writeFileSync(`${iconSet}/Contents.json`, json(watchAppIconContents()));
    writeFileSync(`${catalog}/Contents.json`, json({ info: { author: 'xcode', version: 1 } }));
    return 0;
}

if (isInvokedDirectly(import.meta.url)) process.exitCode = run();
