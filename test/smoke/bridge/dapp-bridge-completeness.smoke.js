// Smoke for §43 dApp Bridge completeness — Cluster F (G126 / G128 /
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
// Subscribe-side machinery is what makes on/off actually useful — the
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
    'bridge.signIn',
]) {
    assert.ok(
        new RegExp(`host\\.register\\(\\s*['"]${route.replace(/\./g, '\\.')}['"]`).test(handlers),
        `background registers ${route}`,
    );
}
// Permission gating must run on the read methods — getAddresses /
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
assert.ok(/xchain#initialized/.test(bannerSrc),
    'ExtensionBanner waits for the xchain#initialized event');
assert.ok(/window\.xchain/.test(bannerSrc),
    'ExtensionBanner detects window.xchain presence');

const webApp = readFileSync(join(web, 'src', 'App.jsx'), 'utf8');
assert.ok(/from ['"]\.\/components\/ExtensionBanner\.jsx['"]/.test(webApp),
    'web App imports ExtensionBanner');
assert.ok(/<ExtensionBanner\b/.test(webApp),
    'web App renders <ExtensionBanner />');

console.log('dapp-bridge-completeness smoke OK');
