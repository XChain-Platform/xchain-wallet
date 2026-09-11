// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Security regression (BRIDGE-1): a web page must not be able to reach the
// extension's privileged (non-`bridge.*`) handler surface.
//
// The background MessageHost registers privileged UI handlers (wallet.*,
// action.*, settings.*, sites.*, ...) on the same chrome.runtime.onMessage
// surface as the public `bridge.*` dApp handlers. A content script relays
// arbitrary page messages to the background, so without a sender/type gate a
// hostile page could invoke e.g. `action.send` and drain the pre-unlocked
// signer pool with no password/approval. These tests pin the trust boundary:
//
//   - the pure helpers classify types and senders correctly;
//   - the host listener rejects privileged types from a web-origin sender but
//     lets `bridge.*` through and lets the extension UI call anything;
//   - the pre-host (session lifecycle) listener rejects web-origin senders;
//   - the signer-bridge port disconnects web-origin connections;
//   - the content script source only relays `bridge.*` types.

import { describe, it, expect } from 'vitest';
import {
    isPublicBridgeType,
    isTrustedExtensionSender,
    isMessageAllowedFromSender,
} from '../../../packages/extension/src/bridge/publicSurface.js';
import { attachChromeRuntime } from '../../../packages/extension/src/background/ChromeRuntimeAdapter.js';
import { attachSessionMetaListener } from '../../../packages/extension/src/background/sessionMeta.js';
import {
    attachSignerBridgeListener,
    MAX_SIGNER_IDS_PER_MESSAGE,
} from '../../../packages/extension/src/background/signerBridgeListener.js';
import * as signerBridge from '../../../packages/extension/src/background/signerBridge.js';
import contentScriptSource from '../../../packages/extension/src/content/contentScript.js?raw';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXT_SENDER = { origin: `chrome-extension://${EXT_ID}`, id: EXT_ID };
const EXT_SENDER_TAB = {
    // Full-screen extension UI: runs in a TAB but still has the ext origin.
    origin: `chrome-extension://${EXT_ID}`,
    id: EXT_ID,
    tab: { id: 7 },
};
const WEB_SENDER = {
    origin: 'https://evil.example',
    url: 'https://evil.example/',
    id: EXT_ID, // content scripts carry the extension id, so id is NOT a discriminator
    tab: { id: 42 },
};

function fakeRuntime() {
    let listener = null;
    return {
        id: EXT_ID,
        onMessage: {
            addListener: (fn) => { listener = fn; },
            removeListener: () => { listener = null; },
        },
        onConnect: {
            addListener: (fn) => { listener = fn; },
            removeListener: () => { listener = null; },
        },
        emit: (...args) => listener(...args),
    };
}

// Drain the microtask queue the adapter's promise chain settles on, so an
// assertion reads the envelope that actually reached sendResponse.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('publicSurface helpers', () => {
    it('classifies only bridge.* as public', () => {
        expect(isPublicBridgeType('bridge.connect')).toBe(true);
        expect(isPublicBridgeType('bridge.signAction')).toBe(true);
        expect(isPublicBridgeType('action.send')).toBe(false);
        expect(isPublicBridgeType('wallet.remove')).toBe(false);
        expect(isPublicBridgeType('settings.update')).toBe(false);
        expect(isPublicBridgeType('bridgeXaction')).toBe(false); // no dot
        expect(isPublicBridgeType(undefined)).toBe(false);
    });

    it('trusts only extension-origin senders', () => {
        expect(isTrustedExtensionSender(EXT_SENDER, EXT_ID)).toBe(true);
        expect(isTrustedExtensionSender(EXT_SENDER_TAB, EXT_ID)).toBe(true);
        expect(isTrustedExtensionSender(WEB_SENDER, EXT_ID)).toBe(false);
        expect(isTrustedExtensionSender({ url: `chrome-extension://${EXT_ID}/popup.html` }, EXT_ID)).toBe(true);
        expect(isTrustedExtensionSender({ origin: `chrome-extension://someotherid` }, EXT_ID)).toBe(false);
        expect(isTrustedExtensionSender(null, EXT_ID)).toBe(false);
        expect(isTrustedExtensionSender(EXT_SENDER, undefined)).toBe(false);
    });

    // A tripwire, not a contract we want forever. The predicate compares
    // against `chrome-extension://<runtime.id>`, so on Gecko (where pages
    // are `moz-extension://<uuid>` and runtime.id is the gecko id from
    // manifest.json browser_specific_settings) it refuses the wallet's OWN
    // popup. That is fail-closed and costs nothing while Chromium is the
    // only target; enabling a Gecko build has to change the predicate AND
    // this case together, rather than discovering it as a dead popup.
    it('refuses a moz-extension sender: Chromium-only, by construction', () => {
        const GECKO_UUID = '0f3d2ff4-1cbb-4e17-9c9e-2f0b0f4e51aa';
        expect(isTrustedExtensionSender(
            { origin: `moz-extension://${GECKO_UUID}` }, EXT_ID,
        )).toBe(false);
        expect(isTrustedExtensionSender(
            { url: `moz-extension://${GECKO_UUID}/popup.html` }, EXT_ID,
        )).toBe(false);
    });

    it('gate: web senders confined to bridge.*, ext UI unrestricted', () => {
        expect(isMessageAllowedFromSender('action.send', WEB_SENDER, EXT_ID)).toBe(false);
        expect(isMessageAllowedFromSender('bridge.connect', WEB_SENDER, EXT_ID)).toBe(true);
        expect(isMessageAllowedFromSender('action.send', EXT_SENDER, EXT_ID)).toBe(true);
    });
});

