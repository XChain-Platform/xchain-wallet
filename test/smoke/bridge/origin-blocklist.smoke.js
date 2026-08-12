// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §12 / G009: Origin allowlist/blocklist infrastructure.
//
// Verifies:
//   1. `flows/blocklist.js` exists and exports the helper surface;
//      `flows` barrel re-exports it.
//   2. normalizeOrigin() coerces bare hosts to `https://…` form and
//      rejects garbage.
//   3. isOriginBlocked() respects normalization, ignores empty/missing
//      lists, and is case-insensitive on host but case-sensitive on
//      path-like strings.
//   4. Settings schema typedef + validator accept `blockedOrigins?:
//      string[]` as v2-tolerant.
//   5. Bridge handlers register `assertNotBlocked` and call it from
//      bridge.connect AND each of the four sign methods.
//   6. createBackgroundHost registers `sites.listBlocked` /
//      `sites.block` / `sites.unblock`.
//   7. All three messaging shims expose `listBlockedOrigins` /
//      `blockOrigin` / `unblockOrigin`.
//   8. ConnectedSitesSection renders a Block button per row, a
//      "Blocked origins" subsection, and an inline manual-block form.
//   9. bridge-spec union + the bridge doc's error table both list
//      `BLOCKED_BY_USER`.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { docsAvailable, readDoc, WALLET_DOCS } from '../_docs-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. Module + barrel exports.
const flowPath = 'packages/core/src/flows/blocklist.js';
assert.ok(existsSync(join(root, flowPath)), `${flowPath} exists`);

const flowSrc = read(flowPath);
for (const fn of ['normalizeOrigin', 'isOriginBlocked', 'listBlockedOrigins', 'addBlockedOrigin', 'removeBlockedOrigin']) {
    assert.ok(new RegExp(`export (async )?function ${fn}\\(`).test(flowSrc),
        `blocklist exports ${fn}`);
}

const barrelSrc = read('packages/core/src/flows/index.js');
for (const fn of ['normalizeOrigin', 'isOriginBlocked', 'listBlockedOrigins', 'addBlockedOrigin', 'removeBlockedOrigin']) {
    assert.ok(new RegExp(`\\b${fn}\\b`).test(barrelSrc) && /blocklist\.js/.test(barrelSrc),
        `flows barrel re-exports ${fn}`);
}

// 2 + 3. Runtime: exercise normalize + isBlocked.
const { normalizeOrigin, isOriginBlocked } = await import(join(root, flowPath));

assert.equal(normalizeOrigin('https://example.com/'), 'https://example.com',
    'absolute URL normalises to URL.origin');
assert.equal(normalizeOrigin('example.com'), 'https://example.com',
    'bare host coerced to https://');
assert.equal(normalizeOrigin('http://localhost:3000/foo'), 'http://localhost:3000',
    'http preserved with port and path stripped');
assert.equal(normalizeOrigin('not a url'), null,
    'whitespace-bearing junk rejected');
assert.equal(normalizeOrigin(''), null, 'empty string rejected');
assert.equal(normalizeOrigin(null), null, 'null rejected');
assert.equal(normalizeOrigin(123), null, 'non-string rejected');

assert.equal(isOriginBlocked([], 'https://x.com'), false,
    'empty list never blocks');
assert.equal(isOriginBlocked(undefined, 'https://x.com'), false,
    'undefined list never blocks');
assert.equal(isOriginBlocked(['https://example.com'], 'https://example.com'), true,
    'exact match blocks');
assert.equal(isOriginBlocked(['example.com'], 'https://example.com'), true,
    'bare host entry matches https origin');
assert.equal(isOriginBlocked(['https://example.com'], 'https://example.com/path'), true,
    'origin matches when test value carries a path');
assert.equal(isOriginBlocked(['https://example.com'], 'http://example.com'), false,
    'protocol mismatch does NOT block (http vs https are distinct origins)');
assert.equal(isOriginBlocked(['https://x.com'], ''), false,
    'empty origin not matched');

// 4. Settings schema.
const schemaSrc = read('packages/core/src/schemas/settings.js');
assert.ok(/@property \{string\[\]\} \[blockedOrigins\]/.test(schemaSrc),
    'Settings typedef declares blockedOrigins as optional string[]');
assert.ok(/r\.blockedOrigins !== undefined/.test(schemaSrc),
    'validator gates blockedOrigins on undefined (v2-tolerant)');
assert.ok(/'blockedOrigins'/.test(schemaSrc),
    'validator references the field name');

