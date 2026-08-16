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
// The first cut selected target tabs with `chrome.tabs.query({})` filtered by
// `new URL(tab.url).origin`, and therefore delivered NOTHING: MV3 populates
// `Tab.url` only for an extension holding the "tabs" permission or a matching
// host permission, and manifest.json holds neither. The fake tabs here always
// supplied a `url`, so the smoke went on passing over a dead pipeline. Targets
// now come from the connected-tab registry (`background/connectedTabs.js`),
// built from unforgeable `sender` data, and this file asserts against that
// registry rather than against a `url` the browser never provides.
//
// Asserts:
//   1. createBridgeEventBroadcaster delivers only to the tab ids the registry
//      holds for the supplied origin, and stamps that origin on the message.
//   2. Registry entries for other origins are never addressed, and a
//      non-integer tab id is skipped.
//   3. With no `chrome.tabs.sendMessage` surface - or with no registry - every
//      method becomes a no-op that never reaches the registry, and
//      noopBridgeEvents carries the same method set as the live
//      broadcaster (shells without extension APIs default to it).
//   4. emitPermissionDiff fires accountsChanged when the accounts list
//      changes, and chainChanged when a single chain is added.
//   5. emitPermissionDiff is silent when there is no diff.
//   6. registerBridgeHandlers accepts an `events` opt and threads it
//      into bridge.disconnect; calling bridge.disconnect on a known
//      origin emits 'disconnect' to that origin once.
//   7. createBackgroundHost accepts a `bridgeEvents` dep and threads
//      it through to registerBridgeHandlers.
//   8. background.js wires the broadcaster against chrome.tabs +
//      chrome.runtime + the connected-tab registry, records web senders into
//      that registry, and manifest.json still asks for no "tabs" permission.

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

// --- 1. Registry-driven delivery --------------------------------------

function makeFakeTabs() {
    const sent = [];
    return {
        sent,
        surface: {
            sendMessage: (tabId, message, cb) => {
                sent.push({ tabId, message });
                if (typeof cb === 'function') cb();
            },
        },
    };
}

// The registry the broadcaster reads. The real one is built from chrome's own
// `sender` data; here it is a literal map so the assertion is about the
// broadcaster's selection, not about how the map was filled.
function fakeRegistry(map) {
    return { tabsForOrigin: async (origin) => (map[origin] ?? []) };
}

{
    const fake = makeFakeTabs();
    const events = createBridgeEventBroadcaster({
        tabs: fake.surface,
        runtime: {},
        connectedTabs: fakeRegistry({
            'https://dapp.example': [1, 3],
            'https://other.example': [2],
        }),
    });
    await events.disconnect('https://dapp.example', 'user-requested');
    assert.equal(fake.sent.length, 2, 'fan-out hits both registered tabs');
    assert.deepEqual(fake.sent.map((s) => s.tabId).sort(), [1, 3]);
    assert.equal(fake.sent[0].message.type, 'bridge.event');
    assert.equal(fake.sent[0].message.event, 'disconnect');
    assert.equal(fake.sent[0].message.payload, 'user-requested');
    // A registry entry is a delivery hint bound to a mutable tab id, so a tab
    // that navigated since its last bridge call is still addressed. The message
    // must therefore name the origin it was meant for, and the content script
    // must re-check it against the document it actually runs in. Both halves,
    // or the guard is a comment.
    assert.equal(
        fake.sent[0].message.origin,
        'https://dapp.example',
        'fanned-out event names its intended origin',
    );
    const contentSrc = readFileSync(
        join(wsRoot, 'packages', 'extension', 'src', 'content', 'contentScript.js'),
        'utf8',
    );
    assert.ok(
        /message\.origin !== window\.location\.origin\) return;/.test(contentSrc),
        'content script drops a bridge.event stamped for another origin',
    );
}

// --- 2. Other origins and degenerate ids ------------------------------

{
    const fake = makeFakeTabs();
    const events = createBridgeEventBroadcaster({
        tabs: fake.surface,
        connectedTabs: fakeRegistry({
            'https://dapp.example': ['7', null, undefined, 1.5, 5],
            'https://other.example': [9],
        }),
    });
    await events.accountsChanged('https://dapp.example', [{ id: 'acct-0', name: 'Main' }]);
    assert.equal(fake.sent.length, 1, 'only the one integer tab id is addressed');
    assert.equal(fake.sent[0].tabId, 5);
    assert.equal(fake.sent[0].message.event, 'accountsChanged');
    assert.deepEqual(fake.sent[0].message.payload, [{ id: 'acct-0', name: 'Main' }]);

    // An origin the registry knows nothing about sends nothing at all, rather
    // than falling back to every tab it does know.
    fake.sent.length = 0;
    await events.chainChanged('https://unconnected.example', 'bitcoin');
    assert.deepEqual(fake.sent, [], 'an unregistered origin gets no fan-out');
}

// --- 3. No sendMessage / no registry → no-op --------------------------

