// Smoke for Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3 —
// `messaging.getAssetInfo` host method + TokenDetail richer metadata.
//
// Pins:
//   - flows/assetInfo.js exports normalizeAssetInfo / extractImageUrl /
//     assetInfoFor with the documented shape
//   - flows/index.js re-exports them
//   - createBackgroundHost.js registers the `asset.info` route
//   - all three messaging shells expose getAssetInfo({chainId, asset})
//   - useAssetInfo hook exists with module-level cache
//   - TokenDetail.jsx imports + uses useAssetInfo, renders Description
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

const flowPath = join(core, 'src', 'flows', 'assetInfo.js');
assert.ok(existsSync(flowPath), 'flows/assetInfo.js exists');
const flow = readFileSync(flowPath, 'utf8');
assert.ok(/export function extractImageUrl\b/.test(flow),
    'flows/assetInfo.js exports extractImageUrl');
assert.ok(/export function normalizeAssetInfo\b/.test(flow),
    'flows/assetInfo.js exports normalizeAssetInfo');
assert.ok(/export async function assetInfoFor\b/.test(flow),
    'flows/assetInfo.js exports assetInfoFor');
for (const field of ['description', 'creator', 'totalSupply', 'maxSupply', 'locked', 'marketPrice', 'imageUrl']) {
    assert.ok(new RegExp(`\\b${field}\\b`).test(flow),
        `AssetInfo shape carries ${field}`);
}

// --- 2. flows/index.js re-exports ---------------------------------------

const flowIndex = readFileSync(join(core, 'src', 'flows', 'index.js'), 'utf8');
assert.ok(/assetInfoFor/.test(flowIndex), 'flows/index.js re-exports assetInfoFor');
assert.ok(/extractImageUrl/.test(flowIndex), 'flows/index.js re-exports extractImageUrl');

// --- 3. background host registers asset.info route ----------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
assert.ok(/assetInfoFor,/.test(bg),
    'createBackgroundHost imports assetInfoFor');
assert.ok(/host\.register\('asset\.info'/.test(bg),
    'createBackgroundHost registers asset.info route');

// --- 4. messaging shims across three shells -----------------------------

for (const [shell, path] of [
    ['extension', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const src = readFileSync(path, 'utf8');
    assert.ok(/export function getAssetInfo\b/.test(src),
        `${shell} messaging exports getAssetInfo`);
    assert.ok(/sendMessage\('asset\.info'/.test(src),
        `${shell} messaging routes asset.info channel`);
}

// --- 5. useAssetInfo hook -----------------------------------------------

const hookPath = join(core, 'src', 'shared', 'hooks', 'useAssetInfo.js');
assert.ok(existsSync(hookPath), 'useAssetInfo.js exists');
const hook = readFileSync(hookPath, 'utf8');
assert.ok(/export function useAssetInfo\b/.test(hook),
    'useAssetInfo is a named export');
assert.ok(/messaging\.getAssetInfo\b/.test(hook),
    'useAssetInfo calls messaging.getAssetInfo');
assert.ok(/new Map\(\)/.test(hook),
    'useAssetInfo carries a module-level cache Map');
assert.ok(/__clearAssetInfoCache\b/.test(hook),
    'useAssetInfo exposes a __clearAssetInfoCache test helper');

// --- 6. TokenDetail wiring ----------------------------------------------

const tdPath = join(core, 'src', 'shared', 'routes', 'TokenDetail.jsx');
const td = readFileSync(tdPath, 'utf8');
assert.ok(/from '\.\.\/hooks\/useAssetInfo\.js'/.test(td),
    'TokenDetail imports useAssetInfo');
assert.ok(/useAssetInfo\(\s*\{[^}]*chainId,\s*asset/m.test(td),
    'TokenDetail invokes useAssetInfo with chainId + asset');
assert.ok(/skip:\s*isNative/.test(td),
    'TokenDetail skips useAssetInfo for native coins');
for (const label of ['Description', 'Creator', 'Total supply', 'Status']) {
    assert.ok(
        new RegExp(`>${label}<`).test(td),
        `TokenDetail renders the "${label}" row/card`,
    );
}
assert.ok(/assetInfo\.imageUrl/.test(td),
    'TokenDetail conditionally renders the description image');

// --- 7. Locked / Mutable status copy ------------------------------------

assert.ok(/Locked/.test(td) && /Mutable/.test(td),
    'TokenDetail renders both Locked + Mutable status copy');

// --- 7b. CollectibleCard wiring (Cluster I FOLLOWUP 3 close) ------------

const cv = readFileSync(
    join(core, 'src', 'shared', 'components', 'CollectiblesView.jsx'),
    'utf8',
);
assert.ok(/from '\.\.\/hooks\/useAssetInfo\.js'/.test(cv),
    'CollectiblesView imports useAssetInfo for per-card metadata fetch');
assert.ok(/useAssetInfo\(\s*\{[\s\S]*?chainId:\s*row\.chainId[\s\S]*?asset:\s*row\.asset/m.test(cv),
    'CollectibleCard invokes useAssetInfo with row.chainId + row.asset');
assert.ok(/skip:\s*row\.kind === 'native' \|\| hidden/.test(cv),
    'CollectibleCard skips useAssetInfo for native rows + hidden cards');
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
        mod.extractImageUrl('{"image":"https://cdn/asset.png","name":"X"}'),
        'https://cdn/asset.png',
        'extractImageUrl picks up JSON image field',
    );
    // null / empty
    assert.equal(mod.extractImageUrl(''), null, 'empty description → null');
    assert.equal(mod.extractImageUrl(null), null, 'null description → null');
    assert.equal(mod.extractImageUrl('plain text only'), null,
        'plain text without URL → null');

    // normalizeAssetInfo with explorer-shaped row
    const norm = mod.normalizeAssetInfo('bitcoin-mainnet', 'XYZ', {
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
    const empty = mod.normalizeAssetInfo('bitcoin-mainnet', 'XYZ', null);
    assert.equal(empty.description, null);
    assert.equal(empty.locked, false);

    console.log('asset-info smoke OK');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
