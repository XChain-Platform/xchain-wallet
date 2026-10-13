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

assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
assert.match(html, /<link rel="apple-touch-icon"[^>]+href="\/icons\/app-icon-192\.png" \/>/);
assert.match(html, /<meta name="theme-color" content="#FFFFFF" media="\(prefers-color-scheme: light\)" \/>/);
assert.match(html, /<meta name="theme-color" content="#0B0F17" media="\(prefers-color-scheme: dark\)" \/>/);
assert.equal(manifest.name, 'XChain Wallet');
assert.equal(manifest.short_name, 'XChain');
assert.equal(manifest.display, 'standalone');
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
    assert.equal(png.readUInt32BE(16), expectedWidth, `${icon.src} has its declared width`);
    assert.equal(png.readUInt32BE(20), expectedHeight, `${icon.src} has its declared height`);
}

console.log(`OK: web manifest smoke (${manifest.icons.length} icon paths exist)`);
