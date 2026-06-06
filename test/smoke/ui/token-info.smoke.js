// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3 —
// `messaging.getTokenInfo` host method + TokenDetail richer metadata.
//
// Pins:
//   - flows/tokenInfo.js exports normalizeTokenInfo / extractImageUrl /
//     tokenInfoFor with the documented shape
//   - flows/index.js re-exports them
//   - createBackgroundHost.js registers the `tick.info` route
//   - all three messaging shells expose getTokenInfo({chainId, tick})
//   - useTokenInfo hook exists with module-level cache
//   - TokenDetail.jsx imports + uses useTokenInfo, renders Description
//     card + Creator / Total supply / Status metadata rows

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');

// --- 1. flow module exists + exports the canonical surface --------------

const flowPath = join(core, 'src', 'flows', 'tokenInfo.js');
assert.ok(existsSync(flowPath), 'flows/tokenInfo.js exists');
const flow = readFileSync(flowPath, 'utf8');
assert.ok(/export function extractImageUrl\b/.test(flow),
    'flows/tokenInfo.js exports extractImageUrl');
assert.ok(/export function normalizeTokenInfo\b/.test(flow),
    'flows/tokenInfo.js exports normalizeTokenInfo');
assert.ok(/export async function tokenInfoFor\b/.test(flow),
    'flows/tokenInfo.js exports tokenInfoFor');
for (const field of [
    'description', 'creator', 'totalSupply', 'maxSupply', 'locked', 'marketPrice', 'imageUrl',
    // §27.6 TIS gallery additions — images/audio/video plus links/socials/files.
    'images', 'audio', 'video', 'website', 'socials', 'files', 'category',
]) {
    assert.ok(new RegExp(`\\b${field}\\b`).test(flow),
        `TokenInfo shape carries ${field}`);
}
assert.ok(/export function descriptionJsonUrl\b/.test(flow),
    'flows/tokenInfo.js exports descriptionJsonUrl');
assert.ok(/export function legacyJsonToTis\b/.test(flow),
    'flows/tokenInfo.js exports legacyJsonToTis');
assert.ok(/export function tisToMediaBundle\b/.test(flow),
    'flows/tokenInfo.js exports tisToMediaBundle');
assert.ok(/export async function fetchTisBundle\b/.test(flow),
    'flows/tokenInfo.js exports fetchTisBundle');

// --- 2. flows/index.js re-exports ---------------------------------------

const flowIndex = readFileSync(join(core, 'src', 'flows', 'index.js'), 'utf8');
assert.ok(/tokenInfoFor/.test(flowIndex), 'flows/index.js re-exports tokenInfoFor');
assert.ok(/extractImageUrl/.test(flowIndex), 'flows/index.js re-exports extractImageUrl');

// --- 3. background host registers token.info route ----------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
assert.ok(/tokenInfoFor,/.test(bg),
    'createBackgroundHost imports tokenInfoFor');
