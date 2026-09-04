// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §9.7 / G007: Runtime chain-registry refresh from hub.
//
// Wallet-side scaffolding only: the hub-side `/api/v1/chain-registry`
// endpoint is pending. This smoke pins the wallet's design hooks so a
// future contract change cannot silently break the call site:
//
//   1. `flows/refreshChainRegistry.js` exposes the canonical surface
//      (`refreshChainRegistry`, `createChainRegistryStatus`); the
//      `flows` barrel re-exports them.
//   2. The flow handles the happy path (200 + valid JSON) AND every
//      failure mode (no fetcher, timeout, non-2xx, malformed JSON,
//      missing descriptors[]) by always resolving: never throwing.
//   3. `createBackgroundHost` registers `chainRegistry.status` +
//      `chainRegistry.refresh` and schedules a boot-time refresh.
//   4. All three messaging shims expose `getChainRegistryStatus` +
//      `refreshChainRegistry`.
//   5. `NetworkEndpointsSection` renders the refresh row when the
//      shell wires the messaging shim.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const flowPath = 'packages/core/src/flows/refreshChainRegistry.js';
assert.ok(existsSync(join(root, flowPath)), `${flowPath} exists`);
const flowSrc = read(flowPath);
for (const fn of ['refreshChainRegistry', 'createChainRegistryStatus']) {
    assert.ok(new RegExp(`export (async )?function ${fn}\\(`).test(flowSrc),
        `flow exports ${fn}`);
}
const barrelSrc = read('packages/core/src/flows/index.js');
assert.ok(/refreshChainRegistry/.test(barrelSrc) && /refreshChainRegistry\.js/.test(barrelSrc),
    'flows barrel re-exports refreshChainRegistry');

const flowUrl = `file://${join(root, flowPath)}`;
const { refreshChainRegistry, createChainRegistryStatus } = await import(flowUrl);

const mockOk = () => ({
    ok: true,
    json: async () => ({
        generatedAt: '2026-04-28T00:00:00.000Z',
        descriptors: [
            { id: 'bitcoin-mainnet', coin: 'bitcoin', networkKind: 'mainnet' },
            { id: 'litecoin-mainnet', coin: 'litecoin', networkKind: 'mainnet' },
        ],
    }),
});
const happy = await refreshChainRegistry({ hubUrl: 'https://hub.xchain.io', fetcher: mockOk });
assert.equal(happy.ok, true, 'happy path resolves ok=true');
assert.equal(happy.descriptorCount, 2, 'descriptorCount reflects response');
assert.equal(happy.lastRefreshedAt, '2026-04-28T00:00:00.000Z',
    'lastRefreshedAt round-trips from response');
assert.match(happy.hubUrl, /\/api\/v1\/chain-registry$/,
    'hubUrl is the canonical refresh URL');
assert.equal(happy.error, null);

// Hub URL trailing slash is stripped before path append.
const trailing = await refreshChainRegistry({ hubUrl: 'https://hub.xchain.io/', fetcher: mockOk });
assert.equal(trailing.hubUrl, 'https://hub.xchain.io/api/v1/chain-registry',
    'trailing slash on hubUrl does not double-up the path');

const fail500 = await refreshChainRegistry({
    hubUrl: 'https://hub.xchain.io',
    fetcher: () => ({ ok: false, status: 500 }),
});
assert.equal(fail500.ok, false);
assert.match(fail500.error, /HTTP 500/);

// 404 (most likely current hub state: endpoint not implemented).
const fail404 = await refreshChainRegistry({
    hubUrl: 'https://hub.xchain.io',
    fetcher: () => ({ ok: false, status: 404 }),
});
assert.equal(fail404.ok, false);
assert.match(fail404.error, /HTTP 404/);

const malformed = await refreshChainRegistry({
    hubUrl: 'https://hub.xchain.io',
    fetcher: () => ({ ok: true, json: async () => { throw new Error('boom'); } }),
});
assert.equal(malformed.ok, false);
assert.match(malformed.error, /malformed JSON/);

