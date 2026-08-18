// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §43 dApp Bridge completeness: Cluster F (G126 / G128 /
// G129 / G130). The provider, content-script relay, background
// handlers, and web-app extension banner all already exist; this
// smoke pins their wiring so they don't quietly regress.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');

// Escapes every regex metacharacter (not just '.') so a literal string can
// be embedded in `new RegExp()` without a stray backslash in the input
// changing how the following character is interpreted.
function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- 1. Provider exposes every §43.2 method (G126, G128, G129) ---------

const providerPath = join(ext, 'src', 'inject', 'xchainProvider.js');
assert.ok(existsSync(providerPath), 'xchainProvider.js exists');
const provider = readFileSync(providerPath, 'utf8');
for (const method of [
    'connect',
    'disconnect',
    'getAccounts',
    'getAddresses',
    'getBalances',
    'getSupportedChains',
    'getActiveChains',
    'signMessage',
    'signAction',
    'signPsbt',
    'coSign',
    'signIn',
    'parallel',
    'on',
    'off',
]) {
    // Each method appears on the provider object literal as
    // `name(...) { ... }`. The check is loose enough to tolerate
    // formatting drift.
    assert.ok(
        new RegExp(`\\b${method}\\s*\\(`).test(provider),
        `xchainProvider exposes ${method}`,
    );
}
// Subscribe-side machinery is what makes on/off actually useful. The
// provider must keep a listeners map and react to xchain-inject-event
// messages from the content script.
assert.ok(/listeners/.test(provider), 'xchainProvider keeps a listeners map');
assert.ok(/xchain-inject-event/.test(provider),
    'xchainProvider listens for xchain-inject-event postMessages');

// --- 2. Background handlers register every bridge route (G126, G128) ---

const handlersPath = join(ext, 'src', 'bridge', 'handlers.js');
const handlers = readFileSync(handlersPath, 'utf8');
for (const route of [
    'bridge.connect',
    'bridge.disconnect',
    'bridge.getAccounts',
    'bridge.getAddresses',
    'bridge.getBalances',
    'bridge.getSupportedChains',
    'bridge.getActiveChains',
    'bridge.signMessage',
    'bridge.signAction',
    'bridge.signPsbt',
    'bridge.coSign',
    'bridge.signIn',
    'bridge.parallel',
]) {
    // v0.290.0 / Cluster Q FOLLOWUP 4: handlers.js shadows host.register
    // with a local register() that wraps every channel in entry/exit
    // logging. Either form satisfies "background registers <route>".
    const escaped = escapeRegExp(route);
    const wrapped = new RegExp(`\\bregister\\(\\s*['"]${escaped}['"]`).test(handlers);
    const bare = new RegExp(`host\\.register\\(\\s*['"]${escaped}['"]`).test(handlers);
    assert.ok(wrapped || bare, `background registers ${route}`);
}
// Permission gating must run on the read methods: getAddresses /
// getBalances / getActiveChains all sit behind requireSite.
assert.ok(/requireSite/.test(handlers),
    'bridge handlers gate read methods behind requireSite');
assert.ok(/assertChainPermitted/.test(handlers),
    'bridge handlers enforce per-chain permissions');

// --- 3. Content script relays bridge events to the page (G129) --------

const csPath = join(ext, 'src', 'content', 'contentScript.js');
const cs = readFileSync(csPath, 'utf8');
assert.ok(/bridge\.event/.test(cs),
    'contentScript listens for chrome runtime "bridge.event" messages');
assert.ok(/xchain-inject-event/.test(cs),
    'contentScript forwards events to the page via xchain-inject-event postMessages');

// --- 4. Web App.jsx mounts ExtensionBanner above the router (G130) ----

const banner = join(web, 'src', 'components', 'ExtensionBanner.jsx');
assert.ok(existsSync(banner), 'ExtensionBanner.jsx exists');
const bannerSrc = readFileSync(banner, 'utf8');
// Cluster F FOLLOWUP 2: the banner delegates detection + the connect
// handoff to the useExtensionWallet hook; provider detection and the
// xchain#initialized listen now live there / in extensionWallet.js.
assert.ok(/useExtensionWallet/.test(bannerSrc),
    'ExtensionBanner uses the useExtensionWallet hook');
assert.ok(/Use extension wallet/.test(bannerSrc),
    'ExtensionBanner offers the accept action');
const extHook = readFileSync(join(web, 'src', 'useExtensionWallet.js'), 'utf8');
assert.ok(/xchain#initialized/.test(extHook),
    'useExtensionWallet waits for the xchain#initialized event');
const extCore = readFileSync(join(web, 'src', 'extensionWallet.js'), 'utf8');
assert.ok(/window/.test(extCore) && /\.xchain/.test(extCore),
    'extensionWallet detects window.xchain presence');

const webApp = readFileSync(join(web, 'src', 'App.jsx'), 'utf8');
assert.ok(/from ['"]\.\/components\/ExtensionBanner\.jsx['"]/.test(webApp),
    'web App imports ExtensionBanner');
assert.ok(/<ExtensionBanner\b/.test(webApp),
    'web App renders <ExtensionBanner />');

console.log('dapp-bridge-completeness smoke OK');