assert.ok(/host\.register\('token\.info'/.test(bg),
    'createBackgroundHost registers token.info route');

// --- 4. messaging shims across three shells -----------------------------

for (const [shell, path] of [
    ['extension', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const src = readFileSync(path, 'utf8');
    assert.ok(/export function getTokenInfo\b/.test(src),
        `${shell} messaging exports getTokenInfo`);
    assert.ok(/sendMessage\('token\.info'/.test(src),
        `${shell} messaging routes token.info channel`);
}

// --- 5. useTokenInfo hook -----------------------------------------------

const hookPath = join(core, 'src', 'shared', 'hooks', 'useTokenInfo.js');
assert.ok(existsSync(hookPath), 'useTokenInfo.js exists');
const hook = readFileSync(hookPath, 'utf8');
assert.ok(/export function useTokenInfo\b/.test(hook),
    'useTokenInfo is a named export');
assert.ok(/messaging\.getTokenInfo\b/.test(hook),
    'useTokenInfo calls messaging.getTokenInfo');
assert.ok(/new Map\(\)/.test(hook),
    'useTokenInfo carries a module-level cache Map');
assert.ok(/__clearTokenInfoCache\b/.test(hook),
    'useTokenInfo exposes a __clearTokenInfoCache test helper');

// --- 6. TokenDetail wiring ----------------------------------------------

const tdPath = join(core, 'src', 'shared', 'routes', 'TokenDetail.jsx');
const td = readFileSync(tdPath, 'utf8');
assert.ok(/from '\.\.\/hooks\/useTokenInfo\.js'/.test(td),
    'TokenDetail imports useTokenInfo');
assert.ok(/useTokenInfo\(\s*\{[^}]*chainId,\s*tick/m.test(td),
    'TokenDetail invokes useTokenInfo with chainId + tick');
assert.ok(/skip:\s*isNative/.test(td),
    'TokenDetail skips useTokenInfo for native coins');
for (const label of ['Creator', 'Total supply', 'Status']) {
    assert.ok(
        new RegExp(`>${label}<`).test(td),
        `TokenDetail renders the "${label}" row/card`,
    );
}
// The description body renders as plain prose (no labeled `Description`
// row anymore — moved into its own .descriptionBody block as part of
// the §27.6 redesign).
assert.ok(/descriptionBody/.test(td),
    'TokenDetail still renders the description body block');

// --- 7. Locked / Mutable status copy ------------------------------------

assert.ok(/Locked/.test(td) && /Mutable/.test(td),
    'TokenDetail renders both Locked + Mutable status copy');

// --- 7b. CollectibleCard wiring (Cluster I FOLLOWUP 3 close) ------------

const cv = readFileSync(
    join(core, 'src', 'shared', 'components', 'CollectiblesView.jsx'),
    'utf8',
);
assert.ok(/from '\.\.\/hooks\/useTokenInfo\.js'/.test(cv),
    'CollectiblesView imports useTokenInfo for per-card metadata fetch');
assert.ok(/useTokenInfo\(\s*\{[\s\S]*?chainId:\s*row\.chainId[\s\S]*?tick:\s*row\.tick/m.test(cv),
    'CollectibleCard invokes useTokenInfo with row.chainId + row.tick');
assert.ok(/skip:\s*row\.kind === 'native' \|\| hidden/.test(cv),
    'CollectibleCard skips useTokenInfo for native rows + hidden cards');
assert.ok(/effectiveImageUrl/.test(cv),
    'CollectibleCard derives an effectiveImageUrl from row.imageUrl ?? assetInfo.imageUrl');
assert.ok(/assetInfo[\s\S]*?\.imageUrl/.test(cv),
    'CollectibleCard reads assetInfo.imageUrl as the fetched fallback');
assert.ok(/src=\{effectiveImageUrl\}/.test(cv),
    'CollectibleCard renders the <img> against effectiveImageUrl');

// --- 8. extractImageUrl behavior pin (round-trip) -----------------------

(async () => {
    const mod = await import(flowPath);
    // markdown image
    assert.equal(
        mod.extractImageUrl('Hello ![alt](https://example.com/x.png) world'),
        'https://example.com/x.png',
        'extractImageUrl picks up markdown image syntax',
    );
    // bare URL
    assert.equal(
        mod.extractImageUrl('see https://example.com/icon.svg for more'),
        'https://example.com/icon.svg',
        'extractImageUrl picks up bare URL with image extension',
    );
    // ipfs:// rewrite
    assert.equal(
        mod.extractImageUrl('ipfs://Qm123/icon.png'),
        'https://ipfs.io/ipfs/Qm123/icon.png',
        'extractImageUrl rewrites ipfs:// to gateway URL',
    );
    // JSON object
    assert.equal(
        mod.extractImageUrl('{"image":"https://cdn/tick.png","name":"X"}'),
        'https://cdn/tick.png',
        'extractImageUrl picks up JSON image field',
    );
    // null / empty
    assert.equal(mod.extractImageUrl(''), null, 'empty description → null');
    assert.equal(mod.extractImageUrl(null), null, 'null description → null');
    assert.equal(mod.extractImageUrl('plain text only'), null,
        'plain text without URL → null');

    // normalizeTokenInfo with explorer-shaped row
    const norm = mod.normalizeTokenInfo('bitcoin-mainnet', 'XYZ', {
        info: { coin: 'bitcoin', tick: 'XYZ', description: 'A test token', owner: '1Foo' },
        supply: { current: '1000', max: '10000' },
        locks: { description: true, max_supply: false, mint: false, mint_supply: false },
        market: { price: 0.5, floor: 0.1 },
    });
    assert.equal(norm.description, 'A test token');
    assert.equal(norm.creator, '1Foo');
    assert.equal(norm.totalSupply, '1000');
    assert.equal(norm.maxSupply, '10000');
    assert.equal(norm.locked, true, 'description-locked → headline locked');
    assert.equal(norm.marketPrice, 0.5);

    // null payload → sentinel
    const empty = mod.normalizeTokenInfo('bitcoin-mainnet', 'XYZ', null);
    assert.equal(empty.description, null);
    assert.equal(empty.locked, false);
    assert.deepEqual(empty.images, [], 'images defaults to empty array');
    assert.deepEqual(empty.audio, [], 'audio defaults to empty array');
    assert.deepEqual(empty.video, [], 'video defaults to empty array');

    // descriptionJsonUrl — URL detection across schemes.
    assert.equal(
        mod.descriptionJsonUrl('https://j-dog.net/json/JDOG.json'),
        'https://j-dog.net/json/JDOG.json',
        'descriptionJsonUrl passes through https/.json URL',
    );
    assert.equal(
        mod.descriptionJsonUrl('https://j-dog.net/json/JDOG.json;JDOG'),
        'https://j-dog.net/json/JDOG.json',
        'descriptionJsonUrl strips the legacy ;title suffix',
    );
    assert.equal(
        mod.descriptionJsonUrl('ipfs://Qm123/info.json'),
        'https://ipfs.io/ipfs/Qm123/info.json',
        'descriptionJsonUrl rewrites ipfs:// to gateway',
    );
    assert.equal(
        mod.descriptionJsonUrl('ar:abc123'),
        'https://arweave.net/abc123',
        'descriptionJsonUrl rewrites ar: to arweave.net',
    );
    assert.equal(
        mod.descriptionJsonUrl('plain text token'),
        null,
        'descriptionJsonUrl returns null for plain text',
    );

    // legacyJsonToTis — promotes top-level `image` into images[].
    const legacy = mod.legacyJsonToTis({
        token: 'JDOG',
        description: 'A demo token',
        image: 'https://example.com/icon.png',
        website_social_twitter: 'https://twitter.com/example',
    });
    assert.ok(Array.isArray(legacy.images) && legacy.images.length === 1,
        'legacyJsonToTis lifts top-level image into images[]');
    assert.equal(legacy.social[0].type, 'twitter',
        'legacyJsonToTis lifts website_social_twitter into social[]');

    // tisToMediaBundle — normalizes a TIS document into the flat shape.
    const bundle = mod.tisToMediaBundle({
        description: 'Hello world',
        images: [
            { type: 'icon', data: 'https://example.com/a.png' },
            { type: 'large', data: 'ipfs://QmHash/img.jpg' },
        ],
        audio: [{ type: 'mp3', data: 'https://example.com/sound.mp3' }],
        video: [{ type: 'mp4', data: 'https://example.com/clip.mp4' }],
        social: [{ type: 'twitter', data: 'https://twitter.com/example' }],
        website: 'https://example.com',
        files: [{ name: 'Whitepaper', data: 'https://example.com/wp.pdf' }],
        categories: [{ type: 'main', data: 'Gaming' }],
    });
    assert.equal(bundle.images.length, 2, 'bundle includes both images');
    assert.equal(bundle.images[1].url, 'https://ipfs.io/ipfs/QmHash/img.jpg',
        'bundle rewrites ipfs:// in image entries');
    assert.equal(bundle.audio[0].url, 'https://example.com/sound.mp3');
    assert.equal(bundle.video[0].url, 'https://example.com/clip.mp4');
    assert.equal(bundle.website, 'https://example.com');
    assert.equal(bundle.socials[0].platform, 'twitter');
    assert.equal(bundle.files[0].name, 'Whitepaper');
    assert.equal(bundle.category, 'Gaming');

    // normalizeTokenInfo with a TIS bundle attached — gallery + body
    // description take precedence over the on-chain description URL.
    const merged = mod.normalizeTokenInfo(
        'bitcoin-mainnet',
        'JDOG',
        { info: { description: 'https://j-dog.net/json/JDOG.json' } },
        bundle,
    );
    assert.equal(merged.description, 'Hello world',
        'TIS body description overrides the URL stored on-chain');
    assert.equal(merged.images.length, 2,
        'normalizeTokenInfo carries images[] when a bundle is attached');
    assert.equal(merged.imageUrl, 'https://example.com/a.png',
        'imageUrl falls out of images[0]');

    // fetchTisBundle — happy path with an injected fetch mock.
    const mockResp = {
        ok: true,
        text: async () => JSON.stringify({
            token: 'MOCK',
            description: 'Mock body',
            image: 'https://example.com/mock.png',
        }),
    };
    const fetchedBundle = await mod.fetchTisBundle({
        description: 'https://example.com/mock.json',
        fetch: async () => mockResp,
    });
    assert.ok(fetchedBundle && fetchedBundle.description === 'Mock body',
        'fetchTisBundle returns a bundle on happy path');
    assert.equal(fetchedBundle.images[0].url, 'https://example.com/mock.png',
        'fetchTisBundle promotes legacy image into images[]');

    // fetchTisBundle — graceful failure on non-JSON.
    const garbage = await mod.fetchTisBundle({
        description: 'https://example.com/mock.json',
        fetch: async () => ({ ok: true, text: async () => '<html>not json</html>' }),
    });
    assert.equal(garbage, null,
        'fetchTisBundle returns null when response isn\'t JSON');

    // fetchTisBundle — null for plain-text descriptions (no fetch).
    let fetchCalls = 0;
    const noFetch = await mod.fetchTisBundle({
        description: 'plain text token',
        fetch: async () => { fetchCalls += 1; return { ok: true, text: async () => '{}' }; },
    });
    assert.equal(noFetch, null);
    assert.equal(fetchCalls, 0,
        'fetchTisBundle never calls fetch for plain-text descriptions');

    console.log('token-info smoke OK');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
