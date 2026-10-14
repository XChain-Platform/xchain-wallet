// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const indexPath = join(root, 'packages', 'web', 'index.html');
const tokensPath = join(root, 'packages', 'core', 'src', 'ui', 'tokens.css');
const indexHtml = readFileSync(indexPath, 'utf8');
const tokens = readFileSync(tokensPath, 'utf8');

const preloadHref = indexHtml.match(
    /<link\s+rel="preload"\s+href="([^"]+)"\s+as="font"\s+type="font\/woff2"\s+crossorigin\s*\/?>/,
)?.[1];
const fontSource = tokens.match(
    /font-family:\s*'XChain Sans';[\s\S]*?src:\s*url\('([^']+)'\) format\('woff2'\);/,
)?.[1];

assert.ok(preloadHref, 'web entry preloads its main text font');
assert.ok(fontSource, 'shared CSS declares the main WOFF2 text face');
assert.equal(
    resolve(dirname(indexPath), preloadHref),
    resolve(dirname(tokensPath), fontSource),
    'the preload and CSS declaration resolve to the same font file',
);
assert.match(tokens, /font-display:\s*swap;/, 'main text stays visible during font loading');
assert.match(tokens, /font-weight:\s*100 900;/, 'one variable face covers the UI weight range');
assert.match(tokens, /font-family:\s*'XChain Sans Fallback';/, 'shared CSS declares a named fallback');
assert.match(tokens, /src:\s*local\('Arial'\);/, 'fallback uses an installed system font');
for (const property of [
    'size-adjust',
    'ascent-override',
    'descent-override',
    'line-gap-override',
]) {
    assert.match(tokens, new RegExp(`${property}:\\s*[\\d.]+%;`), `${property} matches fallback metrics`);
}
assert.match(
    tokens,
    /--xc-font-sans:\s*'XChain Sans', 'XChain Sans Fallback', system-ui,/,
    'font token keeps metric fallback and platform stack in order',
);

const fontPath = resolve(dirname(tokensPath), fontSource);
assert.equal(
    readFileSync(fontPath).subarray(0, 4).toString('ascii'),
    'wOF2',
    'preloaded asset is a WOFF2 font',
);

console.log('OK: font loading source contract (swap, preload, visible metric fallback)');
