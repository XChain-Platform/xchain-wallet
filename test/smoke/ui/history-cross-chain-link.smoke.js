// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §23.5 / G051: Cross-chain LINK threading in History.
//
// Verify pass: implementation already shipped (linkQueries.js +
// History.jsx peer cache + connector renderer + 🔗 filter +
// dual-side DetailCard). This smoke pins the four pieces so a future
// edit cannot silently drop one of them.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. linkQueries.js exposes the canonical wrapper.
const queriesPath = 'packages/core/src/flows/linkQueries.js';
assert.ok(existsSync(join(root, queriesPath)), `${queriesPath} exists`);
const queriesSrc = read(queriesPath);
assert.ok(/export async function linksForAddress\(/.test(queriesSrc),
    'linkQueries exports linksForAddress');
assert.ok(/sdk\.getLinks\(address, 'address', opts\)/.test(queriesSrc),
    'linksForAddress routes to sdk.getLinks(address, "address", opts)');

// 2. History.jsx calls the query (via the messaging shim) and builds
//    the peer-cache side metadata.
const historySrc = read('packages/core/src/shared/routes/History.jsx');
assert.ok(/messaging\.getLinksForAddress\(/.test(historySrc),
    'History calls messaging.getLinksForAddress (which routes to flows.linksForAddress in the host)');

// 2b. createBackgroundHost wires linksForAddress through links.* handler.
const hostSrc = read('packages/extension/src/background/createBackgroundHost.js');
assert.ok(/linksForAddress,/.test(hostSrc),
    'createBackgroundHost destructures linksForAddress from flows');
assert.ok(/return linksForAddress\(\{ \.\.\.req, sdkRegistry \}\)/.test(hostSrc),
    'host handler routes the request through linksForAddress');

// 2c. All three messaging shims expose getLinksForAddress.
const shims = [
    'packages/extension/src/popup/messaging.js',
    'packages/web/src/messaging.js',
    'packages/desktop/renderer/messaging.js',
];
for (const shimPath of shims) {
    const src = read(shimPath);
    assert.ok(/export function getLinksForAddress\(/.test(src),
        `${shimPath} exposes getLinksForAddress`);
}
assert.ok(/peerChainId/.test(historySrc) && /peerCoinTicker/.test(historySrc) && /peerActionIndex/.test(historySrc) && /linkActionIndex/.test(historySrc),
    'History builds the (peerChainId, peerCoinTicker, peerActionIndex, linkActionIndex) link metadata');
assert.ok(/function sidesFromLink\(link, localChainId\)/.test(historySrc),
    'History defines the local/peer sides resolver');
assert.ok(/c1IsLocal/.test(historySrc) && /c2IsLocal/.test(historySrc),
    'sides resolver branches on which side maps to the local chain');

// 3. Connector logic: vertical thread between adjacent rows that
//    share a linkActionIndex.
assert.ok(/connectorByKey/.test(historySrc),
    'History computes connectorByKey for vertical threading');
assert.ok(/cur\.link\.linkActionIndex[\s\S]*===[\s\S]*prev\.link\.linkActionIndex/.test(historySrc),
    'connector fires when consecutive rows share linkActionIndex');

// 4. 🔗 Cross-chain filter UI.
assert.ok(/🔗 Cross-chain actions/.test(historySrc),
    'History exposes the "🔗 Cross-chain actions" filter chip');

// 5. Dual-side DetailCard renders peer info on row click.
assert.ok(/function DetailCard\(\{ entry, peerCache, chainTip \}\)/.test(historySrc),
    'DetailCard accepts entry + peerCache + chainTip');
assert.ok(/peerCache\[peerKey\]/.test(historySrc),
    'DetailCard reads the peer entry from the cache');
assert.ok(/peerCacheKey\(/.test(historySrc),
    'DetailCard uses peerCacheKey to look up the peer');

// 6. Spec citation present in the file header so a future contributor
//    knows which section to consult before edits.
assert.ok(/§23\.5/.test(historySrc),
    'History header cites §23.5');

console.log('OK: cross-chain LINK threading verify smoke');
