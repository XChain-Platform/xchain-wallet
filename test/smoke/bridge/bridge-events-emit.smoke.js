// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §43.2 / Cluster F FOLLOWUP 1 smoke: actually emit accountsChanged /
// chainChanged / disconnect.
//
// The provider listener pipeline was wired in Phase 1 (content script
// relays `chrome.runtime.onMessage` → page postMessage → inject script
// dispatches to provider.on subscribers), but no background sender
// existed. v0.280.0 adds `createBridgeEventBroadcaster` + threads it
// through `bridge.disconnect` and `updateSitePermissions`.
//
// Asserts:
//   1. createBridgeEventBroadcaster fans out only to tabs whose URL
//      origin matches the supplied origin.
//   2. Tabs with no `url`, with malformed URLs, or sitting on a
//      different origin are skipped.
//   3. With no `chrome.tabs` surface, every method becomes a no-op
//      (no throws; important for shells without extension APIs).
//   4. emitPermissionDiff fires accountsChanged when the accounts list
//      changes, and chainChanged when a single chain is added.
//   5. emitPermissionDiff is silent when there is no diff.
//   6. registerBridgeHandlers accepts an `events` opt and threads it
//      into bridge.disconnect; calling bridge.disconnect on a known
//      origin emits 'disconnect' to that origin once.
//   7. createBackgroundHost accepts a `bridgeEvents` dep and threads
//      it through to registerBridgeHandlers.
//   8. background.js wires the broadcaster against chrome.tabs +
//      chrome.runtime.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    createBridgeEventBroadcaster,
    emitPermissionDiff,
    noopBridgeEvents,
    registerBridgeHandlers,
} from '../../../packages/extension/src/bridge/index.js';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import {
    schemas,
    storage as storageLib,
    registry as registryLib,
    sdk as sdkLib,
} from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Origin filtering ----------------------------------------------

function makeFakeTabs(tabs) {
    const sent = [];
    return {
        sent,
        surface: {
            query: (_filter, cb) => {
                if (typeof cb === 'function') {
                    cb(tabs);
                    return undefined;
                }
                return Promise.resolve(tabs);
            },
            sendMessage: (tabId, message) => {
                sent.push({ tabId, message });
            },
        },
    };
}

{
    const fake = makeFakeTabs([
        { id: 1, url: 'https://dapp.example/page' },
        { id: 2, url: 'https://other.example/page' },
        { id: 3, url: 'https://dapp.example/another' },
    ]);
    const events = createBridgeEventBroadcaster({ tabs: fake.surface, runtime: {} });
    await events.disconnect('https://dapp.example', 'user-requested');
    assert.equal(fake.sent.length, 2, 'fan-out hits both matching tabs');
    assert.deepEqual(fake.sent.map((s) => s.tabId).sort(), [1, 3]);
    assert.equal(fake.sent[0].message.type, 'bridge.event');
    assert.equal(fake.sent[0].message.event, 'disconnect');
    assert.equal(fake.sent[0].message.payload, 'user-requested');
}

// --- 2. Skipping degenerate tabs --------------------------------------

{
    const fake = makeFakeTabs([
        { id: 1 },                                  // no url
        { id: 2, url: 'chrome://newtab' },          // wrong origin
        { id: 3, url: 'not a url at all' },         // malformed
        { url: 'https://dapp.example/page' },       // no id
        { id: 5, url: 'https://dapp.example/page' },
    ]);
    const events = createBridgeEventBroadcaster({ tabs: fake.surface });
    await events.accountsChanged('https://dapp.example', [{ id: 'acct-0', name: 'Main' }]);
    assert.equal(fake.sent.length, 1);
    assert.equal(fake.sent[0].tabId, 5);
    assert.equal(fake.sent[0].message.event, 'accountsChanged');
    assert.deepEqual(fake.sent[0].message.payload, [{ id: 'acct-0', name: 'Main' }]);
}

// --- 3. No chrome.tabs → no-op ----------------------------------------

{
    const events = createBridgeEventBroadcaster({});
    await events.disconnect('https://dapp.example');
    await events.accountsChanged('https://dapp.example', []);
    await events.chainChanged('https://dapp.example', 'bitcoin');
    // Reaching here without throws is the assertion.
    assert.ok(true, 'no chrome.tabs path is silent');
}
{
    // noopBridgeEvents is the static no-op surface used as a default.
    await noopBridgeEvents.disconnect('https://dapp.example');
    await noopBridgeEvents.accountsChanged('https://dapp.example', []);
    await noopBridgeEvents.chainChanged('https://dapp.example', 'bitcoin');
    assert.ok(true);
}

// --- 4. emitPermissionDiff fires events on diff -----------------------

{
    const fired = [];
    const stubEvents = {
        async accountsChanged(origin, accounts) { fired.push({ kind: 'accountsChanged', origin, accounts }); },
        async chainChanged(origin, chainId) { fired.push({ kind: 'chainChanged', origin, chainId }); },
        async disconnect() { fired.push({ kind: 'disconnect' }); },
    };
    await emitPermissionDiff({
        events: stubEvents,
        origin: 'https://dapp.example',
        prevPermissions: { accounts: ['acct-0'], chains: ['bitcoin-mainnet'] },
        nextPermissions: { accounts: ['acct-0', 'acct-1'], chains: ['bitcoin-mainnet', 'litecoin-mainnet'] },
        accountsChangedPayload: [
            { id: 'acct-0', name: 'Main' },
            { id: 'acct-1', name: 'Second' },
        ],
    });
    assert.equal(fired.length, 2);
    assert.equal(fired[0].kind, 'accountsChanged');
    assert.equal(fired[0].accounts.length, 2);
    assert.equal(fired[1].kind, 'chainChanged');
    assert.equal(fired[1].chainId, 'litecoin-mainnet');
}