// 5. Bridge handlers wire assertNotBlocked into connect + four sign methods.
const handlersSrc = read('packages/extension/src/bridge/handlers.js');
assert.ok(/isOriginBlocked,?/.test(handlersSrc),
    'bridge handlers destructure isOriginBlocked from flows');
assert.ok(/async function assertNotBlocked\(req, deps\)/.test(handlersSrc),
    'assertNotBlocked helper defined');
assert.ok(/bridgeError\('BLOCKED_BY_USER', req\.origin\)/.test(handlersSrc),
    'assertNotBlocked raises BLOCKED_BY_USER on match');

const guardedMethods = ['connect', 'signMessage', 'signAction', 'signPsbt', 'signIn'];
for (const method of guardedMethods) {
    const re = new RegExp(
        `register\\('bridge\\.${method}',[\\s\\S]*?await assertNotBlocked\\(req, deps\\)`,
    );
    assert.ok(re.test(handlersSrc),
        `bridge.${method} calls assertNotBlocked`);
}

// 6. Background host registers the three blocklist endpoints.
const hostSrc = read('packages/extension/src/background/createBackgroundHost.js');
for (const handler of ['sites.listBlocked', 'sites.block', 'sites.unblock']) {
    assert.ok(new RegExp(`host\\.register\\('${handler.replace('.', '\\.')}'`).test(hostSrc),
        `createBackgroundHost registers ${handler}`);
}
assert.ok(/listBlockedOrigins,/.test(hostSrc) && /addBlockedOrigin,/.test(hostSrc) && /removeBlockedOrigin,/.test(hostSrc),
    'createBackgroundHost destructures the three blocklist flows');

// 7. Messaging shims in all three shells.
const shims = [
    'packages/extension/src/popup/messaging.js',
    'packages/web/src/messaging.js',
    'packages/desktop/renderer/messaging.js',
];
for (const shimPath of shims) {
    const src = read(shimPath);
    for (const fn of ['listBlockedOrigins', 'blockOrigin', 'unblockOrigin']) {
        assert.ok(new RegExp(`export function ${fn}`).test(src),
            `${shimPath} exports ${fn}`);
    }
    assert.ok(/sites\.listBlocked/.test(src) && /sites\.block/.test(src) && /sites\.unblock/.test(src),
        `${shimPath} routes to the three sites.* handlers`);
}

// 8. ConnectedSitesSection picks up the new affordances.
const sectionSrc = read('packages/core/src/shared/components/settings/ConnectedSitesSection.jsx');
assert.ok(/blocklistWired/.test(sectionSrc),
    'section feature-detects blocklist wiring on the messaging surface');
assert.ok(/messaging\.listBlockedOrigins\b/.test(sectionSrc),
    'reload pulls the blocked-origins list when wired');
assert.ok(/messaging\.blockOrigin\(\{ origin/.test(sectionSrc),
    'per-row Block button calls messaging.blockOrigin');
assert.ok(/messaging\.unblockOrigin\(\{ origin\b/.test(sectionSrc),
    'Unblock button calls messaging.unblockOrigin');
assert.ok(/Blocked origins/.test(sectionSrc),
    'subsection heading renders');
assert.ok(/BlockedOriginsPanel/.test(sectionSrc),
    'BlockedOriginsPanel component defined / mounted');
assert.ok(/placeholder="https:\/\/example\.com/.test(sectionSrc),
    'manual-block input has an origin placeholder');
assert.ok(/onSubmit=\{onManualBlockSubmit\}/.test(sectionSrc),
    'manual-block form wires submit handler');

// 9. Spec union + docs.
const specSrc = read('packages/bridge-spec/src/index.ts');
assert.ok(/\|\s*'BLOCKED_BY_USER'/.test(specSrc),
    'BridgeErrorCode union includes BLOCKED_BY_USER');

// The bridge doc left this repo in; the assertion follows it into
// the sibling checkout rather than being dropped, and skips when absent.
if (docsAvailable()) {
    const bridgeDocSrc = readDoc('bridge.md');
    assert.ok(/`BLOCKED_BY_USER`/.test(bridgeDocSrc),
        'the bridge doc error table mentions BLOCKED_BY_USER');
    assert.ok(/explicitly blocked this origin/.test(bridgeDocSrc),
        'the bridge doc describes the user-initiated block path');
} else {
    console.log('SKIP (partial): the bridge-doc half needs the sibling '
        + `xchain-documentation checkout (expected at ${WALLET_DOCS}).`);
}

console.log('OK: origin blocklist flow + bridge wiring + host + shims + UI + spec + docs smoke');
