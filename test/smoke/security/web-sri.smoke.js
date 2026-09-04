// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: the web SPA build stamps Subresource Integrity hashes.
//
// The CSP (web-csp.smoke.js) pins WHERE scripts may come from. This pins WHAT
// they contain: index.html carries a sha384 of every script/stylesheet it loads,
// so a bundle tampered with on the asset host cannot execute in a page that
// holds the user's decrypted seed.
//
// Two parts:
//   1. the build is wired (source scan, always runs);
//   2. if a dist/ build exists, every integrity attribute in it actually MATCHES
//      the bytes of the file it points at. That second check is the one that
//      matters: an integrity hash of the wrong bytes is not a weaker guarantee,
//      it is a page that refuses to load its own JavaScript.

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const webDir = join(wsRoot, 'packages', 'web');

// --- 1. The build is wired ------------------------------------------------

const viteSrc = readFileSync(join(webDir, 'vite.config.js'), 'utf8');
assert.match(viteSrc, /import \{ sriPlugin \} from '\.\/sri\.js';/, 'vite.config imports sriPlugin');
assert.match(viteSrc, /sriPlugin\(\)/, 'vite.config registers sriPlugin()');
// POSITION, not merely presence. vite.config.js states the invariant in a
// comment ("Last: must see the final tag set + final bundle bytes") and nothing
// enforced it, so moving sriPlugin() above another plugin stayed green: any
// plugin running after it can rewrite an emitted tag or a bundle byte AFTER the
// hash was taken, and index.html then carries a sha384 of bytes that no longer
// ship. The browser's answer to that is to refuse to run the wallet's own
// JavaScript, so a reorder is a build that dies rather than one that degrades.
assert.match(
    viteSrc,
    /sriPlugin\(\)\s*,?\s*\]/,
    'sriPlugin() must be the LAST entry of the plugins array, so it hashes the'
    + ' final tag set and the final bundle bytes; move it back to the end',
);

const sriSrc = readFileSync(join(webDir, 'sri.js'), 'utf8');
assert.match(sriSrc, /apply: 'build'/, 'SRI is build-only (dev HMR rewrites assets on the fly)');
assert.match(sriSrc, /writeBundle\(/, 'SRI hashes files in writeBundle, i.e. the bytes that actually ship');
// Guard the regression that hashing chunk.code would reintroduce: with sourcemaps
// on, the emitted .js carries a trailing sourceMappingURL comment that chunk.code
// does not, so a hash taken there can never match the served file.
assert.doesNotMatch(
    sriSrc,
    /entry\.type === 'chunk' \? entry\.code/,
    'SRI must not hash the in-memory chunk (sourcemap comment makes it differ from the served file)',
);

// --- 2. If a build exists, its hashes must be correct ---------------------

const indexPath = join(webDir, 'dist', 'index.html');
if (!existsSync(indexPath)) {
    console.log('web-sri smoke OK (wiring only; no dist/ build present)');
    process.exit(0);
}

const html = readFileSync(indexPath, 'utf8');
const tags = html.match(/<(?:script|link)\b[^>]*>/gi) ?? [];

let checked = 0;
for (const tag of tags) {
    const integrity = (tag.match(/\sintegrity="([^"]+)"/) ?? [])[1];
    const url = (tag.match(/\s(?:src|href)="([^"]+)"/) ?? [])[1];
    if (!url) continue;

    // Locality, not a `/assets/` prefix. The one executable tag in the shipped
    // page that does NOT live under /assets/ is `<script src="/boot-check.js">`,
    // copied verbatim out of packages/web/public - and it is the FIRST code the
    // page runs, ahead of the module bundle, so it is precisely what SRI is for.
    // The prefix filter exempted it, and the plugin treats an asset it cannot
    // find on disk as advisory (sri.js: a miss lands in `skipped`, which is only
    // printed), so an unhashed boot-check.js would have shipped green - the
    // build succeeded, this smoke passed on the /assets/ tags, and the script
    // that runs before the hashed bundle carried no integrity at all. Anything
    // not absolute (http:, https:, //host) and not a data: URI is ours to check.
    const isExternal = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^data:/i.test(url);
    if (isExternal) continue;
    // ...and the tag must want integrity at all: a <link rel="icon"> is not
    // executable and the plugin deliberately leaves it alone (sri.js
    // wantsIntegrity). Asserting on a favicon would fail the build for no gain.
    const wantsIntegrity = /^<script/i.test(tag)
        || /rel="(?:stylesheet|modulepreload)"/i.test(tag);
    if (!wantsIntegrity) continue;

    assert.ok(integrity, `built asset ${url} carries no integrity attribute`);
    assert.match(tag, /\scrossorigin/, `built asset ${url} carries integrity but no crossorigin`);

    // Resolved exactly as the plugin's lookup resolves it, so a tag that gains a
    // query string ("?v=2") is still verified rather than quietly missing.
    const file = join(webDir, 'dist', url.replace(/^\/+/, '').split(/[?#]/)[0]);
    assert.ok(existsSync(file), `integrity points at a missing file: ${url}`);
    const want = `sha384-${createHash('sha384').update(readFileSync(file)).digest('base64')}`;
    assert.equal(
        integrity,
        want,
        `integrity for ${url} does not match the bytes on disk; the browser would refuse to load it`,
    );
    checked += 1;
}

assert.ok(checked > 0, 'dist/index.html loads no local assets with integrity: SRI did not run');
// The public-root script is the one an /assets/ filter exempts, so name it: a
// `checked > 0` satisfied by the bundle tags alone is exactly how its absence
// stays invisible.
assert.ok(
    tags.some((t) => /^<script/i.test(t) && /\ssrc="\/boot-check\.js"/.test(t) && /\sintegrity="sha384-/.test(t)),
    'dist/index.html does not carry an sha384 integrity on <script src="/boot-check.js">, the '
    + 'pre-bundle capability floor and the first code the page runs. If it is missing from the '
    + 'page entirely, this assertion is what needs updating; if the tag is there without an '
    + 'integrity attribute, the public-dir file was not on disk when sriPlugin ran and the wallet '
    + 'is shipping an unhashed same-origin script.',
);
console.log(`web-sri smoke OK (${checked} built asset(s) hash-verified against dist/)`);
