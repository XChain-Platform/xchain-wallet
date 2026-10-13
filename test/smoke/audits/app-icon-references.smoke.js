// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const requireCjs = createRequire(import.meta.url);
const checked = new Set();

function requireFile(label, path) {
    assert.ok(existsSync(path), `${label} points at missing file ${path}`);
    checked.add(path);
}

const android = join(root, 'packages', 'mobile', 'android', 'app', 'src', 'main');
const res = join(android, 'res');
const androidManifest = readFileSync(join(android, 'AndroidManifest.xml'), 'utf8');
const launcherNames = [...androidManifest.matchAll(/android:(?:roundI|i)con="@mipmap\/([^"/]+)"/g)]
    .map((match) => match[1]);
assert.deepEqual(launcherNames.sort(), ['ic_launcher', 'ic_launcher_round']);

const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
for (const name of launcherNames) {
    for (const density of densities) {
        requireFile(`Android ${density} ${name}`, join(res, `mipmap-${density}`, `${name}.png`));
    }
    for (const api of ['v26', 'v33']) {
        const adaptivePath = join(res, `mipmap-anydpi-${api}`, `${name}.xml`);
        requireFile(`Android ${api} ${name}`, adaptivePath);
        const adaptive = readFileSync(adaptivePath, 'utf8');
        const drawables = [...adaptive.matchAll(/android:drawable="@(mipmap|color)\/([^"/]+)"/g)];
        assert.ok(drawables.length >= 2, `${adaptivePath} declares its adaptive icon layers`);
        for (const [, type, resource] of drawables) {
            if (type === 'mipmap') {
                for (const density of densities) {
                    requireFile(
                        `Android ${api} ${resource} at ${density}`,
                        join(res, `mipmap-${density}`, `${resource}.png`),
                    );
                }
            } else {
                const valuesPath = join(res, 'values', `${resource}.xml`);
                requireFile(`Android ${api} ${resource}`, valuesPath);
                assert.match(readFileSync(valuesPath, 'utf8'), new RegExp(`name="${resource}"`));
            }
        }
    }
}

const iosSet = join(root, 'packages', 'mobile', 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
const iosContents = JSON.parse(readFileSync(join(iosSet, 'Contents.json'), 'utf8'));
for (const image of iosContents.images) {
    assert.ok(image.filename, `iOS ${image.size} icon slot declares a filename`);
    requireFile(`iOS ${image.size} ${image.appearances?.[0]?.value ?? 'light'}`, join(iosSet, image.filename));
}

const desktop = join(root, 'packages', 'desktop');
const desktopConfig = requireCjs(join(desktop, 'electron-builder.config.cjs'));
for (const platform of ['mac', 'win', 'linux']) {
    assert.ok(desktopConfig[platform].icon, `${platform}.icon is explicit`);
    requireFile(`desktop ${platform}.icon`, join(desktop, desktopConfig[platform].icon));
}

const web = join(root, 'packages', 'web');
const publicRoot = join(web, 'public');
const webManifest = JSON.parse(readFileSync(join(publicRoot, 'manifest.webmanifest'), 'utf8'));
for (const icon of webManifest.icons) {
    assert.ok(icon.src.startsWith('/'), `${icon.src} is rooted at the web public directory`);
    requireFile(`web manifest ${icon.sizes}`, join(publicRoot, icon.src.slice(1)));
}
const html = readFileSync(join(web, 'index.html'), 'utf8');
for (const match of html.matchAll(/<link\s+rel="(?:icon|apple-touch-icon)"[^>]+href="(\/[^"?]+)"/g)) {
    requireFile(`web link ${match[1]}`, join(publicRoot, match[1].slice(1)));
}

console.log(`OK: app icon references smoke (${checked.size} referenced files exist)`);