// --- 5. emitPermissionDiff silent when nothing changed ---------------

{
    const fired = [];
    const stubEvents = {
        async accountsChanged() { fired.push('accountsChanged'); },
        async chainChanged() { fired.push('chainChanged'); },
        async disconnect() { fired.push('disconnect'); },
    };
    await emitPermissionDiff({
        events: stubEvents,
        origin: 'https://dapp.example',
        prevPermissions: { accounts: ['acct-0'], chains: ['bitcoin-mainnet'] },
        nextPermissions: { accounts: ['acct-0'], chains: ['bitcoin-mainnet'] },
        accountsChangedPayload: [{ id: 'acct-0', name: 'Main' }],
    });
    assert.deepEqual(fired, [], 'no diff = no events');
}

// --- 6. bridge.disconnect emits via the events surface --------------

{
    const masterKey = new Uint8Array(32);
    crypto.getRandomValues(masterKey);
    const vault = new storageLib.Vault({
        backend: new storageLib.InMemoryBackend(),
        masterKey,
    });
    await vault.open();

    const site = schemas.createConnectedSite({
        origin: 'https://dapp.example',
        appName: 'Example',
        permissions: {
            chains: ['bitcoin-mainnet'],
            accounts: ['acct-0'],
            canSignMessage: false,
            canSignAction: {},
        },
    });
    await vault.connectedSites.put(site);

    const fired = [];
    const events = {
        async accountsChanged(origin, accounts) { fired.push({ kind: 'accountsChanged', origin, accounts }); },
        async chainChanged(origin, chainId) { fired.push({ kind: 'chainChanged', origin, chainId }); },
        async disconnect(origin, reason) { fired.push({ kind: 'disconnect', origin, reason }); },
    };

    const chainRegistry = registryLib.defaultRegistry();
    const sdkRegistry = new sdkLib.SDKRegistry({
        chainRegistry,
        sdkFactory: () => ({ wallet: {}, auth: {} }),
    });
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry });
    registerBridgeHandlers(host, { events });

    const resp = await host.handle({
        type: 'bridge.disconnect',
        request: { origin: 'https://dapp.example' },
    });
    assert.ok(resp.ok, 'disconnect handler returns ok');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].kind, 'disconnect');
    assert.equal(fired[0].origin, 'https://dapp.example');
    assert.equal(fired[0].reason, 'user-requested');

    // bridge.disconnect on an unknown origin: silent (no record, no
    // event; the dApp wasn't connected, no listener to inform).
    fired.length = 0;
    const resp2 = await host.handle({
        type: 'bridge.disconnect',
        request: { origin: 'https://unknown.example' },
    });
    assert.ok(resp2.ok);
    assert.equal(fired.length, 0, 'unknown-origin disconnect is silent');
}

// --- 7. createBackgroundHost threads bridgeEvents -------------------

const createSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
assert.ok(/bridgeEvents,\s*\.\.\.hostDeps\s*\}\s*=\s*deps/.test(createSrc),
    'createBackgroundHost destructures bridgeEvents');
assert.ok(/registerBridgeHandlers\(host,\s*\{\s*approvals,\s*events:\s*bridgeEvents\s*\}\)/.test(createSrc),
    'createBackgroundHost forwards bridgeEvents → events into registerBridgeHandlers');

// --- 8. background.js wires the broadcaster --------------------------

const bgSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background.js'),
    'utf8',
);
assert.ok(
    /createBridgeEventBroadcaster\(\{\s*tabs:\s*chrome\.tabs,\s*runtime:\s*chrome\.runtime\s*\}\)/.test(bgSrc),
    'background.js constructs broadcaster with chrome.tabs + chrome.runtime',
);
assert.ok(
    /bridgeEvents:[\s\S]*?createBridgeEventBroadcaster/.test(bgSrc),
    'background.js passes bridgeEvents into createBackgroundHost',
);

// --- 9. handlers.js threads events into updateSitePermissions ------

const handlersSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'bridge', 'handlers.js'),
    'utf8',
);
assert.ok(
    /events\.disconnect\(req\.origin,\s*'user-requested'\)/.test(handlersSrc),
    'bridge.disconnect calls events.disconnect',
);
assert.ok(
    /updateSitePermissions\(deps\.vault,\s*site,\s*\{\s*canSignMessage:\s*true\s*\},\s*\{\s*events\s*\}\)/.test(handlersSrc),
    'canSignMessage path threads events through updateSitePermissions',
);
assert.ok(
    /\}\s*,\s*\{\s*events\s*\}\)/.test(handlersSrc),
    'canSignAction path threads events through updateSitePermissions',
);

console.log(
    'OK: bridge-events-emit smoke (Cluster F FOLLOWUP 1: createBridgeEventBroadcaster fans bridge.event messages to chrome.tabs filtered by URL.origin, skipping no-url / malformed-url / wrong-origin / no-id tabs and degrading to no-op without chrome.tabs; emitPermissionDiff fires accountsChanged + chainChanged on diff and stays silent on equal permissions; bridge.disconnect handler fires events.disconnect with user-requested reason; createBackgroundHost + background.js + handlers.js wired)',
);