{
    const events = createBridgeEventBroadcaster({});
    assert.deepEqual(
        Object.keys(events).sort(),
        ['accountsChanged', 'chainChanged', 'disconnect'],
        'the full event surface exists even with no chrome.tabs behind it',
    );
    assert.equal(await events.disconnect('https://dapp.example'), undefined);
    assert.equal(await events.accountsChanged('https://dapp.example', []), undefined);
    assert.equal(await events.chainChanged('https://dapp.example', 'bitcoin'), undefined);

    // The observable that "no-op" actually names: a tabs surface with no
    // sendMessage (what a shell exposing a partial chrome namespace hands over)
    // never reaches the registry at all. The guard has to short-circuit BEFORE
    // the lookup, or every state mutation in such a shell pays for a
    // storage.session read and then throws on the send.
    const looked = [];
    const half = createBridgeEventBroadcaster({
        tabs: {},
        connectedTabs: {
            tabsForOrigin: async (origin) => { looked.push(origin); return [1]; },
        },
    });
    await half.disconnect('https://dapp.example', 'user-requested');
    await half.accountsChanged('https://dapp.example', []);
    await half.chainChanged('https://dapp.example', 'bitcoin');
    assert.deepEqual(looked, [], 'a tabs surface missing sendMessage is not looked up');

    // And the mirror case: a real tabs surface with no registry behind it sends
    // nothing rather than falling back to a broadcast.
    const noRegistry = makeFakeTabs();
    const blind = createBridgeEventBroadcaster({ tabs: noRegistry.surface });
    await blind.disconnect('https://dapp.example', 'user-requested');
    assert.deepEqual(noRegistry.sent, [], 'no registry means no delivery, never a broadcast');
}
{
    // noopBridgeEvents is the static default `registerBridgeHandlers` falls
    // back to, so its shape has to track the live broadcaster's: an event added
    // to one and not the other throws in exactly the shells that have no
    // chrome.tabs, which are the ones nothing else here covers.
    const live = createBridgeEventBroadcaster({
        tabs: makeFakeTabs().surface,
        connectedTabs: fakeRegistry({}),
    });
    assert.deepEqual(
        Object.keys(noopBridgeEvents).sort(),
        Object.keys(live).sort(),
        'the noop surface carries every method the live broadcaster does',
    );
    assert.equal(await noopBridgeEvents.disconnect('https://dapp.example'), undefined);
    assert.equal(await noopBridgeEvents.accountsChanged('https://dapp.example', []), undefined);
    assert.equal(await noopBridgeEvents.chainChanged('https://dapp.example', 'bitcoin'), undefined);
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
assert.ok(/bridgeEvents,[\s\S]{0,2000}?\.\.\.hostDeps\s*\}\s*=\s*deps/.test(createSrc),
    'createBackgroundHost destructures bridgeEvents');
assert.ok(/registerBridgeHandlers\(host,\s*\{[^)]*events:\s*bridgeEvents[^)]*\}/.test(createSrc),
    'createBackgroundHost forwards bridgeEvents → events into registerBridgeHandlers');

// --- 8. background.js wires the broadcaster --------------------------

const bgSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background.js'),
    'utf8',
);
assert.ok(
    /createBridgeEventBroadcaster\(\{[\s\S]{0,400}?tabs:\s*chrome\.tabs,[\s\S]{0,400}?runtime:\s*chrome\.runtime,[\s\S]{0,400}?connectedTabs,/.test(bgSrc),
    'background.js constructs broadcaster with chrome.tabs + chrome.runtime + the registry',
);
assert.ok(
    /bridgeEvents:[\s\S]*?createBridgeEventBroadcaster/.test(bgSrc),
    'background.js passes bridgeEvents into createBackgroundHost',
);
// The registry only holds anything if the runtime adapter feeds it. Without
// this half the broadcaster looks wired and still delivers to nobody, which is
// exactly the shape of the bug the URL filter had.
assert.ok(
    /onWebSender:\s*\(tabId,\s*origin\)\s*=>\s*connectedTabs\.record\(tabId,\s*origin\)/.test(bgSrc),
    'background.js feeds accepted web senders into the connected-tab registry',
);
assert.ok(
    /connectedTabs\.attach\(chrome\.tabs\)/.test(bgSrc),
    'background.js wires tab-close eviction for the registry',
);

// The whole reason the registry exists: this manifest must keep asking for no
// "tabs" permission. If a later change adds it, the install prompt grows a
// "read your browsing history" warning on a self-custodial wallet, and this
// assertion is the place that argument gets re-read before that happens.
const manifest = JSON.parse(
    readFileSync(join(wsRoot, 'packages', 'extension', 'manifest.json'), 'utf8'),
);
assert.ok(
    !manifest.permissions.includes('tabs'),
    'manifest does not request the "tabs" permission',
);
assert.deepEqual(
    manifest.host_permissions,
    [],
    'manifest requests no host permissions (which would also populate Tab.url)',
);

// And the receiving half stays permission-free too: the broadcaster must not
// reintroduce a tab.url read, which MV3 leaves undefined for this manifest.
const broadcasterSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'bridge', 'bridgeEvents.js'),
    'utf8',
);
assert.ok(
    !/tab\.url/.test(broadcasterSrc.replace(/^\s*\/\/.*$/gm, '')),
    'the broadcaster selects targets without reading tab.url',
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
    'OK: bridge-events-emit smoke (Cluster F FOLLOWUP 1: createBridgeEventBroadcaster delivers bridge.event messages to the tab ids the connected-tab registry holds for the origin, skipping other origins and non-integer ids and degrading to no-op without a sendMessage surface or without a registry; emitPermissionDiff fires accountsChanged + chainChanged on diff and stays silent on equal permissions; bridge.disconnect handler fires events.disconnect with user-requested reason; createBackgroundHost + background.js + handlers.js wired, registry fed from accepted web senders, manifest still free of the "tabs" permission)',
);
