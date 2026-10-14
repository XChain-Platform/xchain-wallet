// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', '..', '..', 'packages', 'web');
const publicRoot = join(webRoot, 'public');
const html = readFileSync(join(webRoot, 'index.html'), 'utf8');
const manifest = JSON.parse(readFileSync(join(publicRoot, 'manifest.webmanifest'), 'utf8'));
const tokens = readFileSync(join(webRoot, '..', 'core', 'src', 'ui', 'tokens.css'), 'utf8');
const lightBackground = tokens.match(
    /\/\* Light theme - default \*\/[\s\S]*?--xc-bg:\s*(#[0-9A-F]{6});/,
)?.[1];
const darkBackground = tokens.match(
    /:root\[data-xc-theme="dark"\]\s*\{[\s\S]*?--xc-bg:\s*(#[0-9A-F]{6});/,
)?.[1];

assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
assert.equal(lightBackground, '#FFFFFF');
assert.equal(darkBackground, '#0B0F17');
assert.match(html, new RegExp(
    `<meta name="theme-color" content="${lightBackground}" media="\\(prefers-color-scheme: light\\)" \\/>`,
));
assert.match(html, new RegExp(
    `<meta name="theme-color" content="${darkBackground}" media="\\(prefers-color-scheme: dark\\)" \\/>`,
));
assert.match(html, new RegExp(`html, body \\{ background: ${lightBackground}; \\}`));
assert.match(html, new RegExp(`background: ${darkBackground};`));
assert.equal(manifest.name, 'XChain Wallet');
assert.equal(manifest.short_name, 'XChain');
assert.match(html, new RegExp(`<title>${manifest.name}<\\/title>`));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.theme_color, lightBackground);
assert.equal(manifest.background_color, lightBackground);
assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ['192x192', '512x512']);

for (const icon of manifest.icons) {
    const iconPath = join(publicRoot, icon.src.slice(1));
    assert.ok(icon.src.startsWith('/'), `${icon.src} is rooted at the web public directory`);
    assert.ok(
        existsSync(iconPath),
        `manifest icon exists: ${icon.src}`,
    );
    const png = readFileSync(iconPath);
    const [expectedWidth, expectedHeight] = icon.sizes.split('x').map(Number);
    assert.equal(icon.type, 'image/png');
    assert.deepEqual(icon.purpose.split(/\s+/).sort(), ['any', 'maskable']);
    assert.equal(png.readUInt32BE(16), expectedWidth, `${icon.src} has its declared width`);
    assert.equal(png.readUInt32BE(20), expectedHeight, `${icon.src} has its declared height`);
}

const appleTouchIcon = html.match(
    /<link rel="apple-touch-icon" sizes="(\d+)x(\d+)" href="(\/[^"?]+)" \/>/,
);
assert.ok(appleTouchIcon, 'head declares a sized apple-touch-icon');
const appleTouchPng = readFileSync(join(publicRoot, appleTouchIcon[3].slice(1)));
assert.equal(appleTouchPng.readUInt32BE(16), Number(appleTouchIcon[1]));
assert.equal(appleTouchPng.readUInt32BE(20), Number(appleTouchIcon[2]));

console.log(`OK: web manifest smoke (${manifest.icons.length} icon paths exist)`);