describe('ChromeRuntimeAdapter sender gate', () => {
    function setup() {
        const calls = [];
        const host = { handle: async (m) => { calls.push(m); return { ok: true, result: 'HANDLED' }; } };
        const runtime = fakeRuntime();
        attachChromeRuntime(host, runtime);
        return { calls, runtime };
    }

    it('rejects a privileged type from a web-origin sender without hitting the host', async () => {
        const { calls, runtime } = setup();
        const responses = [];
        const ret = runtime.emit({ type: 'action.send', request: { walletId: 'w', to: 'attacker', amount: 1 } }, WEB_SENDER, (r) => responses.push(r));
        expect(ret).toBe(true); // async-response contract still honoured
        await Promise.resolve();
        expect(calls).toHaveLength(0); // host.handle never called
        expect(responses[0].ok).toBe(false);
        expect(responses[0].error.code).toBe('FORBIDDEN_SENDER');
    });

    it('allows bridge.* from a web-origin sender (bridge handlers self-enforce origin)', async () => {
        const { calls, runtime } = setup();
        const responses = [];
        runtime.emit({ type: 'bridge.getAccounts', request: {} }, WEB_SENDER, (r) => responses.push(r));
        await Promise.resolve();
        await Promise.resolve();
        expect(calls).toHaveLength(1);
        expect(calls[0].type).toBe('bridge.getAccounts');
    });

    it('allows a privileged type from the extension UI (incl. full-screen tab)', async () => {
        const { calls, runtime } = setup();
        const responses = [];
        runtime.emit({ type: 'action.send', request: {} }, EXT_SENDER_TAB, (r) => responses.push(r));
        await Promise.resolve();
        await Promise.resolve();
        expect(calls).toHaveLength(1);
        expect(calls[0].type).toBe('action.send');
    });

    it('reports activity (auto-lock) only for trusted extension senders, not web pages', async () => {
        const host = { handle: async () => ({ ok: true }) };
        const runtime = fakeRuntime();
        let activity = 0;
        attachChromeRuntime(host, runtime, { onActivity: () => { activity += 1; } });
        // Web page (bridge.* allowed through) must NOT count as user activity.
        runtime.emit({ type: 'bridge.getAccounts', request: {} }, WEB_SENDER, () => {});
        expect(activity).toBe(0);
        // Extension UI message counts as activity.
        runtime.emit({ type: 'action.send', request: {} }, EXT_SENDER, () => {});
        expect(activity).toBe(1);
        // A blocked web page (privileged type) also does not count.
        runtime.emit({ type: 'action.send', request: {} }, WEB_SENDER, () => {});
        expect(activity).toBe(1);
    });
});