const noDescriptors = await refreshChainRegistry({
    hubUrl: 'https://hub.xchain.io',
    fetcher: () => ({ ok: true, json: async () => ({ generatedAt: '...' }) }),
});
assert.equal(noDescriptors.ok, false);
assert.match(noDescriptors.error, /missing descriptors/);

const networkErr = await refreshChainRegistry({
    hubUrl: 'https://hub.xchain.io',
    fetcher: () => { throw new Error('ENETUNREACH'); },
});
assert.equal(networkErr.ok, false);
assert.match(networkErr.error, /ENETUNREACH/);

const invalid = await refreshChainRegistry({ hubUrl: 'not a url' });
assert.equal(invalid.ok, false);
assert.match(invalid.error, /invalid hubUrl/);

const status = createChainRegistryStatus();
assert.equal(status.get(), null, 'fresh status holder is null');
status.update(happy);
assert.deepEqual(status.get(), happy, 'update + get round-trips');
status.clear();
assert.equal(status.get(), null);

const hostSrc = read('packages/extension/src/background/createBackgroundHost.js');
assert.ok(/refreshChainRegistry,\s*\n\s*createChainRegistryStatus,/.test(hostSrc),
    'host destructures both new flows');
assert.ok(/host\.register\('chainRegistry\.status'/.test(hostSrc),
    'host registers chainRegistry.status handler');
assert.ok(/host\.register\('chainRegistry\.refresh'/.test(hostSrc),
    'host registers chainRegistry.refresh handler');
assert.ok(/setTimeout\(async \(\) => \{[\s\S]*refreshChainRegistry\(\{ hubUrl \}\)/.test(hostSrc),
    'host schedules a boot-time refresh via setTimeout');
assert.ok(/function pickHubUrlFromRegistry\(/.test(hostSrc),
    'host defines pickHubUrlFromRegistry helper');
assert.ok(/d\?\.networkKind === 'mainnet'/.test(hostSrc),
    'helper picks the mainnet hub URL (most authoritative)');

const shims = [
    'packages/extension/src/popup/messaging.js',
    'packages/web/src/messaging.js',
    'packages/desktop/renderer/messaging.js',
];
for (const shimPath of shims) {
    const src = read(shimPath);
    for (const fn of ['getChainRegistryStatus', 'refreshChainRegistry']) {
        assert.ok(new RegExp(`export function ${fn}\\(`).test(src),
            `${shimPath} exposes ${fn}`);
    }
    assert.ok(/sendMessage\('chainRegistry\.status'\)/.test(src)
        && /sendMessage\('chainRegistry\.refresh'\)/.test(src),
        `${shimPath} routes both messages`);
}

const sectionSrc = read('packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx');
assert.ok(/function ChainRegistryRefreshRow\(/.test(sectionSrc),
    'NetworkEndpointsSection defines ChainRegistryRefreshRow');
assert.ok(/<ChainRegistryRefreshRow \/>/.test(sectionSrc),
    'ChainRegistryRefreshRow is mounted in the section');
assert.ok(/messaging\.getChainRegistryStatus\(\)/.test(sectionSrc),
    'row reads status via the messaging shim');
assert.ok(/messaging\.refreshChainRegistry\(\)/.test(sectionSrc),
    'row triggers refresh via the messaging shim');
assert.ok(/Last refreshed \$\{formatRelative/.test(sectionSrc),
    'row formats the last-refreshed timestamp');
assert.ok(/networks bundled with this wallet are active/.test(sectionSrc),
    'row honestly states the bundled-only fallback when no refresh has happened');
// The panel is an ordinary Settings section, not developer-gated, so its copy
// may not name the ChainDescriptor type. `descriptorCount` itself is a wire
// field spanning core, the background host and the hub response and stays.
assert.ok(!/\$\{status\.descriptorCount\} descriptors/.test(sectionSrc),
    'the refresh count reads "networks", not the ChainDescriptor type name');
assert.ok(!/bundled descriptors/.test(sectionSrc),
    'the bundled-only fallback reads "networks", not the ChainDescriptor type name');
assert.ok(/network\$\{status\.descriptorCount === 1 \? '' : 's'\}/.test(sectionSrc),
    'the refresh count guards its singular');

console.log('OK: chain-registry refresh flow + host + 3 shims + Settings UI smoke');