describe('ChromeRuntimeAdapter origin cross-check (second confused-deputy layer)', () => {
    function setup() {
        const calls = [];
        const host = { handle: async (m) => { calls.push(m); return { ok: true, result: 'HANDLED' }; } };
        const runtime = fakeRuntime();
        attachChromeRuntime(host, runtime);
        return { calls, runtime };
    }

    it('refuses a web sender claiming ANOTHER origin, without hitting the host', async () => {
        const { calls, runtime } = setup();
        const responses = [];
        // evil.example relays a call stamped with a victim origin: if this
        // reached the host, findConnectedSite would hand it the victim's grants.
        runtime.emit(
            { type: 'bridge.signPsbt', request: { origin: 'https://good.example', psbt: 'x' } },
            WEB_SENDER,
            (r) => responses.push(r),
        );
        await Promise.resolve();
        expect(calls).toHaveLength(0);
        expect(responses[0].ok).toBe(false);
        expect(responses[0].error.code).toBe('INVALID_PARAMS');
    });

    it('passes a web sender whose stamped origin matches the browser-reported one', async () => {
        const { calls, runtime } = setup();
        runtime.emit(
            { type: 'bridge.getAccounts', request: { origin: 'https://evil.example' } },
            WEB_SENDER,
            () => {},
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(calls).toHaveLength(1);
    });

    it('falls OPEN when the sender origin is not derivable', async () => {
        const { calls, runtime } = setup();
        // No origin and an unparseable url: the layer must not be the reason a
        // legitimate call fails, so it declines to adjudicate.
        runtime.emit(
            { type: 'bridge.getAccounts', request: { origin: 'https://good.example' } },
            { url: 'about:blank', tab: { id: 9 } },
            () => {},
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(calls).toHaveLength(1);
    });

    it('never applies the cross-check to the trusted extension UI', async () => {
        const { calls, runtime } = setup();
        runtime.emit(
            { type: 'bridge.getAccounts', request: { origin: 'https://good.example' } },
            EXT_SENDER_TAB,
            () => {},
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(calls).toHaveLength(1);
    });
});

// §43.2 delivery set. The event broadcaster cannot learn which tab sits on
// which origin from chrome.tabs.query - MV3 withholds Tab.url from a manifest
// holding no "tabs" or host permission, which is why the original URL filter
// delivered nothing - so the adapter reports it from the `sender` the browser
// fills in. Anything recorded here becomes a delivery target, so it must come
// from the browser's reading and never from the page's own stamp.
describe('ChromeRuntimeAdapter connected-tab reporting', () => {
    function setup() {
        const seen = [];
        const host = { handle: async () => ({ ok: true, result: 'HANDLED' }) };
        const runtime = fakeRuntime();
        attachChromeRuntime(host, runtime, {
            onWebSender: (tabId, origin) => seen.push({ tabId, origin }),
        });
        return { seen, runtime };
    }

    it('reports the browser-supplied tab id and origin for an accepted bridge call', async () => {
        const { seen, runtime } = setup();
        runtime.emit({ type: 'bridge.getAccounts', request: {} }, WEB_SENDER, () => {});
        await flush();
        expect(seen).toEqual([{ tabId: 42, origin: 'https://evil.example' }]);
    });

    it('reports the SENDER origin, never the origin the page stamped', async () => {
        const { seen, runtime } = setup();
        runtime.emit(
            { type: 'bridge.getAccounts', request: { origin: 'https://evil.example' } },
            { ...WEB_SENDER, origin: 'https://evil.example' },
            () => {},
        );
        await flush();
        // A page that could register itself under a victim's origin would
        // receive that victim's accountsChanged payloads.
        expect(seen).toEqual([{ tabId: 42, origin: 'https://evil.example' }]);
    });

    it('reports nothing for a refused privileged type', async () => {
        const { seen, runtime } = setup();
        runtime.emit({ type: 'action.send', request: {} }, WEB_SENDER, () => {});
        await flush();
        expect(seen).toEqual([]);
    });

    it('reports nothing for a request whose stamped origin was refused', async () => {
        const { seen, runtime } = setup();
        runtime.emit(
            { type: 'bridge.signPsbt', request: { origin: 'https://good.example', psbt: 'x' } },
            WEB_SENDER,
            () => {},
        );
        await flush();
        expect(seen).toEqual([]);
    });

    it('reports nothing for the trusted extension UI', async () => {
        const { seen, runtime } = setup();
        runtime.emit({ type: 'bridge.getAccounts', request: {} }, EXT_SENDER_TAB, () => {});
        await flush();
        expect(seen).toEqual([]);
    });

    it('reports nothing when the sender origin is not derivable', async () => {
        const { seen, runtime } = setup();
        // Opaque/sandboxed frame: no usable origin, so there is nothing safe to
        // key a delivery set on. Costs delivery for that frame, never safety.
        runtime.emit(
            { type: 'bridge.getAccounts', request: {} },
            { url: 'about:blank', tab: { id: 9 } },
            () => {},
        );
        await flush();
        expect(seen).toEqual([]);
    });

    it('reports nothing when the sender carries no tab', async () => {
        const { seen, runtime } = setup();
        runtime.emit(
            { type: 'bridge.getAccounts', request: {} },
            { origin: 'https://evil.example', url: 'https://evil.example/' },
            () => {},
        );
        await flush();
        expect(seen).toEqual([]);
    });

    it('survives a throwing reporter without failing the bridge call', async () => {
        const calls = [];
        const host = { handle: async (m) => { calls.push(m); return { ok: true }; } };
        const runtime = fakeRuntime();
        attachChromeRuntime(host, runtime, {
            onWebSender: () => { throw new Error('registry exploded'); },
        });
        runtime.emit({ type: 'bridge.getAccounts', request: {} }, WEB_SENDER, () => {});
        await flush();
        expect(calls).toHaveLength(1);
    });
});

describe('ChromeRuntimeAdapter publishes a BridgeErrorCode on every web-visible failure', () => {
    it('stamps INVALID_PARAMS on an unknown bridge.* type', async () => {
        const runtime = fakeRuntime();
        // A hand-rolled postMessage with a bogus bridge.* type passes the
        // relay's prefix gate and misses the handler map; MessageHost
        // serializes UnknownMessageTypeError, which carries no code.
        const host = {
            handle: async () => ({
                ok: false,
                error: { name: 'UnknownMessageTypeError', message: 'unknown message type "bridge.nope"' },
            }),
        };
        attachChromeRuntime(host, runtime);
        const responses = [];
        runtime.emit({ type: 'bridge.nope', request: {} }, WEB_SENDER, (r) => responses.push(r));
        await flush();
        expect(responses[0].error.code).toBe('INVALID_PARAMS');
        // The precise cause must survive for a Developer-Mode log.
        expect(responses[0].error.name).toBe('UnknownMessageTypeError');
    });

    it('leaves an already-published code alone', async () => {
        const runtime = fakeRuntime();
        const host = {
            handle: async () => ({
                ok: false,
                error: { name: 'BridgeError', code: 'USER_REJECTED', message: 'no' },
            }),
        };
        attachChromeRuntime(host, runtime);
        const responses = [];
        runtime.emit({ type: 'bridge.connect', request: {} }, WEB_SENDER, (r) => responses.push(r));
        await flush();
        expect(responses[0].error.code).toBe('USER_REJECTED');
    });

    it('leaves the trusted extension UI envelope untouched', async () => {
        const runtime = fakeRuntime();
        const host = {
            handle: async () => ({
                ok: false,
                error: { name: 'UnknownMessageTypeError', message: 'unknown message type "wallet.nope"' },
            }),
        };
        attachChromeRuntime(host, runtime);
        const responses = [];
        runtime.emit({ type: 'wallet.nope', request: {} }, EXT_SENDER, (r) => responses.push(r));
        await flush();
        expect(responses[0].error.code).toBeUndefined();
    });
});

describe('sessionMeta pre-host sender gate', () => {
    it('rejects session lifecycle types from a web-origin sender', async () => {
        const runtime = fakeRuntime();
        attachSessionMetaListener({}, runtime);
        const responses = [];
        const ret = runtime.emit({ type: 'session.status', request: {} }, WEB_SENDER, (r) => responses.push(r));
        expect(ret).toBe(true);
        await Promise.resolve();
        expect(responses[0].ok).toBe(false);
        expect(responses[0].error.code).toBe('FORBIDDEN_SENDER');
    });

    it('ignores (falls through) non pre-host types regardless of sender', () => {
        const runtime = fakeRuntime();
        attachSessionMetaListener({}, runtime);
        const ret = runtime.emit({ type: 'action.send', request: {} }, EXT_SENDER, () => {});
        expect(ret).toBe(false); // not a pre-host type -> host listener handles it
    });
});

describe('signer-bridge port sender gate', () => {
    it('disconnects a web-origin port and never registers a transport', () => {
        const runtime = fakeRuntime();
        attachSignerBridgeListener(runtime);
        let disconnected = false;
        let messageListenerAdded = false;
        const port = {
            name: 'signer-bridge',
            sender: WEB_SENDER,
            disconnect: () => { disconnected = true; },
            onMessage: { addListener: () => { messageListenerAdded = true; } },
            onDisconnect: { addListener: () => {} },
        };
        runtime.emit(port);
        expect(disconnected).toBe(true);
        expect(messageListenerAdded).toBe(false);
    });

    it('accepts an extension-UI port', () => {
        const runtime = fakeRuntime();
        attachSignerBridgeListener(runtime);
        let disconnected = false;
        let messageListenerAdded = false;
        const port = {
            name: 'signer-bridge',
            sender: EXT_SENDER_TAB,
            disconnect: () => { disconnected = true; },
            onMessage: { addListener: () => { messageListenerAdded = true; } },
            onDisconnect: { addListener: () => {} },
        };
        runtime.emit(port);
        expect(disconnected).toBe(false);
        expect(messageListenerAdded).toBe(true);
    });
});

describe('signer-bridge register batch cap', () => {
    function connect(runtime) {
        let onMessage = null;
        const port = {
            name: 'signer-bridge',
            sender: EXT_SENDER_TAB,
            postMessage: () => {},
            disconnect: () => {},
            onMessage: { addListener: (fn) => { onMessage = fn; }, removeListener: () => {} },
            onDisconnect: { addListener: () => {}, removeListener: () => {} },
        };
        runtime.emit(port);
        return (msg) => onMessage(msg);
    }

    it('registers a normal batch', () => {
        signerBridge.clearAll();
        const runtime = fakeRuntime();
        attachSignerBridgeListener(runtime);
        connect(runtime)({ kind: 'register', signerIds: ['sig-a', 'sig-b'] });
        expect(signerBridge.registeredIds().sort()).toEqual(['sig-a', 'sig-b']);
    });

    it('drops an over-cap batch WHOLE rather than registering part of it', () => {
        signerBridge.clearAll();
        const runtime = fakeRuntime();
        attachSignerBridgeListener(runtime);
        const ids = Array.from({ length: MAX_SIGNER_IDS_PER_MESSAGE + 1 }, (_, i) => `sig-${i}`);
        connect(runtime)({ kind: 'register', signerIds: ids });
        expect(signerBridge.registeredIds()).toEqual([]);
        signerBridge.clearAll();
    });
});

describe('content script relay allowlist', () => {
    it('only relays bridge.* types (source pins the guard)', () => {
        // The content script is an IIFE that runs on import against a live
        // chrome/document; assert on its source that the guard is present and
        // rejects non-bridge types before the chrome.runtime.sendMessage relay.
        expect(contentScriptSource).toMatch(/startsWith\('bridge\.'\)/);
        // The guard must sit before the actual relay call (not the mention
        // of chrome.runtime.sendMessage in the header comment).
        const guardIdx = contentScriptSource.indexOf("startsWith('bridge.')");
        const relayIdx = contentScriptSource.indexOf('chrome.runtime.sendMessage({ type: data.type');
        expect(guardIdx).toBeGreaterThan(-1);
        expect(relayIdx).toBeGreaterThan(guardIdx);
    });

    it('stamps the real page origin AFTER spreading the page-supplied request', () => {
        // First layer of the confused-deputy defense, and its whole strength
        // is the ORDER of two lines: spread the page's request, then overwrite
        // origin. Flip them and any page inherits any connected site's grants.
        const spreadIdx = contentScriptSource.indexOf('...(data.request ?? {})');
        const stampIdx = contentScriptSource.indexOf('origin: window.location.origin');
        expect(spreadIdx).toBeGreaterThan(-1);
        expect(stampIdx).toBeGreaterThan(spreadIdx);
        // ...and both inside the same object literal handed to sendMessage.
        const relayIdx = contentScriptSource.indexOf('chrome.runtime.sendMessage({ type: data.type');
        expect(relayIdx).toBeGreaterThan(stampIdx);
    });
});
